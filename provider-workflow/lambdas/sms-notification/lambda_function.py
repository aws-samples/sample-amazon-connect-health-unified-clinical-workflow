"""
Connect Health - After-Visit SMS Notification Lambda

Triggered by S3 event when afterVisitSummary.json is written.
Reads the summary, composes a patient-friendly SMS, sends via SNS.

S3 key pattern:
  <sessionId>/health-agent-listening-session/<domainId>/<subId>/<sessionId>/post-stream-action/clinical-notes/afterVisitSummary.json
"""

import json
import os
import boto3
import urllib.parse

s3 = boto3.client('s3')
sns = boto3.client('sns')
connect = boto3.client('connect', region_name='us-east-1')

INSTANCE_ID = os.environ.get('CONNECT_INSTANCE_ID', 'cd86b3df-9b50-49b9-bb52-b0731f7cdafa')
CLINIC_PHONE = os.environ.get('CLINIC_PHONE', '(555) 010-0102')
CLINIC_NAME = os.environ.get('CLINIC_NAME', 'Connect Health Clinic')
# For demo: override recipient phone (send to yourself instead of patient)
DEMO_PHONE_OVERRIDE = os.environ.get('DEMO_PHONE_OVERRIDE', '')


def lambda_handler(event, context):
    print(f"Event received: {event.get('Records', [{}])[0].get('eventSource', 'unknown')} ({len(json.dumps(event))} bytes; payload redacted)")
    
    # Get S3 object info from event
    record = event['Records'][0]
    bucket = record['s3']['bucket']['name']
    key = urllib.parse.unquote_plus(record['s3']['object']['key'])
    
    print(f"Processing: s3://{bucket}/{key}")
    
    # Extract session ID from key
    # Pattern: <sessionId>/health-agent-listening-session/...
    session_id = key.split('/')[0]
    print(f"Session ID: {session_id}")
    
    # Read the after-visit summary
    response = s3.get_object(Bucket=bucket, Key=key)
    summary_data = json.loads(response['Body'].read().decode('utf-8'))
    
    # Extract summarized segments
    segments = summary_data.get('AfterVisitSummary', {}).get('SummarizedSegments', [])
    if not segments:
        print("No summarized segments found, skipping SMS")
        return {'statusCode': 200, 'body': 'No segments'}
    
    # Build patient-friendly message (SMS limit ~160 chars per segment, aim for 2-3 segments)
    # Pick the most relevant segments (skip greetings, focus on actions/next steps)
    action_keywords = ['will', 'check', 'plan', 'follow', 'appointment', 'test', 'medication', 'prescri']
    action_segments = []
    other_segments = []
    
    for seg in segments:
        text = seg.get('SummarizedSegment', '')
        if any(kw in text.lower() for kw in action_keywords):
            action_segments.append(text)
        else:
            other_segments.append(text)
    
    # Compose SMS: greeting + top 2-3 action items + contact info
    sms_parts = [f"Thank you for visiting {CLINIC_NAME}."]
    
    # Add up to 3 action segments
    for seg in action_segments[:3]:
        sms_parts.append(seg)
    
    # If no action segments, use first 2 other segments
    if not action_segments and other_segments:
        sms_parts.append(other_segments[0])
    
    sms_parts.append(f"Questions? Call {CLINIC_PHONE}")
    
    message = ' '.join(sms_parts)
    
    # Trim to SMS-friendly length (320 chars = 2 SMS segments)
    if len(message) > 320:
        message = message[:317] + '...'
    
    print(f"SMS message composed (length={len(message)} chars; content redacted — PHI)")
    
    # Get patient phone number
    # Try to find it from the contact (session_id = contact_id in our setup)
    patient_phone = get_patient_phone(session_id)
    
    if DEMO_PHONE_OVERRIDE:
        print(f"Demo mode: overriding recipient to {DEMO_PHONE_OVERRIDE}")
        patient_phone = DEMO_PHONE_OVERRIDE
    
    if not patient_phone:
        print("Could not determine patient phone number, skipping SMS")
        return {'statusCode': 200, 'body': 'No phone number'}
    
    # Send SMS via pinpoint-sms-voice-v2
    try:
        sms_client = boto3.client('pinpoint-sms-voice-v2', region_name='us-east-1')
        result = sms_client.send_text_message(
            DestinationPhoneNumber=patient_phone,
            OriginationIdentity=os.environ.get('SMS_ORIGINATION_NUMBER', '+18445658359'),
            MessageBody=message,
            MessageType='TRANSACTIONAL'
        )
        msg_id = result.get('MessageId', 'unknown')
        print(f"SMS sent successfully: MessageId={msg_id}")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'SMS sent',
                'messageId': msg_id,
                'recipient': patient_phone
            })
        }
    except Exception as e:
        print(f"Failed to send SMS: {e}")
        return {'statusCode': 500, 'body': str(e)}


def get_patient_phone(session_id):
    """Get patient phone from bridge-trigger Lambda logs or S3 metadata."""
    import re
    import time as _time
    
    # Strategy 1: Check S3 for metadata file written by bridge-trigger
    try:
        meta_key = f"{session_id}/contact-metadata.json"
        meta_resp = s3.get_object(Bucket=os.environ['SESSION_METADATA_BUCKET'], Key=meta_key)
        meta = json.loads(meta_resp['Body'].read().decode('utf-8'))
        if meta.get('customerPhone'):
            print(f"Found phone from S3 metadata (value redacted — PHI)")
            return meta['customerPhone']
    except Exception:
        pass  # Metadata file doesn't exist yet
    
    # Strategy 2: Scan recent bridge-trigger logs (last 5 min, no filter pattern)
    try:
        logs = boto3.client('logs', region_name='us-east-1')
        start_ms = int((_time.time() - 300) * 1000)
        response = logs.filter_log_events(
            logGroupName='/aws/lambda/connect-health-bridge-trigger',
            startTime=start_ms,
            limit=20
        )
        for event in response.get('events', []):
            msg = event.get('message', '')
            # Check if this log entry contains our session ID
            if session_id in msg:
                # Extract phone number
                match = re.search(r'\+1\d{10}', msg)
                if match:
                    phone = match.group(0)
                    print(f"Found patient phone from logs (value redacted — PHI)")
                    return phone
    except Exception as e:
        print(f"Error looking up phone from logs: {e}")
    
    print(f"Could not find phone for session {session_id}")
    return None
