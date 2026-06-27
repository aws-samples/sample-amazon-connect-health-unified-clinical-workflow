// Care Intelligence Workspace — Main Application
const CONFIG = window.CARE_INTELLIGENCE_CONFIG;
let sessionId = 'ci-' + Math.random().toString(36).substr(2, 8);
let isStreaming = false;
document.getElementById('sessionIdDisplay').textContent = 'Session: ' + sessionId;

function md2html(text) {
    text = text.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (m, header, rows) => {
        const ths = header.split('|').filter(c => c.trim()).map(c =>
            `<th>${escapeHtml(c.trim())}</th>`).join('');
        const trs = rows.trim().split('\n').map(row => {
            const tds = row.split('|').filter(c => c !== '').map(c =>
                `<td>${escapeHtml(c.trim())}</td>`).join('');
            return `<tr>${tds}</tr>`;
        }).join('');
        return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    });
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/`(.+?)`/g, '<code>$1</code>');
    text = text.replace(/^[•\-\*] (.+)/gm, '<li>$1</li>');
    text = text.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    text = text.replace(/\n\n/g, '<br><br>');
    text = text.replace(/\n(?!<)/g, '<br>');
    return text;
}

function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendMessage(role, text, traceInfo) {
    const area = document.getElementById('messagesArea');
    const isUser = role === 'user';
    const msg = document.createElement('div');
    msg.className = 'msg ' + (isUser ? 'msg-user' : 'msg-agent') + (role === 'error' ? ' msg-error' : '');
    const avatarSvg = isUser
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a4 4 0 014-4h4a4 4 0 014 4v2"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v4a4 4 0 01-4 4 4 4 0 01-4-4V6a4 4 0 014-4z"/><path d="M6 18a6 6 0 0012 0"/></svg>';
    let traceHtml = '';
    if (traceInfo) {
        traceHtml = `<div class="trace-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            λ ${traceInfo}
        </div>`;
    }
    msg.innerHTML = `
        <div class="msg-avatar">${avatarSvg}</div>
        <div class="msg-bubble">
            <div class="msg-sender">${isUser ? 'Maria Lopez' : 'Care Intelligence Agent'}</div>
            ${traceHtml}
            <div class="msg-text">${isUser ? escapeHtml(text) : md2html(text)}</div>
        </div>`;
    area.appendChild(msg);
    area.scrollTop = area.scrollHeight;
    return msg;
}

function setTyping(show, label) {
    const el = document.getElementById('typingIndicator');
    const lbl = document.getElementById('typingLabel');
    el.style.display = show ? 'flex' : 'none';
    if (label) lbl.textContent = label;
}

async function invokeAgent(inputText) {
    setTyping(true, 'Querying HealthLake...');
    document.getElementById('sendBtn').disabled = true;
    let traceInfo = null;
    let fullText = '';
    try {
        const resp = await fetch(CONFIG.BACKEND_URL + '/api/bedrock-agent/invoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentId: CONFIG.AGENT_ID,
                agentAliasId: CONFIG.AGENT_ALIAS_ID,
                sessionId: sessionId,
                inputText: inputText
            })
        });
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error('Backend error: ' + resp.status + ' — ' + err);
        }
        const data = await resp.json();
        if (!data.success) {
            throw new Error(data.error || 'Unknown error from agent');
        }
        fullText = data.response || '';
        traceInfo = data.trace || null;
    } catch (err) {
        setTyping(false);
        document.getElementById('sendBtn').disabled = false;
        appendMessage('error', '⚠ ' + err.message);
        return;
    }
    setTyping(false);
    document.getElementById('sendBtn').disabled = false;
    appendMessage('agent', fullText, traceInfo);
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || isStreaming) return;
    input.value = '';
    input.style.height = 'auto';
    appendMessage('user', text);
    invokeAgent(text);
}

function sendQuickQuery(text) {
    if (isStreaming) return;
    appendMessage('user', text);
    invokeAgent(text);
}

function handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function clearChat() {
    sessionId = 'ci-' + Math.random().toString(36).substr(2, 8);
    document.getElementById('sessionIdDisplay').textContent = 'Session: ' + sessionId;
    const area = document.getElementById('messagesArea');
    area.innerHTML = '';
    appendMessage('agent', 'Session cleared. How can I help you today, Maria?');
}
