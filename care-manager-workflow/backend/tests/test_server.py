"""
Unit tests for the Care Manager backend.

Run from care-manager-workflow/backend:
    pip install -r requirements.txt
    pip install pytest
    python -m pytest tests/ -v

The tests do not require AWS credentials — Bedrock Agent calls are
mocked via patch on the bedrock-agent-runtime client.
"""
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Make the backend's server.py importable from the tests dir
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Set env vars BEFORE importing server so config picks them up
os.environ.setdefault('BEDROCK_AGENT_ID', 'TEST-AGENT-ID')
os.environ.setdefault('BEDROCK_AGENT_ALIAS_ID', 'TEST-ALIAS')

import server  # noqa: E402


@pytest.fixture
def client():
    """Flask test client with a fresh state per test."""
    server.app.config['TESTING'] = True
    server._bedrock_agent_runtime = None  # reset between tests
    with server.app.test_client() as c:
        yield c


def test_healthz_returns_200(client):
    """GET /healthz returns 200 OK."""
    resp = client.get('/healthz')
    assert resp.status_code == 200
    assert resp.get_json() == {'status': 'ok'}


def test_invoke_missing_session_id_returns_400(client):
    """POST without sessionId is a 400 with disclaimer attached."""
    resp = client.post(
        '/api/bedrock-agent/invoke',
        json={'inputText': 'hello'},
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body['success'] is False
    assert 'sessionId' in body['error']
    assert 'disclaimer' in body  # always attach


def test_invoke_missing_input_text_returns_400(client):
    """POST without inputText is a 400 with disclaimer attached."""
    resp = client.post(
        '/api/bedrock-agent/invoke',
        json={'sessionId': 's-1'},
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body['success'] is False
    assert 'inputText' in body['error']


def test_invoke_oversize_input_returns_400(client):
    """Input text over 4000 chars is rejected."""
    resp = client.post(
        '/api/bedrock-agent/invoke',
        json={'sessionId': 's-1', 'inputText': 'x' * 4001},
    )
    assert resp.status_code == 400
    assert '4000' in resp.get_json()['error']


def test_invoke_happy_path(client):
    """Mocked InvokeAgent returns a stream — the response is assembled."""
    mock_client = MagicMock()
    mock_client.invoke_agent.return_value = {
        'completion': [
            {'chunk': {'bytes': b'Hello, '}},
            {'chunk': {'bytes': b'care manager!'}},
        ]
    }
    with patch.object(server, '_get_bedrock_agent_runtime', return_value=mock_client):
        resp = client.post(
            '/api/bedrock-agent/invoke',
            json={
                'sessionId': 's-test-1',
                'inputText': 'Hello',
            },
        )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['success'] is True
    assert body['response'] == 'Hello, care manager!'
    assert 'disclaimer' in body

    # The mock was called with the expected arguments
    mock_client.invoke_agent.assert_called_once()
    kwargs = mock_client.invoke_agent.call_args.kwargs
    assert kwargs['agentId'] == 'TEST-AGENT-ID'
    assert kwargs['agentAliasId'] == 'TEST-ALIAS'
    assert kwargs['sessionId'] == 's-test-1'
    assert kwargs['inputText'] == 'Hello'


def test_invoke_access_denied_returns_403(client):
    """An AWS AccessDeniedException is translated into HTTP 403."""
    from botocore.exceptions import ClientError
    mock_client = MagicMock()
    mock_client.invoke_agent.side_effect = ClientError(
        {'Error': {'Code': 'AccessDeniedException', 'Message': 'denied'}},
        'InvokeAgent',
    )
    with patch.object(server, '_get_bedrock_agent_runtime', return_value=mock_client):
        resp = client.post(
            '/api/bedrock-agent/invoke',
            json={'sessionId': 's-1', 'inputText': 'hi'},
        )
    assert resp.status_code == 403
    body = resp.get_json()
    assert body['success'] is False
    assert body['errorCode'] == 'AccessDeniedException'
    assert 'IAM' in body['error']


def test_invoke_throttling_returns_429(client):
    """A ThrottlingException is translated into HTTP 429."""
    from botocore.exceptions import ClientError
    mock_client = MagicMock()
    mock_client.invoke_agent.side_effect = ClientError(
        {'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}},
        'InvokeAgent',
    )
    with patch.object(server, '_get_bedrock_agent_runtime', return_value=mock_client):
        resp = client.post(
            '/api/bedrock-agent/invoke',
            json={'sessionId': 's-1', 'inputText': 'hi'},
        )
    assert resp.status_code == 429


def test_invoke_resource_not_found_returns_404(client):
    """A ResourceNotFoundException is translated into HTTP 404."""
    from botocore.exceptions import ClientError
    mock_client = MagicMock()
    mock_client.invoke_agent.side_effect = ClientError(
        {'Error': {'Code': 'ResourceNotFoundException', 'Message': 'gone'}},
        'InvokeAgent',
    )
    with patch.object(server, '_get_bedrock_agent_runtime', return_value=mock_client):
        resp = client.post(
            '/api/bedrock-agent/invoke',
            json={'sessionId': 's-1', 'inputText': 'hi'},
        )
    assert resp.status_code == 404


def test_disclaimer_attached_to_every_response(client):
    """Every response — success or error — must carry the disclaimer."""
    # 400 path
    r400 = client.post('/api/bedrock-agent/invoke', json={'sessionId': ''})
    assert 'disclaimer' in r400.get_json()

    # 200 path (mocked)
    mock_client = MagicMock()
    mock_client.invoke_agent.return_value = {'completion': []}
    with patch.object(server, '_get_bedrock_agent_runtime', return_value=mock_client):
        r200 = client.post(
            '/api/bedrock-agent/invoke',
            json={'sessionId': 's-1', 'inputText': 'hi'},
        )
    assert 'disclaimer' in r200.get_json()
