# Phase 2: Live Transcript Module
# ================================
# Add to backend/server.py — provides /api/streaming/session/<id>/live-transcript
# by polling CloudWatch Logs for the bridge service log group.
#
# Bridge log lines look like:
#   [Session:abc-123-...] {"type":"transcript","sessionId":"abc-123-...","text":"Hello","final":true}
#
# This module:
#   1. Maintains an in-memory dict of {sessionId: [segments]} per active session
#   2. Spawns a background thread per session that polls CloudWatch every 2s
#   3. Auto-stops polling 30 min after last activity OR if no logs for 5 min
#
# To use, in server.py add at top:
#   import live_transcript
#
# And register route:
#   @app.route('/api/streaming/session/<session_id>/live-transcript', methods=['GET'])
#   def live_transcript_endpoint(session_id):
#       return live_transcript.get_segments(session_id)

import json
import re
import threading
import time
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import ClientError
from flask import jsonify

# Configuration
BRIDGE_LOG_GROUP = '/ecs/connect-health-bridge-dev'
POLL_INTERVAL_SECONDS = 2
SESSION_MAX_DURATION_SECONDS = 30 * 60  # 30 minutes
SESSION_INACTIVITY_TIMEOUT_SECONDS = 5 * 60  # 5 minutes of no logs = end session
AWS_REGION = 'us-east-1'

# In-memory state — per-process, lost on restart, fine for demo
_sessions = {}  # sessionId -> {'segments': [...], 'started_at': ts, 'last_activity': ts, 'thread': Thread, 'stop': Event, 'last_token': str|None}
_lock = threading.Lock()

_logs_client = None


def _get_logs_client():
    global _logs_client
    if _logs_client is None:
        _logs_client = boto3.client('logs', region_name=AWS_REGION)
    return _logs_client


def _parse_transcript_line(message):
    """Extract transcript JSON(s) from a bridge log line.
    
    Bridge logs may contain multiple [Session:...] entries on one line.
    Returns a list of transcript objects found.
    """
    results = []
    # Find all [Session:...] {json} patterns — use non-greedy match for JSON
    matches = re.findall(r'\[Session:[^\]]+\]\s*(\{"type":"transcript"[^}]*\})', message)
    for json_str in matches:
        try:
            obj = json.loads(json_str)
            if obj.get('type') == 'transcript':
                results.append(obj)
        except Exception:
            pass
    return results if results else None


def _poll_session(session_id):
    """Background poller for one session. Runs until stop event or timeout."""
    state = _sessions.get(session_id)
    if not state:
        return

    stop = state['stop']
    last_token = state.get('last_token')
    started_at = state['started_at']

    # Start filtering from 30 minutes before session start (catches historical + live)
    start_time_ms = int((started_at - 1800) * 1000)

    seen_event_ids = set()  # de-duplicate events across calls

    print(f'[live_transcript] Polling started for {session_id}')

    while not stop.is_set():
        try:
            # Stop if max duration exceeded
            if time.time() - started_at > SESSION_MAX_DURATION_SECONDS:
                print(f'[live_transcript] Max duration reached for {session_id}, stopping')
                break

            # Stop if no activity for the inactivity window
            if time.time() - state['last_activity'] > SESSION_INACTIVITY_TIMEOUT_SECONDS:
                print(f'[live_transcript] Inactivity timeout for {session_id}, stopping')
                break

            kwargs = {
                'logGroupName': BRIDGE_LOG_GROUP,
                'filterPattern': f'"sessionId":"{session_id}"',
                'startTime': start_time_ms,
                'limit': 100,
            }
            if last_token:
                kwargs['nextToken'] = last_token

            try:
                resp = _get_logs_client().filter_log_events(**kwargs)
            except ClientError as e:
                print(f'[live_transcript] CloudWatch error for {session_id}: {e}')
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            events_list = resp.get('events', [])
            if events_list:
                # PHI-safe: log event count only — never the message content (transcript text)
                print(f'[live_transcript] Got {len(events_list)} events from CloudWatch for {session_id}')
            else:
                print(f'[live_transcript] No events from CloudWatch. kwargs: startTime={kwargs.get("startTime")}, filterPattern={kwargs.get("filterPattern")}')

            new_segments = []
            for event in events_list:
                event_id = event.get('eventId') or f"{event.get('timestamp')}-{event.get('message', '')[:80]}"
                if event_id in seen_event_ids:
                    continue
                seen_event_ids.add(event_id)

                parsed_list = _parse_transcript_line(event.get('message', ''))
                if parsed_list:
                    for parsed in parsed_list:
                        if parsed.get('sessionId') == session_id:
                            new_segments.append({
                                'text': parsed.get('text', ''),
                                'final': bool(parsed.get('final', False)),
                                'ts': event.get('timestamp', int(time.time() * 1000)),
                            })

            if new_segments:
                with _lock:
                    state['segments'].extend(new_segments)
                    state['last_activity'] = time.time()
                # Advance the start time so next poll only sees newer events
                latest_ts = max(s['ts'] for s in new_segments)
                start_time_ms = latest_ts + 1
                # Reset token — we're using time-based pagination now
                last_token = None
            else:
                last_token = resp.get('nextToken')

        except Exception as e:
            print(f'[live_transcript] Unexpected error for {session_id}: {e}')

        # Wait before next poll, but check stop event frequently
        for _ in range(POLL_INTERVAL_SECONDS * 4):
            if stop.is_set():
                break
            time.sleep(0.25)

    # Cleanup
    with _lock:
        if session_id in _sessions:
            print(f'[live_transcript] Cleanup for {session_id}, total segments: {len(state["segments"])}')


