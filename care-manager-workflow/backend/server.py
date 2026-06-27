"""
Care Manager workflow backend — Flask proxy to Amazon Bedrock Agent.

This service receives chat messages from the Care Intelligence frontend
and forwards them to the configured Bedrock Agent via the
bedrock-agent-runtime InvokeAgent API. The agent's natural-language
response (and optional trace data) is returned to the caller.

Endpoints
---------
GET  /healthz
    Liveness probe for ECS health checks.

POST /api/bedrock-agent/invoke
    Body:  {agentId, agentAliasId, sessionId, inputText}
    Reply: {success, response, trace?, disclaimer}

Configuration (env vars)
------------------------
AWS_REGION                 (default us-east-1)
BEDROCK_AGENT_ID           default agent ID if not in request body
BEDROCK_AGENT_ALIAS_ID     default alias ID if not in request body
ENABLE_TRACE               'true' to surface Bedrock trace data
CORS_ORIGINS               comma-separated list (default '*')
SERVER_HOST                bind address (default 0.0.0.0)
SERVER_PORT                bind port (default 5001 — provider uses 5000)
DEBUG                      'true' for Flask debug mode

PHI-safe logging
----------------
Logs only metadata: session ID prefix, input length, response length,
trace event counts. Never logs the user's question or the agent's
response. CloudWatch logs remain PHI-free.
"""
import json
import logging
import os
import sys
from typing import Any, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from flask import Flask, jsonify, request
from flask_cors import CORS

# ── Logging — PHI-safe convention ──────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
BEDROCK_AGENT_ID_DEFAULT = os.environ.get('BEDROCK_AGENT_ID', '')
BEDROCK_AGENT_ALIAS_ID_DEFAULT = os.environ.get('BEDROCK_AGENT_ALIAS_ID', '')
ENABLE_TRACE = os.environ.get('ENABLE_TRACE', 'false').lower() == 'true'
CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
SERVER_HOST = os.environ.get('SERVER_HOST', '0.0.0.0')
SERVER_PORT = int(os.environ.get('SERVER_PORT', '5001'))
DEBUG = os.environ.get('DEBUG', 'false').lower() == 'true'

# Required disclaimer attached to every agent response.
# See RESPONSIBLE_AI.md.
AI_DISCLAIMER = (
    'AI-generated clinical content requires review by a licensed '
    'healthcare professional before use in patient care.'
)

# ── Flask app ──────────────────────────────────────────────────────
app = Flask(__name__)
CORS(
    app,
    resources={r'/api/*': {'origins': [o.strip() for o in CORS_ORIGINS.split(',')]}},
)

# Module-level Bedrock Agent runtime client (reused across warm requests).
_bedrock_agent_runtime = None


def _get_bedrock_agent_runtime():
    """Lazily create and cache the bedrock-agent-runtime client."""
    global _bedrock_agent_runtime
    if _bedrock_agent_runtime is None:
        _bedrock_agent_runtime = boto3.client(
            'bedrock-agent-runtime', region_name=AWS_REGION
        )
    return _bedrock_agent_runtime


# ────────────────────────────────────────────────────────────────────
# Health check
# ────────────────────────────────────────────────────────────────────
@app.route('/healthz', methods=['GET'])
def healthz():
    """ECS health-check endpoint. Returns 200 OK."""
    return jsonify({'status': 'ok'}), 200


# ────────────────────────────────────────────────────────────────────
# Bedrock Agent invocation
# ────────────────────────────────────────────────────────────────────
@app.route('/api/bedrock-agent/invoke', methods=['POST', 'OPTIONS'])
def invoke_agent():
    """Forward a chat message to the configured Bedrock Agent."""
    if request.method == 'OPTIONS':
        # flask-cors handles preflight, but we explicitly succeed
        return '', 204

    body = request.get_json(silent=True) or {}
    agent_id = (body.get('agentId') or BEDROCK_AGENT_ID_DEFAULT).strip()
    agent_alias_id = (
        body.get('agentAliasId') or BEDROCK_AGENT_ALIAS_ID_DEFAULT
    ).strip()
    session_id = (body.get('sessionId') or '').strip()
    input_text = (body.get('inputText') or '').strip()

    # Validate inputs
    missing = []
    if not agent_id:
        missing.append('agentId (or BEDROCK_AGENT_ID env var)')
    if not agent_alias_id:
        missing.append('agentAliasId (or BEDROCK_AGENT_ALIAS_ID env var)')
    if not session_id:
        missing.append('sessionId')
    if not input_text:
        missing.append('inputText')
    if missing:
        logger.warning('[invoke] missing required fields: %s', missing)
        return jsonify({
            'success': False,
            'error': f'Missing required field(s): {", ".join(missing)}',
            'disclaimer': AI_DISCLAIMER,
        }), 400

    if len(input_text) > 4000:
        logger.warning('[invoke] input_text too long: %d chars', len(input_text))
        return jsonify({
            'success': False,
            'error': 'inputText exceeds 4000-character limit',
            'disclaimer': AI_DISCLAIMER,
        }), 400

    logger.info(
        '[invoke] session=%s... agent=%s alias=%s input_len=%d',
        session_id[:8], agent_id, agent_alias_id, len(input_text),
    )

    try:
        full_response, trace_events = _invoke_and_collect(
            agent_id=agent_id,
            agent_alias_id=agent_alias_id,
            session_id=session_id,
            input_text=input_text,
        )
    except ClientError as e:
        return _client_error_response(e)
    except BotoCoreError as e:
        logger.error('[invoke] BotoCoreError: %s', type(e).__name__)
        return jsonify({
            'success': False,
            'error': f'AWS SDK error: {type(e).__name__}',
            'disclaimer': AI_DISCLAIMER,
        }), 502
    except Exception as e:
        # Final safety net — never leak full exception detail to the client
        logger.exception('[invoke] unexpected error: %s', type(e).__name__)
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'disclaimer': AI_DISCLAIMER,
        }), 500

    logger.info(
        '[invoke] response_len=%d trace_events=%d',
        len(full_response), len(trace_events),
    )

    reply = {
        'success': True,
        'response': full_response,
        'disclaimer': AI_DISCLAIMER,
    }
    if ENABLE_TRACE and trace_events:
        # Surface a compact, scrubbed trace for the UI's debug view
        reply['trace'] = _summarize_trace(trace_events)
    return jsonify(reply), 200


