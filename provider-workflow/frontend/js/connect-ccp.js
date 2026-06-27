// Phase 1 + Phase 2 CCP integration
// =================================
// - Embeds CCP iframe in #ccpContainer
// - Auto-opens patient chart on contact.onConnecting
// - Phase 2: polls /api/streaming/session/<id>/live-transcript every 2s
//   while contact is connected, renders segments via addTranscriptEntry()
// - On contact.onEnded, schedules SOAP/codes refresh via fetchAndDisplayStreamingOutputs()

(function () {
    'use strict';

    // Connect Workspace event handler for embedded third-party apps
    window.addEventListener('message', function(event) {
        // Reset stale state on each new page load
        if (!window._embedStateReset) {
            // Check if SOAP is pending display (call ended, waiting for SOAP notes)
            var soapPending = null;
            try { soapPending = JSON.parse(localStorage.getItem('soapPendingContact')); } catch(e) {}
            if (soapPending && (Date.now() - soapPending.timestamp) < 300000) {
                // SOAP pending within last 5 min — keep consultation view, block schedule reset
                window._soapPendingForContact = soapPending.contactId;
                window._patientOpened = 'soap-pending';
                console.log('[CCP-EMBED] SOAP pending for contact:', soapPending.contactId, '— keeping consultation view');
                // Re-trigger SOAP fetch in case iframe reloaded
                if (typeof window.fetchAndDisplayStreamingOutputs === 'function') {
                    setTimeout(function() {
                        window.fetchAndDisplayStreamingOutputs(soapPending.contactId).then(function() {
                            var s = document.getElementById('soapNotesOverlay');
                            if (s) { s.classList.add('active'); s.style.opacity = '1'; s.style.visibility = 'visible'; s.style.pointerEvents = 'auto'; }
                        });
                    }, 2000);
                }
            } else if (localStorage.getItem('consultationEnded')) {
                // Previous consultation fully done — allow fresh start
                try { localStorage.removeItem('consultationEnded'); localStorage.removeItem('soapPendingContact'); } catch(e) {}
                window._patientOpened = null;
                window._contactHandled = null;
                window._soapPendingForContact = null;
            } else {
                window._patientOpened = null;
                window._contactHandled = null;
                window._soapPendingForContact = null;
            }
            window._embedStateReset = true;
        }
        // Only accept messages from Connect
        if (!event.origin.includes('connect') && !event.origin.includes('amazonaws.com')) return;
        
        var data = event.data;
        console.log('[CCP-EMBED] Message from Connect (type:', data && data.type, '; payload redacted)');
        
        if (!data || !data.event) return;
        
        switch(data.event) {
            case 'acknowledge':
                // Respond to Connect's handshake
                console.log('[CCP-EMBED] Sending acknowledge response to Connect');
                event.source.postMessage({ event: 'acknowledge', data: null }, event.origin);
                break;
                
            case 'update':
            case 'contact':
            case 'contactUpdate':
                // Contact data received from Connect
                console.log('[CCP-EMBED] Contact event received (payload redacted — may contain PHI)');
                if (data.data && data.data.contactId) {
                    handleConnectContactEvent(data.data);
                }
                break;
                
            case 'init':
            case 'initialized':
                console.log('[CCP-EMBED] Connect workspace initialized');
                break;
                
            case 'agent::update':
                // Agent state update — contains contacts in snapshot
                try {
                    var snapshot = data.data && data.data.snapshot;
                    if (snapshot && snapshot.contacts && snapshot.contacts.length > 0) {
                        snapshot.contacts.forEach(function(contact) {
                            var state = contact.state && contact.state.type;
                            var contactId = contact.contactId;
                            console.log('[CCP-EMBED] Contact in snapshot:', contactId, 'state:', state);
                            
                            if ((state === 'connecting' || state === 'connected') && contactId && !window._consultationEnded) {
                                // Extract patient_id from contact attributes
                                var attrs = contact.attributes || contact.contactAttributes || {};
                                var patientId = null;
                                
                                // Attributes might be {key: {value: "xxx"}} or {key: "xxx"}
                                if (attrs.patient_id) {
                                    patientId = attrs.patient_id.value || attrs.patient_id;
                                }
                                
                                console.log('[CCP-EMBED] Contact attributes received (keys:', Object.keys(attrs || {}).join(','), '; values redacted — PHI)');
                                console.log('[CCP-EMBED] Patient ID:', (patientId || '').substring(0, 8) + '...');
                                
                                if (patientId && !window._patientOpened) {
                                    // If previous SOAP was pending or consultation ended, reset UI for new call
                                    if (window._consultationEnded || window._soapPendingForContact) {
                                        console.log('[CCP-EMBED] New call — resetting from previous consultation/SOAP');
                                        var scheduleScreen = document.getElementById('scheduleScreen');
                                        if (scheduleScreen) scheduleScreen.classList.remove('hidden');
                                        var patientPortal = document.querySelector('.patient-portal-background');
                                        if (patientPortal) patientPortal.style.display = 'none';
                                        var previsitContainer = document.getElementById('previsitContainer');
                                        if (previsitContainer) previsitContainer.classList.remove('active');
                                        var soapOverlay = document.getElementById('soapNotesOverlay');
                                        if (soapOverlay) { soapOverlay.classList.remove('active'); soapOverlay.style.opacity = '0'; soapOverlay.style.visibility = 'hidden'; }
                                        window._consultationEnded = false;
                                        window._soapPendingForContact = null;
                                        try { localStorage.removeItem('consultationEnded'); localStorage.removeItem('soapPendingContact'); } catch(e) {}
                                    }

                                    window._patientOpened = contactId;
                                    window._contactHandled = contactId;
                                    window.currentStreamingSessionId = contactId;
                                    console.log('[CCP-EMBED] Patient ID extracted:', (patientId || '').substring(0, 8) + '...');
                                    // Write to localStorage so display iframe can pick it up
                                    try {
                                        localStorage.setItem('activePatient', JSON.stringify({
                                            patientId: patientId,
                                            contactId: contactId,
                                            timestamp: Date.now()
                                        }));
                                        console.log('[CCP-EMBED] Wrote activePatient to localStorage');
                                    } catch(e) { console.warn('[CCP-EMBED] localStorage write failed:', e); }

                                    // Retry loop — openPatient may not be defined yet if inline
                                    // script hasn't finished executing when first agent::update fires
                                    var _patientId = patientId;
                                    var _contactId = contactId;
                                    var _attempts = 0;
                                    var _tryOpen = function() {
                                        _attempts++;
                                        if (typeof window.openPatient === 'function') {
                                            console.log('[CCP-EMBED] Opening patient (attempt ' + _attempts + '): ID ' + (_patientId || '').substring(0, 8) + '...');
                                            window.openPatient(_patientId);
                                            startTranscriptPolling(_contactId);
                                        } else if (_attempts < 20) {
                                            console.log('[CCP-EMBED] openPatient not ready, retrying... (' + _attempts + ')');
                                            setTimeout(_tryOpen, 250);
                                        } else {
                                            console.warn('[CCP-EMBED] openPatient never became available after ' + _attempts + ' attempts');
                                        }
                                    };
                                    _tryOpen();
                                }
                            }
                            
                            // Detect call ended — schedule SOAP/codes refresh
                            // DO NOT set _consultationEnded here — let SOAP overlay persist
                            if (state === 'ended' && contactId && contactId === window._contactHandled) {
                                console.log('[CCP-EMBED] Contact ended:', contactId, '— keeping consultation active for SOAP display');
                                stopTranscriptPolling(contactId);
                                window._soapPendingForContact = contactId;
                                // Store the ended contact so SOAP fetchers can use it
                                try { localStorage.setItem('soapPendingContact', JSON.stringify({contactId: contactId, timestamp: Date.now()})); } catch(e) {}
                                if (typeof window.fetchAndDisplayStreamingOutputs === 'function') {
                                    function _showSoapEmbed() {
                                        var s = document.getElementById('soapNotesOverlay');
                                        if (s) { s.classList.add('active'); s.style.opacity = '1'; s.style.visibility = 'visible'; s.style.pointerEvents = 'auto'; }
                                    }
                                    setTimeout(function() { window.fetchAndDisplayStreamingOutputs(contactId).then(_showSoapEmbed).catch(_showSoapEmbed); }, 30000);
                                    setTimeout(function() { window.fetchAndDisplayStreamingOutputs(contactId).then(_showSoapEmbed).catch(_showSoapEmbed); }, 60000);
                                    setTimeout(function() { window.fetchAndDisplayStreamingOutputs(contactId).then(_showSoapEmbed).catch(_showSoapEmbed); }, 90000);
                                }
                                window._contactHandled = null;
                            }
                        });
                    }
                } catch(e) {
                    console.warn('[CCP-EMBED] Error parsing agent::update:', e);
                }
                break;
                
            case 'contact::view':
                // Connect tells us a contact is being viewed/active
                console.log('[CCP-EMBED] contact::view received, contactId:', data.data && data.data.contactId);
                var viewContactId = data.data && data.data.contactId;
                if (!viewContactId && (window._consultationEnded || window._soapPendingForContact)) {
                    console.log('[CCP-EMBED] Contact cleared — keeping consultation/SOAP view active');
                    break;
                }
                if (viewContactId && !window._contactHandled && !window._soapPendingForContact) {
                    window._contactHandled = viewContactId;
                    window.currentStreamingSessionId = viewContactId;
                    var patientKeys = Object.keys(window.PATIENT_INFO || {});
                    if (patientKeys.length > 0 && typeof window.openPatient === 'function') {
                        console.log('[CCP-EMBED] Opening patient for contact:', viewContactId);
                        window.openPatient(patientKeys[0]);
                        startTranscriptPolling(viewContactId);
                    }
                }
                break;
                
            default:
                console.log('[CCP-EMBED] Unknown event:', data.event);
        }
    });
    
    function handleConnectContactEvent(contactData) {
        console.log('[CCP-EMBED] Processing contact:', contactData.contactId);
        var patientId = null;
        
        if (contactData.attributes && contactData.attributes.patient_id) {
            patientId = contactData.attributes.patient_id;
        } else if (contactData.contactAttributes && contactData.contactAttributes.patient_id) {
            patientId = contactData.contactAttributes.patient_id;
        }
        
        if (patientId && typeof window.openPatient === 'function') {
            console.log('[CCP-EMBED] Opening patient:', patientId);
            window.openPatient(patientId);
            window.currentStreamingSessionId = contactData.contactId;
        }
    }

    // CCP URL — read from runtime config so this isn't hardcoded.
    // Set window.CCP_URL in config.js or via deployment-time substitution.
    const CCP_URL = (window.CCP_URL || 'https://REPLACE_WITH_YOUR_CONNECT_INSTANCE.my.connect.aws/ccp-v2');
    const BACKEND_URL = window.BACKEND_URL || '';
    const TRANSCRIPT_POLL_INTERVAL_MS = 2000;

    let initialized = false;
    let activePollers = {};
    let renderedSegmentKeys = {};

    function init() {
        if (initialized) return;
        // Demo mode: skip CCP entirely. There's no Amazon Connect instance
        // to embed when running locally without AWS — the iframe load would
        // fail with a CSP frame-ancestors error from the Connect domain.
        if (window.DEMO_MODE) {
            initialized = true;
            console.log('[CCP] Demo mode detected — skipping CCP iframe initialization');
            return;
        }
        if (typeof window.connect === 'undefined' || !window.connect.core) {
            setTimeout(init, 250);
            return;
        }
        var isEmbedded = (window.self !== window.top);
        if (isEmbedded) {
            initialized = true;
            console.log('[CCP] Embedded mode — using postMessage handler only (no initCCP)');
            return;
        }
        var c = document.getElementById('ccpContainer');
        if (!c) {
            setTimeout(init, 250);
            return;
        }
        try {
            window.connect.core.initCCP(c, {
                ccpUrl: CCP_URL,
                loginPopup: true,
                loginPopupAutoClose: true,
                softphone: { allowFramedSoftphone: true }
            });
            initialized = true;
            console.log('[CCP] init done (standalone mode)');
            window.connect.contact(handleContact);
        } catch (e) {
            console.error('[CCP] init failed', e);
        }
    }

    function handleContact(contact) {
        const cid = contact.getContactId();
        console.log('[CCP] contact', cid);
        let opened = false;

        contact.onConnecting(function () {
            if (opened) return;
            const attrs = contact.getAttributes() || {};
            const pid = attrs.patient_id && attrs.patient_id.value;
            if (!pid) {
                console.warn('[CCP] no patient_id on contact — chart will not auto-open');
                return;
            }
            console.log('[CCP] patient_id from contact:', pid);
            window.currentStreamingSessionId = cid;

            function tryOpenPatient() {
                const info = window.PATIENT_INFO || {};
                if (Object.keys(info).length === 0) {
                    console.log('[CCP] PATIENT_INFO not ready yet — retrying in 500ms');
                    setTimeout(tryOpenPatient, 500);
                    return;
                }
                if (typeof window.openPatient !== 'function') {
                    console.warn('[CCP] openPatient not defined — retrying in 500ms');
                    setTimeout(tryOpenPatient, 500);
                    return;
                }
                try {
                    console.log('[CCP] Calling openPatient with pid:', pid);
                    window.openPatient(pid);
                    opened = true;
                } catch (e) {
                    console.error('[CCP] openPatient threw:', e);
                }
            }
            tryOpenPatient();
        });

        contact.onConnected(function () {
            console.log('[CCP] connected — starting live transcript polling for', cid);
            startTranscriptPolling(cid);
            setTimeout(function () {
                try {
                    if (typeof window.startConsultation === 'function') {
                        console.log('[CCP] auto-opening consultation overlay');
                        window.startConsultation();
                    }
                    setTimeout(function () {
                        if (typeof window.toggleScribeTranscript === 'function' && !window.scribeTranscriptVisible) {
                            console.log('[CCP] auto-opening transcript panel');
                            window.toggleScribeTranscript();
                        }
                    }, 800);
                } catch (e) {
                    console.warn('[CCP] auto-open consultation failed', e);
                }
            }, 500);
        });

        contact.onEnded(function () {
            var pollerAge = (window._pollerStartTimes && window._pollerStartTimes[cid]) ? (Date.now() - window._pollerStartTimes[cid]) : 99999;
            if (pollerAge < 5000) {
                console.log("[CCP] onEnded fired too quickly (" + pollerAge + "ms) - ignoring for", cid);
                return;
            }
            console.log('[CCP] contact ended', cid);
            stopTranscriptPolling(cid);
            function _showSoap() {
                var s = document.getElementById('soapNotesOverlay');
                if (s) {
                    s.classList.add('active');
                    s.style.opacity = '1';
                    s.style.visibility = 'visible';
                    s.style.pointerEvents = 'auto';
                    console.log('[CCP] SOAP overlay forced visible');
                }
            }
            if (typeof window.fetchAndDisplayStreamingOutputs === 'function') {
                setTimeout(function () { window.fetchAndDisplayStreamingOutputs(cid).then(_showSoap).catch(_showSoap); }, 30000);
                setTimeout(function () { window.fetchAndDisplayStreamingOutputs(cid).then(_showSoap).catch(_showSoap); }, 60000);
                setTimeout(function () { window.fetchAndDisplayStreamingOutputs(cid).then(_showSoap).catch(_showSoap); }, 90000);
            }
        });
    }

    window.startTranscriptPollingGlobal = startTranscriptPolling;
    function startTranscriptPolling(sessionId) {
        if (activePollers[sessionId]) return;
        renderedSegmentKeys[sessionId] = new Set();

        const tick = function () {
            fetch(`${BACKEND_URL}/api/streaming/session/${encodeURIComponent(sessionId)}/live-transcript`)
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (!data || !data.success) return;
                    const segs = data.segments || [];
                    const seen = renderedSegmentKeys[sessionId];
                    if (!seen) return;
                    for (let i = 0; i < segs.length; i++) {
                        const seg = segs[i];
                        const key = seg.ts + ':' + seg.text;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        if (typeof window.addTranscriptEntry === 'function') {
                            try {
                                window.addTranscriptEntry(seg.text, !!seg.final);
                            } catch (e) {
                                console.warn('[CCP] addTranscriptEntry failed', e);
                            }
                        } else {
                            console.log('[CCP] transcript segment (length=' + (seg.text || '').length + ' chars;', seg.final ? '(final)' : '(partial)', '; content redacted — PHI)');
                        }
                    }
                })
                .catch(function (err) {
                    console.warn('[CCP] transcript poll error', err);
                });
        };
        tick();
        var intervalId = setInterval(tick, TRANSCRIPT_POLL_INTERVAL_MS);
        activePollers[sessionId] = intervalId;
        if (!window._pollerStartTimes) window._pollerStartTimes = {};
        window._pollerStartTimes[sessionId] = Date.now();
        console.log('[CCP] polling /live-transcript every', TRANSCRIPT_POLL_INTERVAL_MS, 'ms for', sessionId);
    }

    function stopTranscriptPolling(sessionId) {
        if (activePollers[sessionId]) {
            clearInterval(activePollers[sessionId]);
            delete activePollers[sessionId];
            console.log('[CCP] stopped polling for', sessionId);
        }
        delete renderedSegmentKeys[sessionId];
    }

    document.addEventListener('DOMContentLoaded', init);
})();