def _ensure_polling(session_id):
    """Start polling for a session if not already polling."""
    with _lock:
        state = _sessions.get(session_id)
        if state and state['thread'].is_alive():
            return  # already polling

        # Initialize new session state
        stop = threading.Event()
        new_state = {
            'segments': [],
            'started_at': time.time(),
            'last_activity': time.time(),
            'stop': stop,
            'last_token': None,
        }
        thread = threading.Thread(
            target=_poll_session,
            args=(session_id,),
            daemon=True,
            name=f'live-transcript-{session_id[:8]}',
        )
        new_state['thread'] = thread
        _sessions[session_id] = new_state
        thread.start()


def get_segments(session_id):
    """Flask handler — returns transcript segments for this session.
    
    Directly queries CloudWatch Logs (synchronous, simple, reliable).
    
    The bridge logs use two different IDs:
    - contact_id: used in [BridgeServlet] and [MedicalScribe:contact_id] lines
    - scribe_session_id: used in [Session:scribe_id] transcript lines
    
    The frontend passes the contact_id. We first resolve it to the scribe session ID
    by finding the "Session started:" log line, then query transcripts by scribe session.
    """
    if not session_id:
        return jsonify({'success': False, 'error': 'session_id required'}), 400

    import time as _time
    start_time_ms = int((_time.time() - 3600) * 1000)  # Look back 1 hour
    
    try:
        client = _get_logs_client()
        
        # Step 1: Find the scribe session ID from the MedicalScribe startup line
        # Pattern: [MedicalScribe:<contact_id>] Session started: <scribe_session_id>
        scribe_session_id = session_id  # fallback to contact_id
        
        resp = client.filter_log_events(
            logGroupName=BRIDGE_LOG_GROUP,
            filterPattern=f'"Session started"',
            startTime=start_time_ms,
            limit=50,
        )
        
        import re
        for event in resp.get('events', []):
            msg = event.get('message', '')
            # Match: [MedicalScribe:<contact_id>] Session started: <scribe_session_id>
            match = re.search(
                r'\[MedicalScribe:' + re.escape(session_id) + r'\] Session started: ([a-f0-9-]+)',
                msg
            )
            if match:
                scribe_session_id = match.group(1)
                break
        
        # Step 2: Query transcripts using the scribe session ID
        # Use "Session:" prefix to match [Session:<id>] lines
        resp = client.filter_log_events(
            logGroupName=BRIDGE_LOG_GROUP,
            filterPattern=f'"Session:{scribe_session_id}"',
            startTime=start_time_ms,
            limit=200,
        )
        
        segments = []
        for event in resp.get('events', []):
            msg = event.get('message', '')
            parsed_list = _parse_transcript_line(msg)
            if parsed_list:
                for parsed in parsed_list:
                    if parsed.get('sessionId') == scribe_session_id:
                        segments.append({
                            'text': parsed.get('text', ''),
                            'final': bool(parsed.get('final', False)),
                            'ts': event.get('timestamp', int(_time.time() * 1000)),
                        })
        
        return jsonify({
            'success': True,
            'sessionId': session_id,
            'scribeSessionId': scribe_session_id,
            'segments': segments,
            'count': len(segments),
        })
    except ClientError as e:
        return jsonify({'success': False, 'error': str(e), 'sessionId': session_id}), 500


def stop_session(session_id):
    """Optional explicit stop. Frontend can call this on contact.onEnded."""
    with _lock:
        state = _sessions.get(session_id)
        if state:
            state['stop'].set()
    return jsonify({'success': True})