def _invoke_and_collect(agent_id: str, agent_alias_id: str,
                        session_id: str, input_text: str):
    """Call InvokeAgent and assemble the streamed response chunks."""
    client = _get_bedrock_agent_runtime()
    response = client.invoke_agent(
        agentId=agent_id,
        agentAliasId=agent_alias_id,
        sessionId=session_id,
        inputText=input_text,
        enableTrace=ENABLE_TRACE,
    )

    full_text_chunks: list = []
    trace_events: list = []

    # InvokeAgent returns an EventStream — iterate and accumulate
    for event in response.get('completion', []):
        # Standard chunk: textual response from the model
        if 'chunk' in event:
            chunk = event['chunk']
            data = chunk.get('bytes')
            if isinstance(data, (bytes, bytearray)):
                full_text_chunks.append(data.decode('utf-8', errors='replace'))
            elif isinstance(data, str):
                full_text_chunks.append(data)
        # Trace events (only present if enableTrace=True)
        elif 'trace' in event and ENABLE_TRACE:
            trace_events.append(event['trace'])
        # Other event types are ignored

    full_text = ''.join(full_text_chunks).strip()
    return full_text, trace_events


def _summarize_trace(trace_events: list) -> list:
    """
    Produce a UI-friendly summary of Bedrock Agent trace events.

    Strips raw model prompts (which may contain PHI from FHIR data the
    agent retrieved). Surfaces only structural information: which action
    groups were invoked and what high-level reasoning step was taken.
    """
    summary = []
    for event in trace_events:
        trace = event.get('trace', {}) or {}
        # Orchestration steps
        orch = trace.get('orchestrationTrace', {}) or {}
        if 'invocationInput' in orch:
            inv = orch['invocationInput']
            action_group = (
                inv.get('actionGroupInvocationInput', {}).get('actionGroupName')
            )
            if action_group:
                summary.append({
                    'type': 'tool-call',
                    'action_group': action_group,
                })
        if 'observation' in orch:
            obs = orch['observation']
            if 'actionGroupInvocationOutput' in obs:
                summary.append({'type': 'tool-result-received'})
            if 'finalResponse' in obs:
                summary.append({'type': 'final-response-composed'})
        # Pre/post processing
        if 'preProcessingTrace' in trace:
            summary.append({'type': 'pre-processing'})
        if 'postProcessingTrace' in trace:
            summary.append({'type': 'post-processing'})
    return summary


def _client_error_response(e: ClientError):
    """Turn a botocore ClientError into a safe API response."""
    code = e.response.get('Error', {}).get('Code', 'Unknown')
    # PHI-safe: log the error code only, never the agent's request body
    logger.error('[invoke] AWS ClientError: %s', code)

    if code in ('AccessDeniedException', 'UnauthorizedOperation'):
        status = 403
        msg = (
            'The backend is not authorized to invoke the configured '
            'Bedrock Agent. Check the ECS task role IAM policy.'
        )
    elif code in ('ResourceNotFoundException', 'ValidationException'):
        status = 404
        msg = (
            'Bedrock Agent or alias not found. Verify agentId and '
            'agentAliasId are correct for this region.'
        )
    elif code in ('ThrottlingException', 'ServiceQuotaExceededException'):
        status = 429
        msg = 'Bedrock Agent throttled. Retry after a short backoff.'
    else:
        status = 502
        msg = f'Bedrock Agent error ({code}). See backend logs for detail.'

    return jsonify({
        'success': False,
        'error': msg,
        'errorCode': code,
        'disclaimer': AI_DISCLAIMER,
    }), status


# ────────────────────────────────────────────────────────────────────
# Entrypoint (dev only — production uses gunicorn from Dockerfile)
# ────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    logger.info(
        'Starting care-manager backend on %s:%d (region=%s, trace=%s)',
        SERVER_HOST, SERVER_PORT, AWS_REGION, ENABLE_TRACE,
    )
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=DEBUG)
