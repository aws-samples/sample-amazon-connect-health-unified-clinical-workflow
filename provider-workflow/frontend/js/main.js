// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
// nosemgrep: insecure-document-method, insecure-innerhtml, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring, missing-template-string-indicator
// Justification: innerHTML/template-string assignments render data from trusted AWS APIs
// (HealthLake, Patient Insights, Bedrock, S3 streaming outputs) — not user input.
// All user-controlled values are wrapped with escapeHtml(). RegExp is built from
// trusted API text (SOAP note content), not user input. console.log format strings
// are developer diagnostics, not attacker-controlled.
// The one user-editable path (SOAP notes edit mode) is sanitized via DOMPurify on save,
// with a fail-closed fallback that strips all HTML if DOMPurify is unavailable.
// See editSoapNotes() for the sanitization implementation.

// ==========================================================================
// DEMO MODE — Fetch Interceptor
// Automatically adds X-Demo-Mode header to all API calls when demo mode is on.
// This avoids modifying every individual fetch() call in the codebase.
// ==========================================================================
(function() {
    const _originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (window.DEMO_MODE && typeof url === 'string' && url.includes('/api/')) {
            options = options || {};
            options.headers = options.headers || {};
            if (options.headers instanceof Headers) {
                options.headers.set('X-Demo-Mode', 'true');
            } else {
                options.headers['X-Demo-Mode'] = 'true';
            }
        }
        return _originalFetch.call(this, url, options);
    };
})();

/**
 * Escape HTML special characters to prevent XSS when interpolating
 * untrusted data (API responses, user input) into innerHTML templates.
 * @param {string} str - The untrusted string
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

'use strict';



// Test if script is loading

console.log('Script loaded successfully');



// ==========================================================================

// GLOBAL VARIABLES

// ==========================================================================

let isDragging = false;

let isResizing = false;

let isMinimized = false;

let isMaximized = false;

let startX, startY, startLeft, startTop, startWidth, startHeight;

let originalState = {};

// Store the current streaming session ID for fetching S3 outputs
let currentStreamingSessionId = null;

// Store the S3 outputs from the streaming session
let streamingSessionOutputs = null;

// Default state for snap back

const defaultState = {

    width: '30vw',

    transform: 'translateX(0)',

    right: '0'

};


// DOM Elements - will be initialized after DOM loads

let container, header, resizeHandle, toggleBtn;


// ==========================================================================

// INITIALIZATION

// ==========================================================================

document.addEventListener('DOMContentLoaded', function() {

    // Initialize DOM element references

    container = document.getElementById('previsitContainer');

    header = document.getElementById('previsitHeader');

    resizeHandle = document.getElementById('resizeHandle');

    toggleBtn = document.getElementById('toggleBtn');

    

    initializeApp();

});


function initializeApp() {

    // Ensure correct initial visibility

    const scheduleScreen = document.getElementById('scheduleScreen');

    const previsitContainer = document.getElementById('previsitContainer');

    const patientPortal = document.querySelector('.patient-portal-background');

    

    // Show schedule screen, hide iframe and patient portal on load

    if (scheduleScreen) {

        scheduleScreen.classList.remove('hidden');

    }

    if (previsitContainer) {

        previsitContainer.classList.remove('active');

    }

    if (patientPortal) {

        patientPortal.style.display = 'none';

    }

    

    // Ensure patient avatar is always visible

    const patientAvatar = document.querySelector('.patient-avatar');

    const patientAvatarImg = document.querySelector('.patient-avatar img');

    if (patientAvatar) {

        patientAvatar.style.display = 'flex';

        patientAvatar.style.visibility = 'visible';

        patientAvatar.style.opacity = '1';

    }

    if (patientAvatarImg) {

        patientAvatarImg.style.display = 'block';

        patientAvatarImg.style.visibility = 'visible';

        patientAvatarImg.style.opacity = '1';

    }

    

    storeOriginalState();

    setupEventListeners();

    initializePatientChatInput();

    initializeConsultationOverlay();

    initializeSize2Dragging();

}


function storeOriginalState() {

    const rect = container.getBoundingClientRect();

    originalState = {

        top: container.style.top || '120px',

        right: container.style.right || '0px',

        width: container.style.width || '30vw',

        height: container.style.height || 'calc(100vh - 120px)'

    };

}


// ==========================================================================

// EVENT LISTENERS

// ==========================================================================

function setupEventListeners() {

    // Pop-out button

    const popoutBtn = document.getElementById('popoutBtn');

    if (popoutBtn) {

        popoutBtn.addEventListener('click', function(e) {

            e.preventDefault();

            e.stopPropagation();

            togglePopout();

        });

    }


    // Backdrop click to close popout

    const backdrop = document.getElementById('popoutBackdrop');

    if (backdrop) {

        backdrop.addEventListener('click', function(e) {

            if (isPopedOut) {

                popInToPortal();

            }

        });

    }


    // Minimize button

    if (toggleBtn) {

        toggleBtn.addEventListener('click', function(e) {

            e.preventDefault();

            e.stopPropagation();

            toggleMinimize();

        });

    }

    

    // Dragging functionality (header only)

    header.addEventListener('mousedown', startDragging);

    

    // Resizing functionality (gradient border)

    container.addEventListener('mousedown', startResizing);

    

    document.addEventListener('mousemove', handleMouseMove);

    document.addEventListener('mouseup', stopDraggingAndResizing);


    // Header interactions

    header.addEventListener('dblclick', handleHeaderDoubleClick);

    header.addEventListener('click', handleHeaderClick);

    

    // Double-click on container to snap back to default

    container.addEventListener('dblclick', snapToDefault);


    // Keyboard shortcuts

    document.addEventListener('keydown', handleKeyboardShortcuts);


    // Prevent text selection while dragging

    document.addEventListener('selectstart', preventTextSelection);


    // Auto-focus and bring to front on click

    container.addEventListener('mousedown', bringToFront);


    // Chat functionality

    setupChatEventListeners();


    // Consultation overlay functionality

    setupConsultationEventListeners();

}


function setupChatEventListeners() {

    const chatOverlay = document.getElementById('chatOverlay');

    const chatInput = document.querySelector('.chat-input');

    const chatSend = document.querySelector('.chat-send');


    // Close chat when clicking outside

    chatOverlay.addEventListener('click', function(e) {

        if (e.target === this) {

            toggleChat();

        }

    });


    // Handle chat input

    chatInput.addEventListener('keypress', function(e) {

        if (e.key === 'Enter') {

            sendMessage();

        }

    });


    chatSend.addEventListener('click', sendMessage);

}


function setupConsultationEventListeners() {

    const consultationOverlay = document.getElementById('consultationOverlay');

    const scribeInterface = document.querySelector('.scribe-interface');

    

    // Minimize consultation when clicking outside the interface

    consultationOverlay.addEventListener('click', function(e) {

        if (e.target === this && !consultationOverlay.classList.contains('minimized')) {

            minimizeConsultation();

        }

    });


    // Restore consultation when clicking on minimized overlay

    consultationOverlay.addEventListener('click', function(e) {

        if (consultationOverlay.classList.contains('minimized')) {

            restoreConsultation();

        }

    });


    // Prevent clicks inside the interface from bubbling up

    if (scribeInterface) {

        scribeInterface.addEventListener('click', function(e) {

            e.stopPropagation();

        });

    }

}


function minimizeConsultation() {

    const overlay = document.getElementById('consultationOverlay');

    if (overlay && isConsultationActive) {

        overlay.classList.add('minimized');

        

        // Allow body scrolling when minimized

        document.body.style.overflow = '';

    }

}


function minimizeConsultationOverlay() {

    const overlay = document.getElementById('consultationOverlay');

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    const backdrop = document.getElementById('consultationBackdrop');

    

    if (overlay) {

        // Hide size 1 overlay

        overlay.classList.remove('active');

        backdrop.classList.remove('active');

        

        // Show size 2 overlay

        overlaySize2.classList.add('active');

    }

}


function closeConsultationOverlaySize2() {

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (overlaySize2) {

        overlaySize2.classList.remove('active');

    }

}


function expandToSize1() {

    const overlay = document.getElementById('consultationOverlay');

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    const backdrop = document.getElementById('consultationBackdrop');

    

    if (overlay && overlaySize2) {

        // Hide size 2 overlay

        overlaySize2.classList.remove('active');

        

        // Show size 1 overlay

        overlay.classList.add('active');

        backdrop.classList.add('active');

    }

}


// ==========================================================================

// FLAG A MOMENT FUNCTIONALITY

// ==========================================================================

let flaggedMoments = [];

let flagCounter = 0;


function flagMoment() {

    if (!isConsultationActive) {

        return;

    }


    const currentTime = new Date();

    const consultationDuration = currentTime - consultationStartTime - pausedDuration;

    const flagButtonSize2 = document.querySelector('.consultation-overlay-size2 .flag-btn');

    const flagButtonSize1 = document.querySelector('.scribe-control-btn.flag');

    

    // Create flag moment object

    const flaggedMoment = {

        id: ++flagCounter,

        timestamp: currentTime,

        consultationTime: consultationDuration,

        clipStart: Math.max(0, consultationDuration - 10000), // 10 seconds before

        clipEnd: consultationDuration + 10000, // 10 seconds after (20 second total clip)

        formattedTime: formatTime(consultationDuration),

        note: '' // Can be added later

    };


    // Add to flagged moments array

    flaggedMoments.push(flaggedMoment);


    // Update counter on both buttons

    updateFlagCounter();


    // Visual feedback for both size 1 and size 2 overlays

    if (flagButtonSize2) {

        flagButtonSize2.classList.add('flagged');

        setTimeout(() => {

            flagButtonSize2.classList.remove('flagged');

        }, 300);

    }


    if (flagButtonSize1) {

        flagButtonSize1.classList.add('flagged');

        setTimeout(() => {

            flagButtonSize1.classList.remove('flagged');

        }, 300);

    }


    // Show brief notification

    showFlagNotification(flaggedMoment);

}


function updateFlagCounter() {

    const flagButtonSize2 = document.querySelector('.consultation-overlay-size2 .flag-btn');

    const flagButtonSize1 = document.querySelector('.scribe-control-btn.flag');

    const count = flaggedMoments.length;


    // Update size 2 overlay button

    if (flagButtonSize2) {

        flagButtonSize2.setAttribute('data-flag-count', count);

        if (count > 0) {

            flagButtonSize2.title = `Flag a Moment (${count} flagged)`;

        } else {

            flagButtonSize2.title = 'Flag a Moment';

        }

    }


    // Update size 1 overlay button

    if (flagButtonSize1) {

        flagButtonSize1.setAttribute('data-flag-count', count);

        if (count > 0) {

            flagButtonSize1.title = `Flag a Moment (${count} flagged)`;

        } else {

            flagButtonSize1.title = 'Flag a Moment';

        }

    }

}


function clearFlaggedMoments() {

    flaggedMoments = [];

    flagCounter = 0;

    updateFlagCounter(); // Reset counter display

}


// Keyboard shortcut for Flag a Moment (Spacebar)

document.addEventListener('keydown', function(event) {

    // Check if spacebar is pressed

    if (event.code === 'Space' || event.keyCode === 32) {

        // Don't trigger if user is typing in an input or textarea

        const activeElement = document.activeElement;

        const isInputField = activeElement && (

            activeElement.tagName === 'INPUT' || 

            activeElement.tagName === 'TEXTAREA' || 

            activeElement.isContentEditable

        );

        

        // Only trigger if consultation is active and not typing

        if (!isInputField && isConsultationActive) {

            event.preventDefault(); // Prevent page scroll

            flagMoment();

        }

    }

});


function showFlagNotification(flaggedMoment) {

    // Determine which overlay is active and show notification on that overlay

    const consultationOverlay = document.getElementById('consultationOverlay');

    const consultationOverlaySize2 = document.getElementById('consultationOverlaySize2');

    

    let targetOverlay = null;

    let notificationClass = '';

    let contentClass = '';

    

    // Check which overlay is active

    if (consultationOverlay && consultationOverlay.classList.contains('active')) {

        targetOverlay = consultationOverlay;

        notificationClass = 'flag-notification-size1';

        contentClass = 'flag-notification-size1-content';

    } else if (consultationOverlaySize2 && consultationOverlaySize2.classList.contains('active')) {

        targetOverlay = consultationOverlaySize2;

        notificationClass = 'flag-notification-size2';

        contentClass = 'flag-notification-size2-content';

    }

    

    if (!targetOverlay) return;


    // Create notification element

    const notification = document.createElement('div');

    notification.className = notificationClass;

    // nosemgrep: insecure-innerhtml — static SVG + escapeHtml on the only dynamic value (formattedTime)
    const _html1 = `

        <div class="${contentClass}">

            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>

                <line x1="4" y1="22" x2="4" y2="15"/>

            </svg>

            <span>Moment flagged at ${escapeHtml(flaggedMoment.formattedTime)}</span>

        </div>

    `;
    notification.innerHTML = _html1; // nosemgrep: insecure-innerhtml, insecure-document-method


    // Add to the appropriate overlay

    // The overlay already has proper positioning context, no need to change it

    targetOverlay.appendChild(notification);


    // Animate in

    setTimeout(() => {

        notification.classList.add('show');

    }, 10);


    // Remove after 3 seconds

    setTimeout(() => {

        notification.classList.remove('show');

        setTimeout(() => {

            if (notification.parentNode) {

                notification.parentNode.removeChild(notification);

            }

        }, 300);

    }, 3000);

}


function formatTime(milliseconds) {

    const minutes = Math.floor(milliseconds / 60000);

    const seconds = Math.floor((milliseconds % 60000) / 1000);

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

}


// =================================================================
// SCRIBE SIDEBAR TOGGLES
// =================================================================

let scribeTranscriptVisible = false;
window.scribeTranscriptVisible = scribeTranscriptVisible;
let scribePrioritiesVisible = false;
let scribeTranscriptEntries = [];

function toggleScribeTranscript() {
    scribeTranscriptVisible = !scribeTranscriptVisible;
    window.scribeTranscriptVisible = scribeTranscriptVisible;
    const panel = document.getElementById('transcriptPanel');
    const btn = document.getElementById('toggleTranscriptBtn');
    if (panel) panel.style.display = scribeTranscriptVisible ? 'flex' : 'none';
    if (btn) btn.classList.toggle('active', scribeTranscriptVisible);
    updateSidebarVisibility();
}

function toggleScribePriorities() {
    scribePrioritiesVisible = !scribePrioritiesVisible;
    const panel = document.getElementById('prioritiesPanel');
    const btn = document.getElementById('togglePrioritiesBtn');
    if (panel) panel.style.display = scribePrioritiesVisible ? 'flex' : 'none';
    if (btn) btn.classList.toggle('active', scribePrioritiesVisible);
    if (scribePrioritiesVisible) populateScribePriorities();
    updateSidebarVisibility();
}

function updateSidebarVisibility() {
    const sidebar = document.getElementById('scribeSidebar');
    if (sidebar) {
        if (scribeTranscriptVisible || scribePrioritiesVisible) {
            sidebar.classList.add('visible');
            document.body.classList.add('scribe-active');
        } else {
            sidebar.classList.remove('visible');
            document.body.classList.remove('scribe-active');
        }
    }
}

function addTranscriptEntry(text, isFinal) {
    const content = document.getElementById('transcriptContent');
    if (!content) return;
    
    // Remove placeholder
    const placeholder = content.querySelector('.transcript-placeholder');
    if (placeholder) placeholder.remove();
    
    // Remove previous partial entry
    const partial = content.querySelector('.transcript-partial');
    if (partial) partial.remove();
    
    if (isFinal && text.trim()) {
        const elapsed = consultationStartTime ? Date.now() - consultationStartTime - pausedDuration : 0;
        const timeStr = formatTime(elapsed);
        const entry = document.createElement('div');
        entry.className = 'transcript-entry';
        const textDiv = document.createElement('div');
        textDiv.className = 'transcript-entry-text';
        textDiv.textContent = text;
        const timeDiv = document.createElement('div');
        timeDiv.className = 'transcript-entry-time';
        timeDiv.textContent = timeStr;
        entry.appendChild(textDiv);
        entry.appendChild(timeDiv);
        content.appendChild(entry);
        content.scrollTop = content.scrollHeight;
    } else if (!isFinal && text.trim()) {
        const partial = document.createElement('div');
        partial.className = 'transcript-entry transcript-partial';
        const partialText = document.createElement('div');
        partialText.className = 'transcript-entry-text';
        partialText.textContent = text;
        partial.appendChild(partialText);
        content.appendChild(partial);
        content.scrollTop = content.scrollHeight;
    }
}

function populateScribePriorities() {
    const content = document.getElementById('prioritiesContent');
    if (!content) return;
    
    // Strip evidence markers from text
    function stripRefs(text) {
        if (!text) return '';
        return text.replace(/\[REF\d+\]/g, '').replace(/\[\/REF\d+\]/g, '');
    }
    
    // Try to get priorities from the iframe's Bedrock response
    const iframe = document.getElementById('previsitIframe');
    let priorities = null;
    try {
        if (window._bedrockPriorities) {
            priorities = window._bedrockPriorities;
        }
    } catch(e) {}
    
    if (!priorities) {
        content.innerHTML = '<div class="transcript-placeholder">Priorities will appear after patient data loads</div>';
        return;
    }
    
    let html = '';
    let idx = 0;

    if (priorities.mustAddress && priorities.mustAddress.length > 0) {
        html += '<div class="priority-subsection-header">TODAY\'S VISIT — MUST ADDRESS</div>';
        priorities.mustAddress.forEach(p => {
            idx++;
            const title = stripRefs(p.title || (typeof p === 'string' ? p : ''));
            const desc = stripRefs(p.description || '');
            // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            html += `<div class="priority-check-item high" id="priCard${idx}">
                <input type="checkbox" id="priCheck${idx}" onchange="document.getElementById('priCard${idx}').classList.toggle('checked-off', this.checked)">
                <div class="priority-check-content">
                    <div class="priority-check-title">${escapeHtml(title)}</div>
                    ${desc ? `<div class="priority-check-desc">${escapeHtml(desc)}</div>` : ''}
                </div>
            </div>`;
        });
    }

    if (priorities.outstanding && priorities.outstanding.length > 0) {
        html += '<div class="priority-subsection-header">ONGOING MANAGEMENT — DISCUSS &amp; ADJUST</div>';
        priorities.outstanding.forEach(p => {
            idx++;
            const title = stripRefs(p.title || (typeof p === 'string' ? p : ''));
            const desc = stripRefs(p.description || '');
            // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            html += `<div class="priority-check-item moderate" id="priCard${idx}">
                <input type="checkbox" id="priCheck${idx}" onchange="document.getElementById('priCard${idx}').classList.toggle('checked-off', this.checked)">
                <div class="priority-check-content">
                    <div class="priority-check-title">${escapeHtml(title)}</div>
                    ${desc ? `<div class="priority-check-desc">${escapeHtml(desc)}</div>` : ''}
                </div>
            </div>`;
        });
    }

    if (idx === 0) {
        content.textContent = 'No priorities available';
        return;
    }

    content.innerHTML = html; // nosemgrep: insecure-innerhtml, insecure-document-method — all dynamic values passed through escapeHtml()
}

function resetScribeSidebar() {
    scribeTranscriptVisible = false;
    scribePrioritiesVisible = false;
    const sidebar = document.getElementById('scribeSidebar');
    const tp = document.getElementById('transcriptPanel');
    const pp = document.getElementById('prioritiesPanel');
    const tb = document.getElementById('toggleTranscriptBtn');
    const pb = document.getElementById('togglePrioritiesBtn');
    const tc = document.getElementById('transcriptContent');
    if (sidebar) sidebar.classList.remove('visible');
            document.body.classList.remove('scribe-active');
    if (tp) tp.style.display = 'none';
    if (pp) pp.style.display = 'none';
    if (tb) tb.classList.remove('active');
    if (pb) pb.classList.remove('active');
    if (tc) tc.innerHTML = '<div class="transcript-placeholder">Waiting for speech...</div>';
}


function getFlaggedMoments() {

    return flaggedMoments;

}


// ==========================================================================

// EHR SAVE NOTIFICATION & COMPLETION OVERLAY

// ==========================================================================

function showEHRSaveNotification() {

    const soapOverlay = document.getElementById('soapNotesOverlay');

    if (!soapOverlay) return;


    // Create notification element

    const notification = document.createElement('div');

    notification.className = 'ehr-save-notification';

    notification.innerHTML = `

        <div class="ehr-save-notification-content">

            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>

                <polyline points="22 4 12 14.01 9 11.01"/>

            </svg>

            <span>Documentation saved</span>

        </div>

    `;


    soapOverlay.appendChild(notification);


    // Animate in

    setTimeout(() => {

        notification.classList.add('show');

    }, 10);


    // Remove after 2 seconds

    setTimeout(() => {

        notification.classList.remove('show');

        setTimeout(() => {

            if (notification.parentNode) {

                notification.parentNode.removeChild(notification);

            }

        }, 300);

    }, 2000);

}


function showCompletionOverlay() {

    // Remove ALL chat and avatar elements completely

    const elementsToHide = [

        '.patient-chat-container',

        '.ai-avatar',

        '.ai-pulse-avatar',

        '.chat-header',

        '.chat-container'

    ];

    

    elementsToHide.forEach(selector => {

        const elements = document.querySelectorAll(selector);

        elements.forEach(el => {

            el.style.display = 'none';

            el.style.visibility = 'hidden';

            el.style.opacity = '0';

        });

    });

    

    // Smooth transition: fade out SOAP overlay first

    const soapOverlay = document.getElementById('soapNotesOverlay');

    if (soapOverlay && soapOverlay.classList.contains('active')) {

        soapOverlay.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)';

        soapOverlay.style.opacity = '0';

        soapOverlay.style.transform = 'scale(0.98)';

        

        setTimeout(() => {

            soapOverlay.classList.remove('active');

            soapOverlay.style.opacity = '';

            soapOverlay.style.transform = '';

            

            // Show patient notes overlay

            const patientNotesOverlay = document.getElementById('patientNotesOverlay');

            if (patientNotesOverlay) {

                patientNotesOverlay.classList.add('active');

                // Fetch and populate with real API data

                fetchAndPopulatePatientVisitSummary();

            }

        }, 800);

    } else {

        // Show patient notes directly if no SOAP overlay

        const patientNotesOverlay = document.getElementById('patientNotesOverlay');

        if (patientNotesOverlay) {

            patientNotesOverlay.classList.add('active');

            // Fetch and populate with real API data

            fetchAndPopulatePatientVisitSummary();

        }

    }

}


// ==========================================================================

// HELPER FUNCTIONS FOR COMPLETION OVERLAY

// ==========================================================================



/**

 * Animates smooth scroll to center a section in the viewport

 * @param {HTMLElement} container - The scrollable container

 * @param {HTMLElement} section - The section to scroll to

 * @param {number} duration - Animation duration in milliseconds

 */

function animateScrollToSection(container, section, duration) {

    // Calculate target scroll position (center the section)

    const containerHeight = container.clientHeight;

    const sectionTop = section.offsetTop;

    const sectionHeight = section.offsetHeight;

    const targetScroll = sectionTop - (containerHeight / 2) + (sectionHeight / 2);

    

    // Custom slow, smooth scroll animation

    const startScroll = container.scrollTop;

    const distance = targetScroll - startScroll;

    let startTime = null;

    

    function smoothScroll(currentTime) {

        if (!startTime) startTime = currentTime;

        const elapsed = currentTime - startTime;

        const progress = Math.min(elapsed / duration, 1);

        

        // Ease-in-out cubic for smooth acceleration and deceleration

        const easeProgress = progress < 0.5

            ? 4 * progress * progress * progress

            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        

        container.scrollTop = startScroll + (distance * easeProgress);

        

        if (progress < 1) {

            requestAnimationFrame(smoothScroll);

        }

    }

    

    requestAnimationFrame(smoothScroll);

}


// ==========================================================================

// COMPLETION OVERLAY FUNCTIONS

// ==========================================================================



function showFinalCompletionOverlay() {

    // STEP 1: Hide the entire iframe container

    const previsitContainer = document.getElementById('previsitContainer');

    if (previsitContainer) {

        previsitContainer.style.zIndex = '-1';

        previsitContainer.style.opacity = '0';

        previsitContainer.style.pointerEvents = 'none';

    }
    
    // Fetch and display After Visit Summary
    fetchAndDisplayAfterVisitSummary();
    
    // Initialize SMS section
    initializeSMSSection();
    
    // Populate dynamic billing codes and follow-up from API data
    populateDynamicCompletionData();

    

    // STEP 2: NUCLEAR OPTION - Remove ALL avatar and pulse elements from DOM completely

    const selectorsToRemove = [

        '.ai-avatar',

        '.ai-pulse-avatar',

        '.chat-header',

        '.patient-chat-container',

        '[class*="pulse"]',

        '[class*="avatar"]',

        '.chat-container'

    ];

    

    selectorsToRemove.forEach(selector => {

        const elements = document.querySelectorAll(selector);

        elements.forEach(el => {

            // Don't remove elements inside completion overlay

            if (!el.closest('.completion-overlay') && !el.closest('#completionOverlay')) {

                el.remove(); // Completely remove from DOM

            }

        });

    });

    

    // Hide patient notes overlay with smooth fade

    const patientNotesOverlay = document.getElementById('patientNotesOverlay');

    if (patientNotesOverlay) {

        patientNotesOverlay.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)';

        patientNotesOverlay.style.opacity = '0';

        patientNotesOverlay.style.transform = 'scale(0.98)';

        

        setTimeout(() => {

            patientNotesOverlay.classList.remove('active');

            patientNotesOverlay.style.opacity = '';

            patientNotesOverlay.style.transform = '';

        }, 800);

    }

    

    // Show final completion overlay with progressive disclosure animation

    setTimeout(() => {

        const completionOverlay = document.getElementById('completionOverlay');

        if (!completionOverlay) return;

        

        // Get all elements

        const completionTitle = document.getElementById('completionTitle');

        const completionSubtitle = document.getElementById('completionSubtitle');

        const completionSpinner = document.getElementById('completionSpinner');

        const completionCheckmark = document.getElementById('completionCheckmark');

        const checklistItems = completionOverlay.querySelectorAll('.processing-step');

        const followupSection = completionOverlay.querySelector('.completion-section:last-child');

        const confettiElements = completionOverlay.querySelectorAll('.confetti');

        

        // Reset all states before starting animation

        if (completionSpinner) {

            completionSpinner.style.display = 'flex';

            completionSpinner.style.opacity = '1';

        }

        if (completionCheckmark) {

            completionCheckmark.style.display = 'none';

            completionCheckmark.style.opacity = '0';

            completionCheckmark.classList.remove('animate');

        }

        if (completionTitle) {

            completionTitle.textContent = 'Finalizing Documentation...';

            completionTitle.classList.remove('celebration-title');

            completionTitle.style.opacity = '1';

            completionTitle.style.transform = 'scale(1)';

        }

        if (completionSubtitle) {

            completionSubtitle.textContent = 'Saving clinical notes to the EHR';

            completionSubtitle.style.opacity = '1';

        }

        if (followupSection) {

            followupSection.style.opacity = '0';

            followupSection.style.transform = 'translateY(20px)';

            followupSection.style.pointerEvents = 'none';

        }

        

        // Reset checklist items

        checklistItems.forEach(item => {

            item.classList.remove('active', 'completed');

            const stepIcon = item.querySelector('.step-icon');

            if (stepIcon) {

                stepIcon.innerHTML = '<div class="step-spinner"></div>';

            }

        });

        

        // Show overlay

        completionOverlay.classList.add('active');

        completionOverlay.style.zIndex = '999999';

        

        // ANIMATION SEQUENCE

        const ANIMATION_DELAYS = {

            INITIAL: 800,

            ITEM_PROCESSING: 1000,

            ITEM_INTERVAL: 1200,

            FOLLOWUP_APPEAR: 500,

            SCROLL_START: 400,

            SCROLL_DURATION: 1800,

            CELEBRATION: 700,

            TITLE_TRANSITION: 300

        };

        

        let currentDelay = ANIMATION_DELAYS.INITIAL;

        

        // PHASE 1: Animate checklist items sequentially

        checklistItems.forEach((item) => {

            // Show item as active (processing with purple spinner)

            setTimeout(() => {

                item.classList.add('active');

            }, currentDelay);

            

            // Mark as completed after processing time

            setTimeout(() => {

                item.classList.remove('active');

                item.classList.add('completed');

                

                // Replace spinner with checkmark

                const stepIcon = item.querySelector('.step-icon');

                if (stepIcon) {

                    stepIcon.innerHTML = `

                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                            <polyline points="20 6 9 17 4 12"/>

                        </svg>

                    `;

                }

            }, currentDelay + ANIMATION_DELAYS.ITEM_PROCESSING);

            

            currentDelay += ANIMATION_DELAYS.ITEM_INTERVAL;

        });

        

        // PHASE 2: Show follow-up section after all checks complete

        const followupDelay = currentDelay + ANIMATION_DELAYS.FOLLOWUP_APPEAR;

        setTimeout(() => {

            if (followupSection) {

                followupSection.style.transition = 'all 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)';

                followupSection.style.opacity = '1';

                followupSection.style.transform = 'translateY(0)';

                followupSection.style.pointerEvents = 'auto';

                

                // Slow, smooth scroll to bring scheduling section into focus

                setTimeout(() => {

                    const completionContent = completionOverlay.querySelector('.completion-content');

                    if (completionContent && followupSection) {

                        animateScrollToSection(completionContent, followupSection, ANIMATION_DELAYS.SCROLL_DURATION);

                    }

                }, ANIMATION_DELAYS.SCROLL_START);

            }

        }, followupDelay);

        

        // PHASE 3: Celebrate! (after follow-up appears)

        const celebrationDelay = followupDelay + ANIMATION_DELAYS.CELEBRATION;

        setTimeout(() => {

            // Hide spinner with fade

            if (completionSpinner) {

                completionSpinner.style.transition = 'opacity 0.3s ease';

                completionSpinner.style.opacity = '0';

                setTimeout(() => {

                    completionSpinner.style.display = 'none';

                }, ANIMATION_DELAYS.TITLE_TRANSITION);

            }

            

            // Show checkmark with bounce animation

            if (completionCheckmark) {

                completionCheckmark.style.display = 'flex';

                setTimeout(() => {

                    completionCheckmark.classList.add('animate');

                }, 50);

            }

            

            // Update title with smooth transition

            if (completionTitle) {

                completionTitle.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

                completionTitle.style.opacity = '0';

                completionTitle.style.transform = 'scale(0.95)';

                

                setTimeout(() => {

                    completionTitle.textContent = 'Documentation Complete';

                    completionTitle.classList.add('celebration-title');

                    completionTitle.style.opacity = '1';

                    completionTitle.style.transform = 'scale(1)';

                }, ANIMATION_DELAYS.TITLE_TRANSITION);

            }

            

            // Update subtitle

            if (completionSubtitle) {

                completionSubtitle.style.transition = 'opacity 0.3s ease';

                completionSubtitle.style.opacity = '0';

                

                setTimeout(() => {

                    completionSubtitle.textContent = 'All clinical documentation has been saved to the EHR';

                    completionSubtitle.style.opacity = '1';

                }, 300);

            }

            

            // PHASE 3.5: Subtle visual anchor for "Documentation Complete"

            setTimeout(() => {

                const completionHeader = completionOverlay.querySelector('.completion-header');

                

                if (completionHeader) {

                    // Add anchored class for the gradient line effect

                    completionHeader.classList.add('anchored');

                }

            }, 800);

            

            // PHASE 4: Trigger confetti animation

            setTimeout(() => {

                confettiElements.forEach(confetti => {

                    confetti.style.animation = 'confettiFall 1.5s ease-out forwards';

                });

            }, 500);

        }, celebrationDelay);

    }, 500);

}


function closePatientNotesOverlay() {

    const patientNotesOverlay = document.getElementById('patientNotesOverlay');

    if (patientNotesOverlay) {

        patientNotesOverlay.classList.remove('active');

    }

}


function closeCompletionOverlay() {

    const completionOverlay = document.getElementById('completionOverlay');

    if (completionOverlay) {

        completionOverlay.classList.remove('active');

    }

    

    // Small delay to ensure CSS transitions complete

    setTimeout(() => {

        // Keep schedule screen hidden (stay on patient portal)

        const scheduleScreen = document.getElementById('scheduleScreen');

        if (scheduleScreen) {

            scheduleScreen.classList.add('hidden');

        }

        

        // Inject clinical documentation into EHR body
        injectClinicalDocIntoEHR();
        // Inject medical codes into sidebar
        injectMedicalCodesIntoSidebar();

        // FIX: Clear the right panel SOAP view so the live "Approve & Save"
        // button is removed — workflow is complete, nothing left to approve.
        markRightPanelComplete();

        // Keep the iframe container visible (show patient portal with iframe)

        const previsitContainer = document.getElementById('previsitContainer');

        if (previsitContainer) {

            previsitContainer.classList.add('active');

            previsitContainer.style.display = 'block';

            previsitContainer.style.visibility = 'visible';

            previsitContainer.style.opacity = '1';

            previsitContainer.style.zIndex = '1000';

        }

        

        // Ensure patient avatar is visible

        const patientAvatar = document.querySelector('.patient-avatar');

        const patientAvatarImg = document.querySelector('.patient-avatar img');

        if (patientAvatar) {

            patientAvatar.style.display = 'flex';

            patientAvatar.style.visibility = 'visible';

            patientAvatar.style.opacity = '1';

        }

        if (patientAvatarImg) {

            patientAvatarImg.style.display = 'block';

            patientAvatarImg.style.visibility = 'visible';

            patientAvatarImg.style.opacity = '1';

        }

        

        // Disable the Start Consultation button

        const startBtn = document.querySelector('.start-consultation-btn');

        if (startBtn) {

            startBtn.classList.add('disabled-state');

            startBtn.disabled = true;

            startBtn.innerHTML = `

                <svg class="consultation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                    <polyline points="20 6 9 17 4 12"/>

                </svg>

                Consultation Completed

            `;

        }

    }, 100);

}


function markRightPanelComplete() {
    // Called after the full workflow completes (approve → visit summary → confetti → close).
    // Replaces the right panel SOAP view (which contains a live "Approve & Save" button)
    // with a read-only "Documentation Complete" state.  Prevents the user from being
    // looped back into the approval step when the panel is still visible.
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;

    // Only replace if it still contains the inline SOAP editor (has .soap-notes-inline)
    if (!rightPanel.querySelector('.soap-notes-inline')) return;

    rightPanel.innerHTML = `
        <div class="soap-complete-panel">
            <div class="soap-complete-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     width="48" height="48" style="color:#10b981;">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
            </div>
            <div class="soap-complete-title">Documentation Complete</div>
            <div class="soap-complete-subtitle">
                Clinical notes and medical codes have been approved and saved to this visit record.
            </div>
        </div>`;
    console.log('[Workflow] Right panel cleared — workflow complete, approval loop prevented');
}

function backToScheduleDirectly() {
    // FIX: Clear all workflow localStorage keys BEFORE reloading.
    // connect-ccp.js init block reads soapPendingContact on page load —
    // if still set it immediately re-triggers the clinical/SOAP view,
    // causing the snap-back loop. Clearing here ensures a clean slate.
    try {
        localStorage.removeItem('soapPendingContact');
        localStorage.removeItem('consultationEnded');
        localStorage.removeItem('activePatient');
    } catch(e) {}
    // Also clear in-memory flags in case CCP is still running
    window._soapPendingForContact = null;
    window._consultationEnded = false;
    window._patientOpened = null;
    window._contactHandled = null;
    window._embedStateReset = false;
    console.log('[Workflow] localStorage cleared — reloading to schedule screen');
    window.location.reload();
}

function backToSchedule() {

    closeCompletionOverlay();

    

    // Hide patient portal

    const patientPortal = document.querySelector('.patient-portal-background');

    if (patientPortal) {

        patientPortal.style.display = 'none';

    }

    

    // Hide iframe

    const previsitContainer = document.getElementById('previsitContainer');

    if (previsitContainer) {

        previsitContainer.classList.remove('active');

    }

    

    // Show schedule screen

    const scheduleScreen = document.getElementById('scheduleScreen');

    if (scheduleScreen) {

        scheduleScreen.classList.remove('hidden');

    }

}


function editFollowup() {

    console.warn('[editFollowup] Follow-up scheduling interface not yet implemented');

    // In a real implementation, this would open a date/time picker

}


// ==========================================================================

// SIZE 2 OVERLAY DRAG FUNCTIONALITY

// ==========================================================================

let isDraggingSize2 = false;

let dragStartX = 0;

let dragStartY = 0;

let overlayStartX = 0;

let overlayStartY = 0;


function initializeSize2Dragging() {

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (!overlaySize2) return;


    overlaySize2.addEventListener('mousedown', startDragSize2);

    document.addEventListener('mousemove', dragSize2);

    document.addEventListener('mouseup', stopDragSize2);

}


function startDragSize2(e) {

    // Only start drag if clicking on the overlay itself, not on buttons

    if (e.target.closest('.control-btn') || e.target.closest('button')) {

        return;

    }


    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (!overlaySize2) return;


    isDraggingSize2 = true;

    overlaySize2.classList.add('dragging');


    // Get current position

    const rect = overlaySize2.getBoundingClientRect();

    overlayStartX = rect.left;

    overlayStartY = rect.top;


    // Store mouse start position

    dragStartX = e.clientX;

    dragStartY = e.clientY;


    e.preventDefault();

}


function dragSize2(e) {

    if (!isDraggingSize2) return;


    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (!overlaySize2) return;


    // Calculate new position

    const deltaX = e.clientX - dragStartX;

    const deltaY = e.clientY - dragStartY;

    

    let newX = overlayStartX + deltaX;

    let newY = overlayStartY + deltaY;


    // Constrain to entire screen area (including iframe and navigation)

    const maxX = window.innerWidth - 400; // Full screen width minus overlay width

    const maxY = window.innerHeight - 56; // Screen height minus overlay height

    const minX = 0;

    const minY = 0; // Allow dragging over navigation areas


    newX = Math.max(minX, Math.min(newX, maxX));

    newY = Math.max(minY, Math.min(newY, maxY));


    // Apply new position

    overlaySize2.style.left = newX + 'px';

    overlaySize2.style.top = newY + 'px';

}


function stopDragSize2() {

    if (!isDraggingSize2) return;


    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (overlaySize2) {

        overlaySize2.classList.remove('dragging');

    }


    isDraggingSize2 = false;

}


function restoreConsultation() {

    const overlay = document.getElementById('consultationOverlay');

    if (overlay && isConsultationActive) {

        overlay.classList.remove('minimized');

        

        // Prevent body scrolling when restored

        document.body.style.overflow = 'hidden';

    }

}


function initializeConsultationOverlay() {

    // Initialize particle system

    const background = document.getElementById('scribeBackground');

    if (background) {

        background.innerHTML = '';

    }

    

    // Ensure all elements are properly initialized

    const timerElement = document.getElementById('scribeTimer');

    if (timerElement) {

        timerElement.textContent = '00:00';

    }

    

    // Initialize wave bars

    const waveBars = document.querySelectorAll('.wave-bar');

    waveBars.forEach((bar, index) => {

        bar.style.animationDelay = (index * 0.1) + 's';

    });

}


// ==========================================================================

// RESIZING FUNCTIONALITY - GRADIENT BORDER HANDLE

// ==========================================================================

function startResizing(e) {

    const rect = container.getBoundingClientRect();

    const handleZone = 8; // 8px from the left edge

    

    // Check if click is within the resize handle zone (left edge)

    if (e.clientX >= rect.left - handleZone && e.clientX <= rect.left + handleZone) {

        isResizing = true;

        container.classList.add('resizing');

        // Prevent iframe from swallowing mouse events during resize
        const iframe = document.getElementById('previsitIframe');
        if (iframe) iframe.style.pointerEvents = 'none';

        startX = e.clientX;

        startWidth = container.offsetWidth;

        

        e.preventDefault();

        e.stopPropagation();

    }

}


// ==========================================================================

// DRAGGING FUNCTIONALITY - HEADER ONLY

// ==========================================================================

function startDragging(e) {

    if (e.target.closest('.previsit-controls')) return;

    if (isResizing && !isPopedOut) return;

    

    // If minimized, restore on drag attempt

    if (isMinimized) {

        toggleMinimize();

        return;

    }

    

    isDragging = true;

    container.classList.add('dragging');

    // Prevent iframe from swallowing mouse events during drag
    const iframe = document.getElementById('previsitIframe');
    if (iframe) iframe.style.pointerEvents = 'none';

    

    startX = e.clientX;

    startY = e.clientY;

    

    // If popped out, track absolute position

    if (isPopedOut) {

        const rect = container.getBoundingClientRect();

        startLeft = rect.left;

        startTop = rect.top;

    } else {

        // Get current transform if any

        const transform = container.style.transform;

        const match = transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);

        startLeft = match ? parseFloat(match[1]) : 0;

    }

    

    e.preventDefault();

    e.stopPropagation();

}


function handleMouseMove(e) {

    if (isResizing) {

        resize(e);

    } else if (isDragging) {

        drag(e);

    }

}


function resize(e) {

    if (!isResizing) return;

    

    const deltaX = startX - e.clientX; // Inverted because we're on the left edge

    const newWidth = startWidth + deltaX;

    

    // Clamp between min (300px) and max (100vw)

    const minWidth = 300;

    const maxWidth = window.innerWidth;

    const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    

    container.style.width = clampedWidth + 'px';

    

    // Add visual feedback for full width

    if (clampedWidth >= window.innerWidth - 10) {

        container.classList.add('fullwidth');

    } else {

        container.classList.remove('fullwidth');

    }

}


function drag(e) {

    if (!isDragging) return;

    

    if (isPopedOut) {

        // Free dragging when popped out

        const deltaX = e.clientX - startX;

        const deltaY = e.clientY - startY;

        let newLeft = startLeft + deltaX;

        let newTop = startTop + deltaY;

        

        // Keep within viewport bounds with some padding

        const padding = 20;

        const maxLeft = window.innerWidth - container.offsetWidth - padding;

        const maxTop = window.innerHeight - container.offsetHeight - padding;

        newLeft = Math.max(padding, Math.min(newLeft, maxLeft));

        newTop = Math.max(padding, Math.min(newTop, maxTop));

        

        container.style.left = newLeft + 'px';

        container.style.top = newTop + 'px';

        container.style.right = 'auto';

        container.style.transform = 'none';

    } else {

        // Horizontal sliding when docked

        const deltaX = e.clientX - startX;

        const newTranslate = startLeft + deltaX;

        

        // Clamp between 0 (fully visible) and container width (fully hidden to the right)

        const clampedTranslate = Math.max(0, Math.min(newTranslate, container.offsetWidth));

        

        container.style.transform = `translateX(${clampedTranslate}px)`;

    }

}


function stopDraggingAndResizing() {

    // Restore iframe mouse events
    const iframe = document.getElementById('previsitIframe');
    if (iframe) iframe.style.pointerEvents = '';

    if (isResizing) {

        isResizing = false;

        container.classList.remove('resizing');

    }

    

    if (isDragging) {

        isDragging = false;

        container.classList.remove('dragging');

        

        // Skip snap behavior when popped out

        if (isPopedOut) {

            return;

        }

        

        // Get current transform value

        const transform = container.style.transform;

        const match = transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);

        const currentOffset = match ? parseFloat(match[1]) : 0;

        

        // Snap to open or closed based on threshold (30% of width)

        const threshold = container.offsetWidth * 0.3;

        

        if (currentOffset > threshold) {

            // Snap to closed (hidden to the right)

            container.style.transform = `translateX(${container.offsetWidth}px)`;

            setTimeout(() => {

                container.classList.remove('active');

                container.style.transform = '';

            }, 300);

        } else {

            // Snap back to open (visible)

            container.style.transform = 'translateX(0)';

        }

    }

}


// ==========================================================================

// SNAP TO DEFAULT STATE

// ==========================================================================

function snapToDefault(e) {

    // Don't snap if clicking on controls or if currently dragging/resizing

    if (e.target.closest('.previsit-controls') || isDragging || isResizing) return;

    

    // Check if state has been modified

    const currentWidth = container.style.width || '30vw';

    const currentTransform = container.style.transform || 'translateX(0)';

    

    const isModified = currentWidth !== defaultState.width || 

                     currentTransform !== defaultState.transform;

    

    if (isModified) {

        // Animate back to default state with smooth easing

        container.style.transition = 'all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

        container.style.width = defaultState.width;

        container.style.transform = defaultState.transform;

        container.classList.remove('fullwidth');

        

        // Remove transition after animation completes

        setTimeout(() => {

            container.style.transition = '';

        }, 600);

    }

}


// ==========================================================================

// WINDOW CONTROLS

// ==========================================================================

// WINDOW CONTROLS

// ==========================================================================



let isPopedOut = false;

let popoutState = {

    top: null,

    left: null,

    right: null,

    width: null,

    height: null,

    transform: null

};


function togglePopout() {

    if (isPopedOut) {

        popInToPortal();

    } else {

        popOutFromPortal();

    }

}


function popOutFromPortal() {

    // Save current state

    popoutState.top = container.style.top || '120px';

    popoutState.right = container.style.right || '0px';

    popoutState.width = container.style.width || '30vw';

    popoutState.height = container.style.height || 'calc(100vh - 120px)';

    popoutState.transform = container.style.transform || '';

    

    // Show backdrop

    const backdrop = document.getElementById('popoutBackdrop');

    if (backdrop) {

        backdrop.classList.add('active');

    }

    

    // Add popped-out class first for transition

    container.classList.add('popped-out');

    

    // Small delay to ensure transition applies

    setTimeout(() => {

        // Calculate center position

        const centerX = (window.innerWidth - 800) / 2;

        const centerY = (window.innerHeight - (window.innerHeight * 0.85)) / 2;

        

        // Set absolute positioning for center with smooth transition

        container.style.left = centerX + 'px';

        container.style.top = centerY + 'px';

        container.style.right = 'auto';

        container.style.transform = 'scale(1)';

    }, 10);

    

    // Update button title

    const popoutBtn = document.getElementById('popoutBtn');

    if (popoutBtn) {

        popoutBtn.title = 'Pop in';

    }

    

    isPopedOut = true;

    

    // Make header draggable when popped out

    header.style.cursor = 'move';

}


function popInToPortal() {

    // Hide backdrop

    const backdrop = document.getElementById('popoutBackdrop');

    if (backdrop) {

        backdrop.classList.remove('active');

    }

    

    // Add transition back

    container.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';

    

    // Restore original position

    container.style.top = popoutState.top;

    container.style.right = popoutState.right;

    container.style.left = '';

    container.style.width = popoutState.width;

    container.style.height = popoutState.height;

    container.style.transform = popoutState.transform;

    

    // Remove popped-out class after transition starts

    setTimeout(() => {

        container.classList.remove('popped-out');

    }, 50);

    

    // Update button title

    const popoutBtn = document.getElementById('popoutBtn');

    if (popoutBtn) {

        popoutBtn.title = 'Pop out';

    }

    

    isPopedOut = false;

    

    // Restore header cursor

    header.style.cursor = 'grab';

}


function toggleMinimize() {

    if (isMinimized) {

        restoreFromMinimized();

    } else {

        minimizeToCorner();

    }

}


function restoreFromMinimized() {

    // Restore from minimized state

    container.classList.remove('minimized');

    

    // Restore to original position

    container.style.top = originalState.top || '120px';

    container.style.right = originalState.right || '0px';

    container.style.bottom = 'auto';

    container.style.width = originalState.width || '30vw';

    container.style.height = originalState.height || 'calc(100vh - 120px)';

    

    isMinimized = false;

    header.title = '';

    

    // Change button back to minimize icon

    updateToggleButton('minimize');

}


function minimizeToCorner() {

    // Store current state before minimizing

    storeOriginalState();

    

    // Minimize - keep width, only collapse height

    container.classList.add('minimized');

    container.style.bottom = '20px';

    container.style.right = '0px';

    container.style.top = 'auto';

    container.style.height = '44px';

    // Keep the current width

    container.style.width = container.style.width || '30vw';

    

    isMinimized = true;

    header.title = 'Click to restore Ellis AI Assistant';

    

    // Change button to restore icon

    updateToggleButton('restore');

    

    // If maximized, remove maximized state

    if (isMaximized) {

        container.classList.remove('maximized');

        isMaximized = false;

    }

}


// ==========================================================================

// EVENT HANDLERS

// ==========================================================================

function handleHeaderDoubleClick(e) {

    if (isMinimized && !e.target.closest('.previsit-controls')) {

        toggleMinimize();

    }

}


function handleHeaderClick(e) {

    if (isMinimized && !e.target.closest('.previsit-controls')) {

        toggleMinimize();

    }

}


function handleKeyboardShortcuts(e) {

    if (e.key === 'Escape') {

        if (isPopedOut) {

            // Close popout first

            popInToPortal();

        } else if (isConsultationActive) {

            stopConsultation();

        } else if (document.getElementById('chatOverlay')?.classList.contains('active')) {

            toggleChat();

        }

    }

    

    // Ctrl/Cmd + M to minimize/restore iframe

    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {

        e.preventDefault();

        toggleMinimize();

    }

}


function preventTextSelection(e) {

    if (isDragging || isResizing) {

        e.preventDefault();

    }

}


function bringToFront() {

    container.style.zIndex = '1001';

    setTimeout(() => {

        container.style.zIndex = '1000';

    }, 100);

}


// ==========================================================================

// DYNAMIC CHAT INPUT AND TOPIC PILLS BASED ON IFRAME SELECTIONS

// ==========================================================================

const metricPrompts = {

    'medication-adherence': {

        single: "Ask about medication adherence patterns...",

        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17,8C8,10 5.9,16.17 3.82,21.34L5.71,22L6.66,19.7C7.14,19.87 7.64,20 8,20C19,20 22,3 22,3C21,5 14,5.25 9,6.25C4,7.25 2,11.5 2,13.5C2,15.5 3.75,17.25 3.75,17.25C7,8 17,8 17,8Z"/></svg>`,

        topic: "medication adherence",

        displayName: "Medication Adherence"

    },

    'avg-glucose': {

        single: "Discuss glucose management strategies...",

        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/></svg>`,

        topic: "glucose levels",

        displayName: "Avg Glucose"

    },

    'weight-change': {

        single: "Explore weight management options...",

        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12,3A4,4 0 0,1 16,7A4,4 0 0,1 12,11A4,4 0 0,1 8,7A4,4 0 0,1 12,3M12,14.2C13.5,14.2 16.4,14.9 17.5,16.3C17.9,16.9 18,17.4 18,18V20H6V18C6,17.4 6.1,16.9 6.5,16.3C7.6,14.9 10.5,14.2 12,14.2Z"/></svg>`,

        topic: "weight management",

        displayName: "Weight Change"

    },

    'lifestyle': {

        single: "Chat about lifestyle modifications...",

        icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5,5.5C14.59,5.5 15.5,4.59 15.5,3.5S14.59,1.5 13.5,1.5S11.5,2.41 11.5,3.5S12.41,5.5 13.5,5.5M9.89,19.38L10.89,15L13,17V23H15V15.5L12.89,13.5L13.5,10.5C14.79,12 16.79,13 19,13V11C17.09,11 15.5,10 14.69,8.58L13.69,7C13.29,6.38 12.69,6 12,6C11.69,6 11.5,6.08 11.19,6.08L6,8.28V12H8V9.58L9.79,8.88L8.19,17L3.29,16L2.89,18L9.89,19.38Z"/></svg>`,

        topic: "lifestyle changes",

        displayName: "Lifestyle"

    }

};


function updateChatInputFromSelection(selectedMetrics) {

    const chatInput = document.querySelector('.patient-chat-input');

    const chatWrapper = document.querySelector('.patient-chat-input-wrapper');

    

    if (!chatInput || !chatWrapper) return;

    

    // Update topic pills

    updateTopicPills(selectedMetrics);

    

    // Update the dynamic donut icon

    updateChatInputIcon(selectedMetrics);

    

    if (selectedMetrics.length === 0) {

        // No selection - default state

        chatInput.placeholder = "Type a message...";

        removeChatInputHighlight();

        removeChatInputIcon();

    } else if (selectedMetrics.length === 1) {

        // Single selection

        const metric = selectedMetrics[0];

        const prompt = metricPrompts[metric];

        if (prompt) {

            chatInput.placeholder = prompt.single;

            addChatInputIcon(prompt.icon);

            animateChatInputUpdate();

        }

    } else {

        // Multiple selections

        const topics = selectedMetrics.map(m => metricPrompts[m]?.topic).filter(Boolean);

        if (topics.length > 0) {

            chatInput.placeholder = `Discuss ${topics.join(' and ')} together...`;

            addChatInputIcon("🔍");

            animateChatInputUpdate();

        }

    }

}


function updateChatInputIcon(selectedMetrics) {

    const iconElement = document.querySelector('.chat-input-icon');

    if (!iconElement) return;

    

    // Remove all existing state classes

    iconElement.classList.remove('medication-adherence', 'avg-glucose', 'weight-change', 'lifestyle', 'multiple');

    iconElement.removeAttribute('data-count');

    

    if (selectedMetrics.length === 0) {

        // Default state

        iconElement.title = 'No topics selected';

    } else if (selectedMetrics.length === 1) {

        // Single topic - show number 1

        iconElement.classList.add('multiple');

        iconElement.setAttribute('data-count', '1');

        const metricData = metricPrompts[selectedMetrics[0]];

        iconElement.title = `Selected: ${metricData?.displayName || selectedMetrics[0]} (click to clear)`;

    } else {

        // Multiple topics - apply multiple class

        iconElement.classList.add('multiple');

        iconElement.setAttribute('data-count', selectedMetrics.length);

        const topicNames = selectedMetrics.map(m => metricPrompts[m]?.displayName).filter(Boolean);

        iconElement.title = `Selected: ${topicNames.join(', ')} (click to clear all)`;

    }

}


function clearAllTopicSelections() {

    // Clear all pills visually

    const pillsContainer = document.getElementById('chatTopicPills');

    if (pillsContainer) {

        const pills = pillsContainer.querySelectorAll('.topic-pill');

        pills.forEach(pill => {

            const metricId = pill.getAttribute('data-metric');

            removePill(metricId);

        });

    }

    

    // Send message to iframe to clear all selections

    const iframe = document.querySelector('.previsit-iframe');

    if (iframe && iframe.contentWindow) {

        iframe.contentWindow.postMessage({

            type: 'clearAllSelections'

        }, window.location.origin);

    }

    

    // Update chat input state

    updateChatInputFromSelection([]);

    

    // Show feedback

    showClearAllFeedback();

}


function showClearAllFeedback() {

    const iconElement = document.querySelector('.chat-input-icon');

    if (iconElement) {

        // Brief feedback animation

        iconElement.style.animation = 'clearFeedback 0.6s ease';

        setTimeout(() => {

            iconElement.style.animation = '';

        }, 600);

    }

}


function updateTopicPills(selectedMetrics) {

    const pillsContainer = document.getElementById('chatTopicPills');

    if (!pillsContainer) return;

    

    // Get current pills

    const currentPills = Array.from(pillsContainer.querySelectorAll('.topic-pill'));

    const currentMetrics = currentPills.map(pill => pill.getAttribute('data-metric'));

    

    // Remove pills that are no longer selected

    currentMetrics.forEach(metric => {

        if (!selectedMetrics.includes(metric)) {

            removePill(metric);

        }

    });

    

    // Add new pills for newly selected metrics

    selectedMetrics.forEach(metric => {

        if (!currentMetrics.includes(metric)) {

            addPill(metric);

        }

    });

}


function addPill(metricId) {

    const pillsContainer = document.getElementById('chatTopicPills');

    const metricData = metricPrompts[metricId];

    

    if (!pillsContainer || !metricData) return;

    

    const pill = document.createElement('div');

    pill.className = 'topic-pill';

    pill.setAttribute('data-metric', metricId);

    // nosemgrep: insecure-innerhtml — metricData is from hardcoded config, displayName escaped
    const _html2 = `

        <span class="topic-pill-icon">${metricData.icon}</span>

        <span class="topic-pill-text">${escapeHtml(metricData.displayName)}</span>

        <span class="topic-pill-close" onclick="removePillAndUpdateSelection('${escapeHtml(metricId)}')">×</span>

    `;
    pill.innerHTML = _html2; // nosemgrep: insecure-innerhtml, insecure-document-method

    

    // Add click handler for the pill (excluding the close button)

    pill.addEventListener('click', function(e) {

        if (!e.target.classList.contains('topic-pill-close')) {

            focusChatInput();

        }

    });

    

    pillsContainer.appendChild(pill);

}


function removePill(metricId) {

    const pill = document.querySelector(`.topic-pill[data-metric="${metricId}"]`);

    if (pill) {

        pill.classList.add('removing');

        setTimeout(() => {

            if (pill.parentNode) {

                pill.parentNode.removeChild(pill);

            }

        }, 300);

    }

}


function removePillAndUpdateSelection(metricId) {

    // Remove the pill visually

    removePill(metricId);

    

    // Send message to iframe to update selection

    const iframe = document.querySelector('.previsit-iframe');

    if (iframe && iframe.contentWindow) {

        iframe.contentWindow.postMessage({

            type: 'removeMetricSelection',

            metricId: metricId

        }, window.location.origin);

    }

}


function focusChatInput() {

    const chatInput = document.querySelector('.patient-chat-input');

    if (chatInput) {

        chatInput.focus();

        

        // Add a subtle focus effect

        const wrapper = chatInput.closest('.patient-chat-input-wrapper');

        if (wrapper) {

            wrapper.style.animation = 'chatInputPulse 0.3s ease';

            setTimeout(() => {

                wrapper.style.animation = '';

            }, 300);

        }

    }

}


function addChatInputIcon(iconContent) {

    const iconElement = document.querySelector('.chat-input-topic-icon');

    if (iconElement) {

        iconElement.innerHTML = iconContent; // nosemgrep: insecure-innerhtml, insecure-document-method — iconContent is hardcoded SVG from metricPrompts config

        iconElement.style.display = 'flex';

    } else {

        // Create new icon element

        const wrapper = document.querySelector('.patient-chat-input-wrapper');

        const icon = document.createElement('div');

        icon.className = 'chat-input-topic-icon';

        icon.innerHTML = iconContent; // nosemgrep: insecure-innerhtml, insecure-document-method — iconContent is hardcoded SVG

        icon.style.cssText = `

            display: flex;

            align-items: center;

            justify-content: center;

            width: 24px;

            height: 24px;

            font-size: 14px;

            margin-left: 8px;

            opacity: 0;

            animation: iconFadeIn 0.3s ease forwards;

            color: #8b5cf6;

        `;

        wrapper.insertBefore(icon, wrapper.querySelector('.chat-input-voice-btn'));

    }

}


function removeChatInputIcon() {

    const iconElement = document.querySelector('.chat-input-topic-icon');

    if (iconElement) {

        iconElement.style.animation = 'iconFadeOut 0.3s ease forwards';

        setTimeout(() => {

            if (iconElement.parentNode) {

                iconElement.parentNode.removeChild(iconElement);

            }

        }, 300);

    }

}


function animateChatInputUpdate() {

    const chatWrapper = document.querySelector('.patient-chat-input-wrapper');

    if (chatWrapper) {

        // Add a prominent highlighting effect

        chatWrapper.style.borderColor = 'rgba(139, 92, 246, 0.6)';

        chatWrapper.style.boxShadow = '0 0 0 4px rgba(139, 92, 246, 0.2), 0 12px 40px rgba(139, 92, 246, 0.3)';

        chatWrapper.style.animation = 'chatInputHighlight 2s ease';

        chatWrapper.style.transform = 'translateY(-6px) scale(1.02)';

        

        // Add a subtle glow effect

        chatWrapper.style.background = 'rgba(255, 255, 255, 1)';

        

        // Reset after animation

        setTimeout(() => {

            chatWrapper.style.borderColor = 'rgba(139, 92, 246, 0.3)';

            chatWrapper.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';

            chatWrapper.style.animation = '';

            chatWrapper.style.transform = 'translateY(-2px) scale(1)';

            chatWrapper.style.background = 'rgba(255, 255, 255, 0.95)';

        }, 2000);

        

        // Add a pulsing attention effect

        addAttentionPulse();

    }

}


function addAttentionPulse() {

    const chatWrapper = document.querySelector('.patient-chat-input-wrapper');

    if (chatWrapper) {

        // Create a pulsing ring effect

        const pulseRing = document.createElement('div');

        pulseRing.className = 'chat-input-pulse-ring';

        pulseRing.style.cssText = `

            position: absolute;

            top: -8px;

            left: -8px;

            right: -8px;

            bottom: -8px;

            border: 2px solid rgba(139, 92, 246, 0.4);

            border-radius: 58px;

            pointer-events: none;

            animation: pulseRing 2s ease-out;

            z-index: -1;

        `;

        

        chatWrapper.style.position = 'relative';

        chatWrapper.appendChild(pulseRing);

        

        // Remove pulse ring after animation

        setTimeout(() => {

            if (pulseRing.parentNode) {

                pulseRing.parentNode.removeChild(pulseRing);

            }

        }, 2000);

    }

}


function removeChatInputHighlight() {

    const chatWrapper = document.querySelector('.patient-chat-input-wrapper');

    if (chatWrapper) {

        // Smoothly return to default state

        chatWrapper.style.borderColor = 'rgba(255, 255, 255, 0.3)';

        chatWrapper.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';

        chatWrapper.style.transform = 'translateY(-2px) scale(1)';

        chatWrapper.style.background = 'rgba(255, 255, 255, 0.95)';

        chatWrapper.style.animation = 'chatInputFadeOut 0.5s ease';

        

        // Remove any existing pulse rings

        const pulseRings = chatWrapper.querySelectorAll('.chat-input-pulse-ring');

        pulseRings.forEach(ring => {

            if (ring.parentNode) {

                ring.parentNode.removeChild(ring);

            }

        });

    }

}


// Listen for messages from iframe

// nosemgrep: insufficient-postmessage-origin-validation — origin validated on next line
window.addEventListener('message', function(event) {

    // Validate origin — only accept messages from the same origin (iframe is same-origin)
    if (event.origin !== window.location.origin) {
        return;
    }

    if (event.data && event.data.type === 'metricSelection') {

        updateChatInputFromSelection(event.data.selectedMetrics);

    }

    if (event.data && event.data.type === 'bedrock-priorities') {
        window._bedrockPriorities = event.data.priorities;
        console.log('[Main] Received Bedrock priorities from iframe');
    }

    // Handle code clicked in iframe — highlight text in SOAP notes
    if (event.data && event.data.type === 'code-clicked') {
        toggleCodeTextHighlight(event.data.codeId);
    }
    if (event.data && event.data.type === 'clear-code-highlights') {
        const allLinked = document.querySelectorAll('.code-linked-text');
        allLinked.forEach(el => el.classList.remove('highlighted'));
    }

});


// ==========================================================================

// VOICE RECORDING FUNCTIONALITY

// ==========================================================================

let isRecording = false;

let recognition = null;

let voiceButton = null;


function initializeVoiceRecording() {

    voiceButton = document.querySelector('.chat-input-voice-btn');

    

    // Check if browser supports speech recognition

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        recognition = new SpeechRecognition();

        

        recognition.continuous = false;

        recognition.interimResults = true;

        recognition.lang = 'en-US';

        

        recognition.onstart = function() {

            updateVoiceButtonState('listening');

            updateChatInputPlaceholder('Listening...');

        };

        

        recognition.onresult = function(event) {

            let transcript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {

                transcript += event.results[i][0].transcript;

            }

            

            // Update input with transcript

            const chatInput = document.querySelector('.patient-chat-input');

            if (chatInput) {

                chatInput.value = transcript;

            }

            

            // If result is final, process it

            if (event.results[event.results.length - 1].isFinal) {

                updateVoiceButtonState('processing');

                setTimeout(() => {

                    handleVoiceCommand(transcript);

                }, 500);

            }

        };

        

        recognition.onerror = function(event) {

            console.error('Voice recognition error:', event.error);

            updateVoiceButtonState('idle');

            updateChatInputPlaceholder('Voice recognition error. Try again.');

            

            setTimeout(() => {

                resetChatInputPlaceholder();

            }, 3000);

        };

        

        recognition.onend = function() {

            isRecording = false;

            if (voiceButton && !voiceButton.classList.contains('processing')) {

                updateVoiceButtonState('idle');

                resetChatInputPlaceholder();

            }

        };

    } else {

        console.warn('Speech recognition not supported in this browser');

        if (voiceButton) {

            voiceButton.title = 'Voice recognition not supported';

            voiceButton.style.opacity = '0.5';

            voiceButton.style.cursor = 'not-allowed';

        }

    }

}


function toggleVoiceRecording() {

    if (!recognition) {

        console.warn('[VoiceRecording] Voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.');

        return;

    }

    

    if (isRecording) {

        stopVoiceRecording();

    } else {

        startVoiceRecording();

    }

}


function startVoiceRecording() {

    if (recognition && !isRecording) {

        isRecording = true;

        updateVoiceButtonState('recording');

        updateChatInputPlaceholder('Click to start speaking...');

        

        // Clear any existing text

        const chatInput = document.querySelector('.patient-chat-input');

        if (chatInput) {

            chatInput.value = '';

        }

        

        try {

            recognition.start();

        } catch (error) {

            console.error('Error starting voice recognition:', error);

            isRecording = false;

            updateVoiceButtonState('idle');

            resetChatInputPlaceholder();

        }

    }

}


function stopVoiceRecording() {

    if (recognition && isRecording) {

        recognition.stop();

        isRecording = false;

    }

}


function updateVoiceButtonState(state) {

    if (!voiceButton) return;

    

    // Remove all state classes

    voiceButton.classList.remove('recording', 'listening', 'processing');

    

    // Add appropriate state class

    if (state !== 'idle') {

        voiceButton.classList.add(state);

    }

    

    // Update tooltip

    const tooltips = {

        idle: 'Voice command',

        recording: 'Recording... Click to stop',

        listening: 'Listening...',

        processing: 'Processing voice...'

    };

    

    voiceButton.title = tooltips[state] || tooltips.idle;

}


function updateChatInputPlaceholder(text) {

    const chatInput = document.querySelector('.patient-chat-input');

    if (chatInput) {

        chatInput.placeholder = text;

    }

}


function resetChatInputPlaceholder() {

    const chatInput = document.querySelector('.patient-chat-input');

    if (chatInput) {

        // Check if there are selected metrics to show contextual placeholder

        const pillsContainer = document.getElementById('chatTopicPills');

        const activePills = pillsContainer ? pillsContainer.querySelectorAll('.topic-pill') : [];

        

        if (activePills.length === 0) {

            chatInput.placeholder = 'Type a message...';

        } else {

            // Keep the contextual placeholder if topics are selected

            // This will be handled by the existing updateChatInputFromSelection function

        }

    }

}


function handleVoiceCommand(transcript) {

    // Process the voice command

    if (transcript.trim()) {

        // Get current context from placeholder or selected topics

        const chatInput = document.querySelector('.patient-chat-input');

        const placeholder = chatInput ? chatInput.placeholder : '';

        const isContextual = placeholder !== "Type a message...";

        

        if (isContextual) {

            showContextualChatFeedback(transcript, placeholder);

        } else {

            showChatFeedback();

        }

        

        // Clear the input after processing

        if (chatInput) {

            chatInput.value = '';

        }

    }

    

    // Reset button state

    updateVoiceButtonState('idle');

    resetChatInputPlaceholder();

}


function showContextualChatFeedback(transcript, context) {

    // Show enhanced feedback for contextual commands

    const wrapper = document.querySelector('.patient-chat-input-wrapper');

    const originalBorder = wrapper.style.borderColor;

    const originalShadow = wrapper.style.boxShadow;

    

    wrapper.style.borderColor = 'rgba(16, 185, 129, 0.5)';

    wrapper.style.boxShadow = '0 12px 40px rgba(16, 185, 129, 0.3)';

    

    // Create a temporary feedback message

    const feedback = document.createElement('div');

    feedback.style.cssText = `

        position: absolute;

        bottom: 100%;

        left: 50%;

        transform: translateX(-50%);

        background: rgba(16, 185, 129, 0.9);

        color: white;

        padding: 8px 12px;

        border-radius: 8px;

        font-size: 12px;

        font-weight: 500;

        white-space: nowrap;

        margin-bottom: 8px;

        animation: fadeInUp 0.3s ease;

    `;

    feedback.textContent = `Voice command processed for ${context.replace('Ask about ', '').replace('...', '')}`;

    

    wrapper.style.position = 'relative';

    wrapper.appendChild(feedback);

    

    setTimeout(() => {

        wrapper.style.borderColor = originalBorder;

        wrapper.style.boxShadow = originalShadow;

        if (feedback.parentNode) {

            feedback.remove();

        }

    }, 2000);

}


// ==========================================================================

// PATIENT CHAT INPUT FUNCTIONALITY

// ==========================================================================

function initializePatientChatInput() {

    const chatInput = document.querySelector('.patient-chat-input');

    

    if (chatInput) {

        // Handle Enter key press

        chatInput.addEventListener('keypress', function(e) {

            if (e.key === 'Enter') {

                handlePatientChatMessage();

            }

        });

        

        // Handle input changes to enable/disable send button

        chatInput.addEventListener('input', function() {

            updateSendButtonState();

        });

        

        // Handle focus/blur for enhanced styling

        chatInput.addEventListener('focus', function() {

            this.closest('.patient-chat-input-wrapper').style.transform = 'translateY(-4px)';

        });

        

        chatInput.addEventListener('blur', function() {

            this.closest('.patient-chat-input-wrapper').style.transform = 'translateY(-2px)';

        });

    }

    

    // Initialize send button state

    updateSendButtonState();

    

    // Initialize voice recording

    initializeVoiceRecording();

}



function updateSendButtonState() {

    const chatInput = document.querySelector('.patient-chat-input');

    const sendBtn = document.querySelector('.chat-input-send-btn');

    

    if (chatInput && sendBtn) {

        const hasText = chatInput.value.trim().length > 0;

        

        if (hasText) {

            sendBtn.classList.remove('disabled');

            sendBtn.style.pointerEvents = 'auto';

            sendBtn.title = 'Send message';

        } else {

            sendBtn.classList.add('disabled');

            sendBtn.style.pointerEvents = 'none';

            sendBtn.title = 'Type a message to send';

        }

    }

}



function handlePatientChatMessage() {

    const chatInput = document.querySelector('.patient-chat-input');

    const message = chatInput.value.trim();

    

    if (message) {

        // Here you would typically send the message to your chat system

        // For now, we'll just clear the input

        chatInput.value = '';

        

        // Optional: Show a brief feedback

        showChatFeedback();

    }

}



function showChatFeedback() {

    const wrapper = document.querySelector('.patient-chat-input-wrapper');

    const originalBorder = wrapper.style.borderColor;

    

    wrapper.style.borderColor = 'rgba(139, 92, 246, 0.5)';

    wrapper.style.boxShadow = '0 12px 40px rgba(139, 92, 246, 0.3)';

    

    setTimeout(() => {

        wrapper.style.borderColor = originalBorder;

        wrapper.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.12)';

    }, 1000);

}


// ==========================================================================

// CHAT FUNCTIONALITY

// ==========================================================================

function toggleChat() {

    const chatOverlay = document.getElementById('chatOverlay');

    const isActive = chatOverlay.classList.contains('active');

    

    if (isActive) {

        chatOverlay.classList.remove('active');

    } else {

        chatOverlay.classList.add('active');

    }

}


function sendMessage() {

    const input = document.querySelector('.chat-input');

    const message = input.value.trim();

    

    if (message) {

        input.value = '';

        

        // Here you would typically send to AI and get response

        // For now, just log the message

    }

}


// ==========================================================================

// MODERN CONSULTATION RECORDING FUNCTIONALITY

// ==========================================================================

let isConsultationActive = false;

let isConsultationCompleted = false; // Track if consultation has ever been completed

let consultationStartTime = null;



// ==========================================================================

// CONSULTATION SCRIBE OVERLAY VARIABLES

// ==========================================================================

let consultationTimer = null;

let isPaused = false;

let pausedDuration = 0;

let pauseStartTime = null;


// ==========================================================================

// CONSULTATION SCRIBE OVERLAY FUNCTIONS

// ==========================================================================

function startConsultation() {

    const button = document.querySelector('.start-consultation-btn');

    const buttonText = button.querySelector('.button-text');

    

    // Check if consultation has been completed - if so, disable button

    if (isConsultationCompleted) {

        return;

    }

    

    if (!isConsultationActive) {

        // Subtle auto-scroll to get focus on the previsit overlay area

        const previsitOverlay = document.getElementById('previsitContainer');

        if (previsitOverlay) {

            // Get current scroll position

            const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

            const targetElement = previsitOverlay.getBoundingClientRect();

            const targetScroll = currentScroll + targetElement.top - 150; // Offset to center better

            

            // Only scroll if not already in view

            if (Math.abs(targetScroll - currentScroll) > 50) {

                // Extremely subtle, slow scroll

                window.scrollTo({

                    top: targetScroll,

                    behavior: 'smooth'

                });

            }

        }

        

        // Show immediately without delay

        showConsentReminder();

    } else {

        // Show stop confirmation to prevent accidental stoppage

        showStopConsultationConfirmation();

    }

}


// ==========================================================================

// CONSENT REMINDER SYSTEM

// ==========================================================================

function showConsentReminder() {

    const overlay = document.getElementById('consultationOverlay');

    const mainBackdrop = document.getElementById('consultationBackdrop');

    

    if (overlay && mainBackdrop) {

        // Show the overlay first

        overlay.classList.add('active');

        

        // Use the main consultation backdrop for consistency

        mainBackdrop.classList.add('active');

        

        document.body.style.overflow = 'hidden';

        

        // Show consent reminder content instead of recording interface

        showConsentReminderContent();

    }

}


function showConsentReminderContent() {

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    if (scribeInterface) {

        console.log('Replacing scribe interface content with consent reminder');

        // Build DOB display from PATIENT_INFO
        var dobFormatted = '••  /  ••  /  ••••';
        var dobFull = '';
        var patientName = '';
        try {
            var info = window.PATIENT_INFO && window.currentPatientKey && window.PATIENT_INFO[window.currentPatientKey];
            if (info) {
                patientName = info.name || '';
                if (info.birthDate) {
                    var parts = info.birthDate.split('-');
                    if (parts.length === 3) {
                        dobFull = parts[1] + ' / ' + parts[2] + ' / ' + parts[0];
                    }
                }
            }
        } catch(e) {}

        // Replace the content with consent reminder

        scribeInterface.innerHTML = `

            <div class="consent-reminder-content">

                <div class="consent-icon">

                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">

                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>

                        <rect x="9" y="3" width="6" height="4" rx="1"/>

                        <path d="M9 12l2 2 4-4"/>

                    </svg>

                </div>

                

                <div class="consent-header">

                    <h2>Amazon Connect Health Consent</h2>

                    <p>"I'd like to use an AI assistant to help write better clinical notes during our consultation. Is that okay with you?"</p>

                </div>

                

                <div class="consent-benefits">

                    <div class="benefit-simple">

                        <svg class="benefit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>

                            <polyline points="14,2 14,8 20,8"/>

                            <line x1="16" y1="13" x2="8" y2="13"/>

                            <line x1="16" y1="17" x2="8" y2="17"/>

                        </svg>

                        <span>Helps me capture important details</span>

                    </div>

                    <div class="benefit-simple">

                        <svg class="benefit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>

                            <path d="M9 12l2 2 4-4"/>

                        </svg>

                        <span>Ensures nothing is missed</span>

                    </div>

                    <div class="benefit-simple">

                        <svg class="benefit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>

                            <circle cx="12" cy="16" r="1"/>

                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>

                        </svg>

                        <span>No conversations are saved</span>

                    </div>

                </div>

                <div class="consent-verify-section">

                    <div class="consent-verify-label">

                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">

                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>

                            <line x1="12" y1="9" x2="12" y2="13"/>

                            <line x1="12" y1="17" x2="12.01" y2="17"/>

                        </svg>

                        Ask patient to state their full name and date of birth

                    </div>

                    <div class="consent-verify-fields">

                        <div class="consent-verify-row">

                            <span class="consent-verify-key">Full name</span>

                            <span class="consent-verify-val">${patientName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>

                        </div>

                        <div class="consent-verify-row">

                            <span class="consent-verify-key">Date of birth</span>

                            <span class="consent-verify-val consent-dob-masked" id="consentDobDisplay">••  /  ••  /  ••••</span>

                            <button class="consent-reveal-btn" id="consentRevealBtn" onclick="consentRevealDob('${dobFull}')">

                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>

                                    <circle cx="12" cy="12" r="3"/>

                                </svg>

                                Reveal

                            </button>

                        </div>

                    </div>

                </div>

                

                <div class="consent-actions">

                    <button class="consent-btn cancel-consent" onclick="cancelConsent()">

                        Not Now

                    </button>

                    <button class="consent-btn confirm-consent" onclick="confirmConsentAndStartRecording()">

                        ✓ Patient Agrees

                    </button>

                </div>

            </div>

        `;

        console.log('Consent reminder content set');

    } else {

        console.error('ScribeInterface not found!');

    }

}


// DOB reveal within consent screen — shows for 5s then re-masks
function consentRevealDob(dobFull) {

    var dobEl = document.getElementById('consentDobDisplay');

    var revealBtn = document.getElementById('consentRevealBtn');

    if (!dobEl || !dobFull) return;

    dobEl.textContent = dobFull;

    dobEl.classList.remove('consent-dob-masked');

    if (revealBtn) revealBtn.style.display = 'none';

    setTimeout(function() {

        dobEl.textContent = '••  /  ••  /  ••••';

        dobEl.classList.add('consent-dob-masked');

        if (revealBtn) revealBtn.style.display = 'inline-flex';

    }, 5000);

}


function cancelConsent() {

    console.log('=== CONSENT CANCELLED ===');

    const overlay = document.getElementById('consultationOverlay');

    const mainBackdrop = document.getElementById('consultationBackdrop');

    

    if (overlay) {

        overlay.classList.remove('active');

        document.body.style.overflow = '';

        

        // Remove main backdrop

        if (mainBackdrop) {

            mainBackdrop.classList.remove('active');

        }

        

        // Reset the scribe interface content

        resetScribeInterfaceContent();

        

        console.log('Consent cancelled, overlay and backdrop closed');

    }

}


function confirmConsentAndStartRecording() {

    console.log('=== CONSENT CONFIRMED - STARTING RECORDING ===');

    

    // Keep the main consultation backdrop active for consistency

    const mainBackdrop = document.getElementById('consultationBackdrop');

    if (mainBackdrop) {

        // Backdrop stays active - no need to remove and re-add

        console.log('Main backdrop remains active for Size 1 overlay');

    }

    

    // Keep the Size 1 overlay active and show recording interface

    const overlay = document.getElementById('consultationOverlay');

    if (overlay) {

        // Keep overlay active for Size 1 interface

        overlay.classList.add('active');

        

        // Reset the scribe interface to show recording content

        resetScribeInterfaceContent();

    }

    

    // Start the consultation recording (but keep Size 1 overlay visible)

    startConsultationRecording();

}


function resetScribeInterfaceContent() {

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    if (scribeInterface) {

        // Restore the recording interface with new design

        scribeInterface.innerHTML = `
            <!-- Header -->
            <div class="scribe-header">
                <div class="scribe-title">Amazon Connect Health</div>
                <div class="scribe-subtitle">Listening and analyzing your consultation</div>
            </div>

            <!-- Sleek Floating 3D Sound Wave -->
            <div class="soundwave-container">
                <svg class="wave-svg" viewBox="-20 -10 440 120">
                    <defs>
                        <linearGradient id="waveGradient1" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:0.9" />
                            <stop offset="30%" style="stop-color:#1d4ed8;stop-opacity:1" />
                            <stop offset="70%" style="stop-color:#2563eb;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#3b82f6;stop-opacity:0.8" />
                        </linearGradient>
                        <linearGradient id="waveGradient2" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#10b981;stop-opacity:0.8" />
                            <stop offset="30%" style="stop-color:#059669;stop-opacity:1" />
                            <stop offset="70%" style="stop-color:#047857;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#10b981;stop-opacity:0.7" />
                        </linearGradient>
                        <linearGradient id="waveGradient3" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#8b5cf6;stop-opacity:0.7" />
                            <stop offset="30%" style="stop-color:#7c3aed;stop-opacity:0.9" />
                            <stop offset="70%" style="stop-color:#6d28d9;stop-opacity:0.9" />
                            <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:0.6" />
                        </linearGradient>
                        <linearGradient id="waveGradient4" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:0.5" />
                            <stop offset="30%" style="stop-color:#d97706;stop-opacity:0.7" />
                            <stop offset="70%" style="stop-color:#b45309;stop-opacity:0.7" />
                            <stop offset="100%" style="stop-color:#f59e0b;stop-opacity:0.4" />
                        </linearGradient>
                    </defs>
                    <path class="wave-path wave-path-1" d="M20,50 Q120,30 220,50 T420,50" />
                    <path class="wave-path wave-path-2" d="M20,50 Q120,65 220,40 T420,50" />
                    <path class="wave-path wave-path-3" d="M20,50 Q120,40 220,65 T420,50" />
                    <path class="wave-path wave-path-4" d="M20,50 Q120,55 220,35 T420,50" />
                </svg>
            </div>

            <!-- Recording Status -->
            <div class="recording-status">
                <div class="status-indicator">
                    <div class="recording-dot"></div>
                    <div class="status-text">Listening</div>
                </div>
                <div class="recording-timer" id="scribeTimer">00:00</div>
            </div>

            <!-- Control Buttons -->
            <div class="scribe-controls">
                <button class="scribe-control-btn pause" onclick="pauseConsultation()" id="pauseScribeBtnSize1" title="Pause Recording">
                    <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                    </svg>
                    <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
                        <polygon points="5,3 19,12 5,21"/>
                    </svg>
                    <span class="scribe-btn-label pause-label">Pause</span>
                    <span class="scribe-btn-label resume-label" style="display:none;">Resume</span>
                </button>
                <button class="scribe-control-btn stop" onclick="showStopConsultationConfirmation()" title="Stop Recording">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="5"/>
                    </svg>
                    <span class="scribe-btn-label">Stop</span>
                </button>
            </div>

            <!-- Toggle Icons Row -->
            <div class="scribe-toggle-row">
                <button class="scribe-toggle-btn" onclick="flagMoment()" title="Flag a Moment (Spacebar)" data-flag-count="0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                        <line x1="4" y1="22" x2="4" y2="15"/>
                    </svg>
                </button>
                <button class="scribe-toggle-btn" id="toggleTranscriptBtn" onclick="toggleScribeTranscript()" title="Toggle Live Transcription">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                </button>
                <button class="scribe-toggle-btn" id="togglePrioritiesBtn" onclick="toggleScribePriorities()" title="Toggle Visit Priorities">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
                        <path d="M9 14l2 2 4-4"/>
                    </svg>
                </button>
            </div>
            
            <!-- Keyboard Shortcut Hint -->
            <div class="keyboard-hint">
                <kbd>Space</kbd> to flag a moment
            </div>
        `;

    }

}


function startConsultationRecording() {

    console.log('=== STARTING CONSULTATION RECORDING (SIZE 1 OVERLAY) ===');

    const button = document.querySelector('.start-consultation-btn');

    const buttonText = button.querySelector('.button-text');

    const overlay = document.getElementById('consultationOverlay');

    

    // Set consultation as active

    isConsultationActive = true;

    isPaused = false;

    pausedDuration = 0;

    consultationStartTime = new Date();

    // Reset scribe sidebar
    if (typeof resetScribeSidebar === 'function') resetScribeSidebar();

    // Add recording-active class to show minimize button

    if (overlay) {

        overlay.classList.add('recording-active');

    }

    

    // Reset flag counter and moments

    flaggedMoments = [];

    flagCounter = 0;

    updateFlagCounter();

    

    // Start the timer

    startConsultationTimer();

    

    // Start simple wave animation

    startSimpleWaveAnimation();

    

    // Update button to "Stop Consultation"

    buttonText.textContent = 'Stop Consultation';

    button.title = 'Stop AI Consultation';

    

    // Update button styling to stop state

    button.classList.add('stop-state');
    
    // Start streaming transcription
    // startStreaming(); // DISABLED: bridge handles audio via KVS, not browser mic

    

    // Keep Size 1 overlay visible (don't show Size 2)

    // The overlay is already active from the consent process

    

    console.log('Consultation recording started with Size 1 overlay at:', consultationStartTime);
    // Fetch active session from backend and start transcript polling
    (function startPollingFromBackend() {
        var backendUrl = window.BACKEND_URL || '';
        fetch(backendUrl + '/api/active-session')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success && data.sessionId) {
                    window.currentStreamingSessionId = data.sessionId;
                    currentStreamingSessionId = data.sessionId;
                    console.log("[Consultation] Got active session from backend:", data.sessionId);
                    if (typeof window.startTranscriptPollingGlobal === "function") {
                        window.startTranscriptPollingGlobal(data.sessionId);
                    }
                } else {
                    console.log("[Consultation] No active session yet, retrying in 3s...");
                    setTimeout(startPollingFromBackend, 3000);
                }
            })
            .catch(function(e) {
                console.warn("[Consultation] Failed to fetch active session:", e);
                setTimeout(startPollingFromBackend, 3000);
            });
    })();

}


function actuallyStartConsultation() {

    console.log('=== ACTUALLY STARTING CONSULTATION ===');

    const button = document.querySelector('.start-consultation-btn');

    const buttonText = button.querySelector('.button-text');

    

    // Set consultation as active

    isConsultationActive = true;

    isPaused = false;

    pausedDuration = 0;

    consultationStartTime = new Date();

    

    // Reset flag counter and moments

    flaggedMoments = [];

    flagCounter = 0;

    updateFlagCounter();

    

    // Start the timer

    startConsultationTimer();

    

    // Start simple wave animation

    startSimpleWaveAnimation();

    

    // Update button to "Stop Consultation"

    buttonText.textContent = 'Stop Consultation';

    button.title = 'Stop AI Consultation';

    

    // Update button styling to stop state

    button.classList.add('stop-state');

    

    // Show the size 2 overlay (compact overlay in patient portal)

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if (overlaySize2) {

        overlaySize2.classList.add('active');

        console.log('Size 2 consultation overlay shown');

    }

    

    console.log('Consultation recording started at:', consultationStartTime);

}


function startSimpleWaveAnimation() {

    const waveBars = document.querySelectorAll('.wave-bar');

    

    waveBars.forEach((bar, index) => {

        // Ensure animation is running

        bar.style.animationPlayState = 'running';

        

        // Add slight randomization to make it more organic

        const baseDelay = index * 0.1;

        const randomOffset = Math.random() * 0.1;

        bar.style.animationDelay = (baseDelay + randomOffset) + 's';

    });

}


function startConsultationTimer() {

    consultationTimer = setInterval(() => {

        if (!isPaused && consultationStartTime) {

            const elapsed = new Date() - consultationStartTime - pausedDuration;

            const minutes = Math.floor(elapsed / 60000);

            const seconds = Math.floor((elapsed % 60000) / 1000);

            const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

            
            // Look up elements each tick (DOM may be rebuilt after pause/resume)
            const te = document.getElementById('scribeTimer');
            const te2 = document.getElementById('recordingTimerSize2');

            if (te) {

                te.textContent = timeString;

            }

            if (te2) {

                te2.textContent = timeString;

            }

        }

    }, 1000);

}


function pauseConsultation() {

    if (!isConsultationActive) return;

    const pauseBtnSize1 = document.getElementById('pauseScribeBtnSize1');
    const pauseBtnSize2 = document.getElementById('pauseScribeBtnSize2');
    const statusText = document.querySelector('#consultationOverlay .status-text');
    const recordingDot = document.querySelector('#consultationOverlay .recording-dot');
    const wavePaths = document.querySelectorAll('#consultationOverlay .wave-path');

    if (!isPaused) {
        // Pause
        isPaused = true;
        pauseStartTime = new Date();

        // Mute audio streaming
        if (typeof ConnectHealthStreaming !== 'undefined') ConnectHealthStreaming.pause();

        if (statusText) statusText.textContent = 'Paused';
        if (recordingDot) {
            recordingDot.style.background = '#f59e0b';
            recordingDot.style.animation = 'none';
        }
        wavePaths.forEach(path => {
            path.style.animationPlayState = 'paused';
            path.style.opacity = '0.2';
        });

        // Toggle icons via display (no innerHTML change)
        if (pauseBtnSize1) {
            pauseBtnSize1.querySelector('.pause-icon').style.display = 'none';
            pauseBtnSize1.querySelector('.play-icon').style.display = '';
            pauseBtnSize1.querySelector('.pause-label').style.display = 'none';
            pauseBtnSize1.querySelector('.resume-label').style.display = '';
            pauseBtnSize1.title = 'Resume Recording';
        }
        if (pauseBtnSize2) {
            pauseBtnSize2.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
            pauseBtnSize2.title = 'Resume Recording';
        }

    } else {
        // Resume
        isPaused = false;
        if (pauseStartTime) {
            pausedDuration += new Date() - pauseStartTime;
            pauseStartTime = null;
        }

        // Unmute audio streaming
        if (typeof ConnectHealthStreaming !== 'undefined') ConnectHealthStreaming.resume();

        if (statusText) statusText.textContent = 'Listening';
        if (recordingDot) {
            recordingDot.style.background = '#ef4444';
            recordingDot.style.animation = 'simplePulse 2s ease-in-out infinite';
        }
        wavePaths.forEach(path => {
            path.style.animationPlayState = 'running';
            path.style.opacity = '';
        });

        // Toggle icons back (no innerHTML change)
        if (pauseBtnSize1) {
            pauseBtnSize1.querySelector('.pause-icon').style.display = '';
            pauseBtnSize1.querySelector('.play-icon').style.display = 'none';
            pauseBtnSize1.querySelector('.pause-label').style.display = '';
            pauseBtnSize1.querySelector('.resume-label').style.display = 'none';
            pauseBtnSize1.title = 'Pause Recording';
        }
        if (pauseBtnSize2) {
            pauseBtnSize2.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
            pauseBtnSize2.title = 'Pause Recording';
        }
    }
}


function stopConsultation() {

    const overlay = document.getElementById('consultationOverlay');

    const overlaySize2 = document.getElementById('consultationOverlaySize2');

    if ((overlay || overlaySize2) && isConsultationActive) {

        isConsultationActive = false;

        isPaused = false;
        
        // Stop streaming
        stopConnectHealthStreaming();

        

        // Remove recording-active class to hide minimize button

        if (overlay) overlay.classList.remove('recording-active');

        

        // Clear timer

        if (consultationTimer) {

            clearInterval(consultationTimer);

            consultationTimer = null;

        }

        

        // Calculate final duration

        let totalDuration = 0;

        if (consultationStartTime) {

            totalDuration = new Date() - consultationStartTime - pausedDuration;

        }

        

        // Hide both overlays with smooth animation

        if (overlay) overlay.classList.remove('active');

        if (overlaySize2) overlaySize2.classList.remove('active');

        

        // Hide backdrop

        const backdrop = document.getElementById('consultationBackdrop');

        if (backdrop) backdrop.classList.remove('active');

        

        // Restore UI

        document.body.style.overflow = '';

        

        // Reset timer display and UI elements

        setTimeout(() => {

            const timerElement = document.getElementById('scribeTimer');

            const pauseBtnSize1 = document.getElementById('pauseScribeBtnSize1');

            const pauseBtnSize2 = document.getElementById('pauseScribeBtnSize2');

            const statusText = document.querySelector('.status-text');

            const recordingDot = document.querySelector('.recording-dot');

            

            if (timerElement) timerElement.textContent = '00:00';

            if (statusText) statusText.textContent = 'Listening';

            if (recordingDot) {

                recordingDot.style.background = '#ef4444';

                recordingDot.style.animation = 'futuristicPulse 2s ease-in-out infinite';

                recordingDot.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.6), 0 0 20px rgba(239, 68, 68, 0.3)';

            }

            

            const pauseIcon = `

                <svg viewBox="0 0 24 24" fill="currentColor">

                    <rect x="6" y="4" width="4" height="16"/>

                    <rect x="14" y="4" width="4" height="16"/>

                </svg>

            `;

            if (pauseBtnSize1) {

                pauseBtnSize1.innerHTML = pauseIcon;

                pauseBtnSize1.title = 'Pause Recording';

            }

            if (pauseBtnSize2) {

                pauseBtnSize2.innerHTML = pauseIcon;

                pauseBtnSize2.title = 'Pause Recording';

            }

        }, 600);

        

        // Mark consultation as completed and disable button permanently

        isConsultationCompleted = true;

        disableConsultationButton();

        

        console.log(`Consultation ended. Duration: ${minutes}m ${seconds}s`);

    }

}


function disableConsultationButton() {

    const button = document.querySelector('.start-consultation-btn');

    const buttonText = button.querySelector('.button-text');

    

    if (button && buttonText) {

        // Update button text and styling to disabled state

        buttonText.textContent = 'Consultation Completed';

        button.title = 'Consultation has been completed and cannot be restarted';

        

        // Remove stop state styling and add disabled styling

        button.classList.remove('stop-state');

        button.classList.add('disabled-state');

        

        // Disable button interaction

        button.style.pointerEvents = 'none';

        button.style.cursor = 'not-allowed';

        

        console.log('Consultation button permanently disabled');

    }

}


function initializeConsultationOverlay() {

    // Ensure all elements are properly initialized

    const timerElement = document.getElementById('scribeTimer');

    if (timerElement) {

        timerElement.textContent = '00:00';

    }

    

    // Initialize wave bars

    const waveBars = document.querySelectorAll('.wave-bar');

    waveBars.forEach((bar, index) => {

        bar.style.animationDelay = (index * 0.1) + 's';

    });

}


function exportTranscription() {

    console.log('Exporting transcription...');

    // Add export functionality here

}


function shareRecording() {

    console.log('Sharing recording...');

    // Add share functionality here

}


function playRecording() {

    console.log('Playing recording...');

    // Add playback functionality here

}


function downloadRecording() {

    console.log('Downloading recording...');

    // Add download functionality here

}


// ==========================================================================

// STOP CONSULTATION CONFIRMATION SYSTEM - IN-OVERLAY TRANSITION

// ==========================================================================

function showStopConsultationConfirmation() {

    console.log('=== SHOWING STOP CONFIRMATION IN OVERLAY ===');

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    if (scribeInterface) {

        // Smooth transition with consistent timing

        scribeInterface.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), filter 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)';

        scribeInterface.style.opacity = '0';

        scribeInterface.style.transform = 'scale(0.98)';

        scribeInterface.style.filter = 'blur(8px)';

        

        setTimeout(() => {

            scribeInterface.innerHTML = `

                <div class="stop-confirmation-content">

                    <div class="stop-confirmation-icon">

                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">

                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>

                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>

                            <line x1="12" y1="19" x2="12" y2="23"/>

                            <line x1="8" y1="23" x2="16" y2="23"/>

                        </svg>

                    </div>

                    

                    <div class="stop-confirmation-header">

                        <h2>End Listening?</h2>

                        <p>The AI will analyze your consultation and generate structured clinical notes for your review and approval.</p>

                    </div>

                    

                    <div class="stop-confirmation-actions">

                        <button class="stop-confirmation-btn cancel-stop" onclick="cancelStopConfirmation()">

                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <line x1="18" y1="6" x2="6" y2="18"/>

                                <line x1="6" y1="6" x2="18" y2="18"/>

                            </svg>

                            Keep Listening

                        </button>

                        <button class="stop-confirmation-btn confirm-stop" onclick="confirmStopConsultation()">

                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <polyline points="20 6 9 17 4 12"/>

                            </svg>

                            Finish & Save

                        </button>

                    </div>

                </div>

            `;

            

            // Smooth fade back in with new content

            requestAnimationFrame(() => {

                scribeInterface.style.opacity = '1';

                scribeInterface.style.transform = 'scale(1)';

                scribeInterface.style.filter = 'blur(0px)';

            });

        }, 800);

        

        console.log('Stop confirmation content morphed into overlay');

    }

}


function cancelStopConfirmation() {

    console.log('=== STOP CONFIRMATION CANCELLED - RETURNING TO RECORDING ===');

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    if (scribeInterface) {

        // Smooth transition back to recording interface

        scribeInterface.style.transition = 'opacity 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.8s cubic-bezier(0.4, 0.0, 0.2, 1), filter 0.8s cubic-bezier(0.4, 0.0, 0.2, 1)';

        scribeInterface.style.opacity = '0';

        scribeInterface.style.transform = 'scale(0.98)';

        scribeInterface.style.filter = 'blur(8px)';

        

        setTimeout(() => {

            // Restore recording interface

            resetScribeInterfaceContent();

            

            // Smooth fade back in

            requestAnimationFrame(() => {

                scribeInterface.style.opacity = '1';

                scribeInterface.style.transform = 'scale(1)';

                scribeInterface.style.filter = 'blur(0px)';

            });

        }, 800);

    }

}


function hideStopConsultationConfirmation() {

    // No longer needed - keeping for compatibility

    console.log('hideStopConsultationConfirmation called (deprecated)');

}


function confirmStopConsultation() {

    console.log('=== USER CONFIRMED STOP CONSULTATION ===');

    // Close scribe sidebar panels
    if (typeof resetScribeSidebar === 'function') resetScribeSidebar();

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    // Stop the recording timer and update state WITHOUT closing the overlay

    if (isConsultationActive) {

        isConsultationActive = false;

        isPaused = false;

        
        // Stop streaming
        stopConnectHealthStreaming();

        // Remove recording-active class to hide minimize button

        if (overlay) overlay.classList.remove('recording-active');

        

        // Clear timer

        if (consultationTimer) {

            clearInterval(consultationTimer);

            consultationTimer = null;

        }

        

        // Calculate final duration for later use

        let totalDuration = 0;

        if (consultationStartTime) {

            totalDuration = new Date() - consultationStartTime - pausedDuration;

        }

        

        // Store duration for completion notification

        window.consultationDuration = totalDuration;

        

        console.log('Recording stopped, keeping overlay open for processing');

    }

    

    // Morph to processing workflow within the same overlay

    if (scribeInterface) {

        scribeInterface.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        scribeInterface.style.opacity = '0';

        scribeInterface.style.transform = 'scale(0.96)';

        

        setTimeout(() => {

            startProcessingWorkflowInOverlay();

        }, 300);

    }

}


// ==========================================================================

// PROCESSING WORKFLOW FUNCTIONS - IN-OVERLAY VERSION

// ==========================================================================

// Store fetched S3 data during processing
let processingS3Data = null;

function startProcessingWorkflowInOverlay() {

    console.log('=== STARTING PROCESSING WORKFLOW IN OVERLAY ===');

    const overlay = document.getElementById('consultationOverlay');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    console.log('Overlay found:', !!overlay);

    console.log('ScribeInterface found:', !!scribeInterface);

    

    if (!scribeInterface) {

        console.error('ScribeInterface not found! Cannot show processing workflow.');

        return;

    }

    
    // Reset S3 data
    processingS3Data = null;
    
    console.log('Setting processing content HTML...');

    

    // Soft transition out

    scribeInterface.style.transition = 'opacity 0.5s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.5s cubic-bezier(0.4, 0.0, 0.2, 1), filter 0.5s cubic-bezier(0.4, 0.0, 0.2, 1)';

    scribeInterface.style.opacity = '0';

    scribeInterface.style.transform = 'scale(0.98) translateY(-8px)';

    scribeInterface.style.filter = 'blur(8px)';

    

    setTimeout(() => {

        // Show processing content

        scribeInterface.innerHTML = `

            <div class="processing-content-inline">

                <div class="processing-spinner">

                    <div class="spinner-ring"></div>

                </div>

                

                <div class="processing-header">

                    <h2 class="processing-title">Generating Clinical Notes</h2>

                    <p class="processing-subtitle">AI is analyzing your consultation</p>

                </div>

                

                <div class="processing-steps">

                    <div class="processing-step" id="inlineStep1">

                        <div class="step-icon">

                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>

                            </svg>

                        </div>

                        <span class="step-text">Extracting clinical information</span>

                    </div>

                    

                    <div class="processing-step" id="inlineStep2">

                        <div class="step-icon">

                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>

                                <polyline points="22 4 12 14.01 9 11.01"/>

                            </svg>

                        </div>

                        <span class="step-text">Cross-checking with patient data</span>

                    </div>

                    

                    <div class="processing-step" id="inlineStep3">

                        <div class="step-icon">

                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>

                                <polyline points="14,2 14,8 20,8"/>

                                <line x1="16" y1="13" x2="8" y2="13"/>

                                <line x1="16" y1="17" x2="8" y2="17"/>

                            </svg>

                        </div>

                        <span class="step-text">Formatting clinical notes</span>

                    </div>

                    

                    <div class="processing-step" id="inlineStep4">

                        <div class="step-icon">

                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                                <polyline points="16 18 22 12 16 6"/>

                                <polyline points="8 6 2 12 8 18"/>

                            </svg>

                        </div>

                        <span class="step-text">Generating medical codes</span>

                    </div>

                </div>

            </div>

        `;

        

        console.log('Processing content HTML set');

        

        // Soft fade in with new content

        requestAnimationFrame(() => {

            scribeInterface.style.opacity = '1';

            scribeInterface.style.transform = 'scale(1) translateY(0)';

            scribeInterface.style.filter = 'blur(0px)';

        });

        

        console.log('Starting real S3 polling for processing steps...');

        
        // Start real S3 polling instead of fake animation
        startRealProcessingWithS3Polling();

    }, 250);

}

/**
 * Poll S3 for actual data and update processing steps accordingly
 */
async function startRealProcessingWithS3Polling() {
    const sessionId = currentStreamingSessionId;
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    
    if (!sessionId) {
        console.log('[Processing] No session ID, using simulated steps');
        runSimulatedProcessingSteps();
        return;
    }
    
    // Demo mode: use timed simulation that fetches cached data at the end
    if (window.DEMO_MODE) {
        console.log('[Processing] DEMO MODE — simulated processing with cached data');
        markStepActive('inlineStep1');
        
        setTimeout(() => {
            markStepCompleted('inlineStep1');
            markStepActive('inlineStep2');
        }, 1500);
        
        setTimeout(() => {
            markStepCompleted('inlineStep2');
            markStepActive('inlineStep3');
        }, 3000);
        
        setTimeout(() => {
            markStepCompleted('inlineStep3');
            markStepActive('inlineStep4');
        }, 4500);
        
        setTimeout(async () => {
            // Fetch cached data from backend (demo header is auto-injected by fetch interceptor)
            try {
                const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/outputs`);
                const result = await response.json();
                if (result.success && result.outputs) {
                    processingS3Data = result.outputs;
                    // Also populate streamingSessionOutputs directly for downstream use
                    streamingSessionOutputs = result.outputs;
                    console.log('[Processing] DEMO — cached data loaded:', Object.keys(result.outputs));
                }
            } catch (e) {
                console.warn('[Processing] DEMO — failed to fetch cached data:', e);
            }
            
            markStepCompleted('inlineStep4');
            setTimeout(() => transitionToSoapNotes(), 500);
        }, 5500);
        
        return;
    }
    
    console.log('[Processing] Polling S3 for session:', sessionId);
    
    // Step 1: Extracting clinical information - start immediately
    markStepActive('inlineStep1');
    
    // Poll for S3 data
    const MAX_POLL_TIME = 90000; // 90 seconds max
    const POLL_INTERVAL = 2000; // 2 seconds
    const startTime = Date.now();
    
    let hasTranscript = false;
    let hasClinicalDoc = false;
    let hasMedicalCodes = false;
    
    async function pollS3() {
        const elapsed = Date.now() - startTime;
        
        if (elapsed > MAX_POLL_TIME) {
            console.log('[Processing] Max poll time reached, transitioning with available data');
            completeRemainingSteps();
            return;
        }
        
        try {
            const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/outputs`);
            const result = await response.json();
            
            if (result.success && result.outputs) {
                const outputs = result.outputs;
                
                // Check transcript (Step 1)
                if (!hasTranscript && outputs.transcript && !outputs.transcript.error) {
                    hasTranscript = true;
                    markStepCompleted('inlineStep1');
                    markStepActive('inlineStep2');
                    console.log('[Processing] Transcript ready');
                }
                
                // Check clinical doc (Step 2 & 3)
                if (!hasClinicalDoc && outputs.clinicalDoc && !outputs.clinicalDoc.error) {
                    hasClinicalDoc = true;
                    if (!hasTranscript) {
                        markStepCompleted('inlineStep1');
                    }
                    markStepCompleted('inlineStep2');
                    markStepActive('inlineStep3');
                    
                    // Brief delay then complete step 3
                    setTimeout(() => {
                        markStepCompleted('inlineStep3');
                        markStepActive('inlineStep4');
                    }, 500);
                    
                    // Store the clinical doc
                    processingS3Data = processingS3Data || {};
                    processingS3Data.clinicalDoc = outputs.clinicalDoc;
                    console.log('[Processing] Clinical doc ready');
                }
                
                // Check medical codes (Step 4)
                if (!hasMedicalCodes && outputs.medicalCodes && !outputs.medicalCodes.error) {
                    hasMedicalCodes = true;
                    markStepCompleted('inlineStep4');
                    
                    // Store the medical codes
                    processingS3Data = processingS3Data || {};
                    processingS3Data.medicalCodes = outputs.medicalCodes;
                    console.log('[Processing] Medical codes ready');
                    
                    // All done! Transition to SOAP notes
                    setTimeout(() => {
                        transitionToSoapNotes();
                    }, 500);
                    return;
                }
                
                // If we have clinical doc but not codes yet, keep polling
                if (hasClinicalDoc && !hasMedicalCodes) {
                    // Continue polling for medical codes
                    setTimeout(pollS3, POLL_INTERVAL);
                    return;
                }
            }
            
            // Continue polling
            setTimeout(pollS3, POLL_INTERVAL);
            
        } catch (error) {
            console.error('[Processing] Poll error:', error);
            // Continue polling despite error
            setTimeout(pollS3, POLL_INTERVAL);
        }
    }
    
    // Start polling after a brief delay
    setTimeout(pollS3, 1000);
}

/**
 * Mark a processing step as active (spinning)
 */
function markStepActive(stepId) {
    const stepElement = document.getElementById(stepId);
    if (stepElement) {
        stepElement.classList.add('active');
        const stepIcon = stepElement.querySelector('.step-icon');
        if (stepIcon) {
            stepIcon.innerHTML = '<div class="step-spinner"></div>';
        }
    }
}

/**
 * Mark a processing step as completed (checkmark)
 */
function markStepCompleted(stepId) {
    const stepElement = document.getElementById(stepId);
    if (stepElement) {
        stepElement.classList.remove('active');
        stepElement.classList.add('completed');
        const stepIcon = stepElement.querySelector('.step-icon');
        if (stepIcon) {
            stepIcon.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;
        }
    }
}

/**
 * Complete any remaining steps quickly and transition
 */
function completeRemainingSteps() {
    const steps = ['inlineStep1', 'inlineStep2', 'inlineStep3', 'inlineStep4'];
    let delay = 0;
    
    steps.forEach(stepId => {
        const stepElement = document.getElementById(stepId);
        if (stepElement && !stepElement.classList.contains('completed')) {
            setTimeout(() => {
                markStepCompleted(stepId);
            }, delay);
            delay += 300;
        }
    });
    
    // Transition after all steps complete
    setTimeout(() => {
        transitionToSoapNotes();
    }, delay + 500);
}

/**
 * Run simulated processing steps (fallback when no session ID)
 */
function runSimulatedProcessingSteps() {
    const steps = [
        { id: 'inlineStep1', duration: 1000 },
        { id: 'inlineStep2', duration: 1250 },
        { id: 'inlineStep3', duration: 1000 },
        { id: 'inlineStep4', duration: 750 }
    ];

    let currentStep = 0;

    function processNextStep() {
        if (currentStep < steps.length) {
            const step = steps[currentStep];
            markStepActive(step.id);

            setTimeout(() => {
                markStepCompleted(step.id);
                currentStep++;
                processNextStep();
            }, step.duration);
        } else {
            setTimeout(() => {
                transitionToSoapNotes();
            }, 250);
        }
    }

    processNextStep();
}

function transitionToSoapNotes() {

    console.log('=== TRANSITIONING TO SOAP NOTES ===');

    const overlay = document.getElementById('consultationOverlay');

    const mainBackdrop = document.getElementById('consultationBackdrop');

    const scribeInterface = overlay ? overlay.querySelector('.scribe-interface') : null;

    

    // Fade out the processing content

    if (scribeInterface) {

        scribeInterface.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

        scribeInterface.style.opacity = '0';

        scribeInterface.style.transform = 'scale(0.96)';

    }

    

    setTimeout(() => {

        // Close the consultation overlay

        if (overlay) {

            overlay.classList.remove('active');

        }

        if (mainBackdrop) {

            mainBackdrop.classList.remove('active');

        }

        

        // Restore body scrolling

        document.body.style.overflow = '';

        

        // Reset the scribe interface for next time

        setTimeout(() => {

            resetScribeInterfaceContent();

        }, 300);

        

        // Mark consultation as completed and disable button

        isConsultationCompleted = true;

        disableConsultationButton();

        

        // Show SOAP notes overlay

        showSoapNotes();

    }, 300);

}


function startProcessingWorkflow() {

    const processingOverlay = document.getElementById('processingOverlay');

    if (!processingOverlay) return;


    // Show processing overlay

    processingOverlay.classList.add('active');


    // Simulate processing steps

    const steps = [

        { id: 'step1', duration: 1000 },

        { id: 'step2', duration: 1250 },

        { id: 'step3', duration: 1000 },

        { id: 'step4', duration: 750 }

    ];


    let currentStep = 0;


    function processNextStep() {

        if (currentStep < steps.length) {

            const step = steps[currentStep];

            const stepElement = document.getElementById(step.id);

            

            // Mark as active

            stepElement.classList.add('active');

            

            // Replace icon with spinner

            const stepIcon = stepElement.querySelector('.step-icon');

            stepIcon.innerHTML = '<div class="step-spinner"></div>';


            // After duration, mark as completed

            setTimeout(() => {

                stepElement.classList.remove('active');

                stepElement.classList.add('completed');

                

                // Replace spinner with checkmark

                stepIcon.innerHTML = `

                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">

                        <polyline points="20 6 9 17 4 12"/>

                    </svg>

                `;


                currentStep++;

                processNextStep();

            }, step.duration);

        } else {

            // All steps completed, smooth transition to SOAP notes

            setTimeout(() => {

                // Fade out processing overlay

                processingOverlay.style.transition = 'opacity 0.4s cubic-bezier(0.4, 0.0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0.0, 0.2, 1)';

                processingOverlay.style.opacity = '0';

                processingOverlay.style.transform = 'scale(0.98)';

                

                setTimeout(() => {

                    processingOverlay.classList.remove('active');

                    processingOverlay.style.opacity = '';

                    processingOverlay.style.transform = '';

                    

                    // Fade in SOAP notes

                    showSoapNotes();

                }, 400);

            }, 250);

        }

    }


    // Start processing

    processNextStep();

}


async function showSoapNotes() {

    // Inject SOAP notes into the right panel of the patient portal (not overlay)
    
    // Get the data first
    if (processingS3Data && (processingS3Data.clinicalDoc || processingS3Data.medicalCodes)) {
        console.log('[SOAP] Using pre-fetched S3 data from processing phase');
        if (processingS3Data.clinicalDoc && !processingS3Data.clinicalDoc.error) {
            if (!streamingSessionOutputs) streamingSessionOutputs = {};
            streamingSessionOutputs.clinicalDoc = processingS3Data.clinicalDoc;
        }
        if (processingS3Data.medicalCodes && !processingS3Data.medicalCodes.error) {
            if (!streamingSessionOutputs) streamingSessionOutputs = {};
            streamingSessionOutputs.medicalCodes = processingS3Data.medicalCodes;
        }
        processingS3Data = null;
    } else if (currentStreamingSessionId && (!streamingSessionOutputs || !streamingSessionOutputs.clinicalDoc)) {
        console.log('[SOAP] Fetching S3 outputs for session:', currentStreamingSessionId);
        const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
        try {
            const response = await fetch(`${backendUrl}/api/streaming/session/${currentStreamingSessionId}/outputs`);
            const result = await response.json();
            if (result.success && result.outputs) {
                streamingSessionOutputs = result.outputs;
            }
        } catch(e) { console.warn('[SOAP] Failed to fetch outputs:', e); }
    }

    // Inject into right panel
    injectSoapIntoRightPanel();
}

/**
 * Fetch streaming session outputs from S3 and display them
 * @param {string} sessionId - The streaming session ID
 * @param {number} retryCount - Number of retries (for waiting for S3 data)
 */
async function fetchAndDisplayStreamingOutputs(sessionId, retryCount = 0) {
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    const MAX_RETRIES = 20;  // 20 retries x 3 seconds = 60 seconds max wait
    const RETRY_DELAY = 3000; // 3 seconds between retries
    
    try {
        // Show loading state in SOAP notes
        showSoapNotesLoading();
        
        // Fetch all outputs from the backend
        const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/outputs`);
        const result = await response.json();
        
        if (!result.success) {
            console.error('[SOAP] Failed to fetch S3 outputs:', result.error);
            // Fall back to default content
            restoreDefaultSoapContent();
            generateAndDisplayMedicalCodes();
            return;
        }
        
        // Store the outputs globally
        streamingSessionOutputs = result.outputs;
        console.log('[SOAP] Fetched S3 outputs:', Object.keys(streamingSessionOutputs));
        
        // Check if we got actual data (not null/error)
        const hasClinicDoc = streamingSessionOutputs.clinicalDoc && !streamingSessionOutputs.clinicalDoc.error;
        const hasMedicalCodes = streamingSessionOutputs.medicalCodes && !streamingSessionOutputs.medicalCodes.error;
        
        // If we have clinical doc but not medical codes, display clinical doc and keep retrying for codes
        if (hasClinicDoc && !hasMedicalCodes) {
            console.log('[SOAP] Clinical doc ready, but medical codes not yet available');
            displayClinicalDoc(streamingSessionOutputs.clinicalDoc);
            
            // Show loading state for codes and retry
            const codeListContainer = document.querySelector('.code-list-sidebar');
            if (codeListContainer) {
                codeListContainer.textContent = '';
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'codes-loading';
                const spinner = document.createElement('div');
                spinner.className = 'codes-loading-spinner';
                const label = document.createElement('span');
                label.textContent = `Generating medical codes... (${retryCount + 1}/${MAX_RETRIES})`;
                loadingDiv.appendChild(spinner);
                loadingDiv.appendChild(label);
                codeListContainer.appendChild(loadingDiv);
            }
            
            if (retryCount < MAX_RETRIES) {
                setTimeout(() => {
                    fetchMedicalCodesOnly(sessionId, retryCount + 1);
                }, RETRY_DELAY);
            } else {
                console.log('[SOAP] Max retries for medical codes, using fallback');
                generateAndDisplayMedicalCodes();
            }
            return;
        }
        
        if (!hasClinicDoc && !hasMedicalCodes) {
            // S3 data not ready yet - retry if we haven't exceeded max retries
            if (retryCount < MAX_RETRIES) {
                console.log(`[SOAP] S3 data not ready, retrying in ${RETRY_DELAY}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                setTimeout(() => {
                    fetchAndDisplayStreamingOutputs(sessionId, retryCount + 1);
                }, RETRY_DELAY);
                return;
            } else {
                console.log('[SOAP] Max retries reached, falling back to default content');
                restoreDefaultSoapContent();
                generateAndDisplayMedicalCodes();
                return;
            }
        }
        
        // Display the clinical document (SOAP notes)
        if (hasClinicDoc) {
            displayClinicalDoc(streamingSessionOutputs.clinicalDoc);
        } else {
            restoreDefaultSoapContent();
        }
        
        // Display the medical codes
        if (hasMedicalCodes) {
            displayMedicalCodesFromS3(streamingSessionOutputs.medicalCodes);
        } else {
            // Fall back to API-generated codes
            generateAndDisplayMedicalCodes();
        }
        
    } catch (error) {
        console.error('[SOAP] Error fetching S3 outputs:', error);
        // Fall back to default content
        restoreDefaultSoapContent();
        generateAndDisplayMedicalCodes();
    }
}

/**
 * Fetch only medical codes from S3 (used when clinical doc is ready but codes aren't)
 * @param {string} sessionId - The streaming session ID
 * @param {number} retryCount - Number of retries
 */
async function fetchMedicalCodesOnly(sessionId, retryCount = 0) {
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    const MAX_RETRIES = 20;  // 20 retries x 3 seconds = 60 seconds max wait
    const RETRY_DELAY = 3000;
    
    try {
        const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/medical-codes`);
        const result = await response.json();
        
        if (result.success && result.medicalCodes && !result.medicalCodes.error) {
            console.log('[SOAP] Medical codes now available');
            displayMedicalCodesFromS3(result.medicalCodes);
        } else if (retryCount < MAX_RETRIES) {
            console.log(`[SOAP] Medical codes still not ready, retry ${retryCount + 1}/${MAX_RETRIES}`);
            
            // Update loading message
            const codeListContainer = document.querySelector('.code-list-sidebar');
            if (codeListContainer) {
                codeListContainer.textContent = '';
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'codes-loading';
                const spinner = document.createElement('div');
                spinner.className = 'codes-loading-spinner';
                const label = document.createElement('span');
                label.textContent = `Generating medical codes... (${retryCount + 1}/${MAX_RETRIES})`;
                loadingDiv.appendChild(spinner);
                loadingDiv.appendChild(label);
                codeListContainer.appendChild(loadingDiv);
            }
            
            setTimeout(() => {
                fetchMedicalCodesOnly(sessionId, retryCount + 1);
            }, RETRY_DELAY);
        } else {
            console.log('[SOAP] Max retries for medical codes, using fallback');
            generateAndDisplayMedicalCodes();
        }
    } catch (error) {
        console.error('[SOAP] Error fetching medical codes:', error);
        generateAndDisplayMedicalCodes();
    }
}

/**
 * Fetch and display After Visit Summary from S3
 */
async function fetchAndDisplayAfterVisitSummary() {
    const sessionId = currentStreamingSessionId;
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    const contentDiv = document.getElementById('afterVisitSummaryContent');
    
    if (!contentDiv) return;
    
    // If no session ID, show default message
    if (!sessionId) {
        contentDiv.innerHTML = `
            <div class="avs-paragraphs">
                <p class="avs-paragraph">Today we discussed your ongoing health concerns and reviewed your current treatment plan.</p>
                <p class="avs-paragraph">Please continue taking your medications as prescribed and follow the care plan we discussed.</p>
                <p class="avs-followup">Please schedule a follow-up appointment in 2-4 weeks to review your progress.</p>
            </div>
        `;
        return;
    }
    
    try {
        const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/after-visit-summary`);
        const result = await response.json();
        
        if (result.success && result.afterVisitSummary) {
            displayAfterVisitSummary(result.afterVisitSummary);
        } else {
            // Show default content if no summary available
            contentDiv.innerHTML = `
                <div class="avs-paragraphs">
                    <p class="avs-paragraph">Your visit summary is being prepared and will be available in your patient portal shortly.</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('[AVS] Error fetching after visit summary:', error);
        contentDiv.innerHTML = `
            <div class="avs-paragraphs">
                <p class="avs-paragraph">Your visit summary will be available in your patient portal.</p>
            </div>
        `;
    }
}

/**
 * Display the After Visit Summary content
 * @param {Object} avsData - The after visit summary data from S3
 */
function displayAfterVisitSummary(avsData) {
    const contentDiv = document.getElementById('afterVisitSummaryContent');
    if (!contentDiv) return;
    
    console.log('[AVS] Displaying after visit summary:', avsData);
    
    // Parse the AVS structure
    // Format: { AfterVisitSummary: { SummarizedSegments: [...] } }
    let segments = [];
    
    if (avsData.AfterVisitSummary && avsData.AfterVisitSummary.SummarizedSegments) {
        segments = avsData.AfterVisitSummary.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
    } else if (avsData.SummarizedSegments) {
        segments = avsData.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
    } else if (Array.isArray(avsData)) {
        segments = avsData.map(s => s.SummarizedSegment || s).filter(s => s);
    }
    
    if (segments.length === 0) {
        contentDiv.innerHTML = `
            <div class="avs-paragraphs">
                <p class="avs-paragraph">Your visit summary will be available in your patient portal.</p>
            </div>
        `;
        return;
    }
    
    // Build HTML - identify special segments
    let html = '<div class="avs-paragraphs">';
    
    segments.forEach((segment, index) => {
        const text = segment.trim().replace(/\n+/g, ' ');
        
        // Check if this is a follow-up/scheduling segment
        if (text.toLowerCase().includes('come back') || 
            text.toLowerCase().includes('follow-up') || 
            text.toLowerCase().includes('schedule') ||
            text.toLowerCase().includes('appointment')) {
            html += `<p class="avs-paragraph avs-followup">${escapeHtml(text)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        }
        // Check if this is an action/instruction segment
        else if (text.toLowerCase().includes('please take') || 
                 text.toLowerCase().includes('please continue') ||
                 text.toLowerCase().includes('as prescribed')) {
            html += `<p class="avs-paragraph avs-action">${escapeHtml(text)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        }
        // Regular paragraph
        else {
            html += `<p class="avs-paragraph">${escapeHtml(text)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        }
    });
    
    html += '</div>';
    contentDiv.innerHTML = html; // nosemgrep: insecure-innerhtml, insecure-document-method — AVS segments from trusted AWS API, all values passed through escapeHtml()
}

/**
 * Fetch and populate the Patient Visit Summary overlay with real API data
 */
async function fetchAndPopulatePatientVisitSummary() {
    const sessionId = currentStreamingSessionId;
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    
    const loadingDiv = document.getElementById('patientSummaryLoading');
    const contentDiv = document.getElementById('patientSummaryContent');
    
    // Populate date and visit type immediately
    populatePatientSummaryMeta();
    
    // Show loading state
    if (loadingDiv) loadingDiv.style.display = 'flex';
    if (contentDiv) contentDiv.style.display = 'none';
    
    // If no session ID, show default content
    if (!sessionId) {
        console.log('[PatientSummary] No session ID, showing default content');
        populatePatientSummaryWithDefaults();
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (contentDiv) contentDiv.style.display = 'block';
        return;
    }
    
    try {
        console.log('[PatientSummary] Fetching AVS for session:', sessionId);
        const response = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/after-visit-summary`);
        const result = await response.json();
        
        if (result.success && result.afterVisitSummary) {
            console.log('[PatientSummary] Got AVS data (length=' + (result.afterVisitSummary || '').length + ' chars; content redacted — PHI)');
            // Store in streamingSessionOutputs for meta population
            if (!streamingSessionOutputs) streamingSessionOutputs = {};
            streamingSessionOutputs.afterVisitSummary = result.afterVisitSummary;
            
            populatePatientSummaryFromAVS(result.afterVisitSummary);
            // Update meta again now that we have AVS data
            populatePatientSummaryMeta();
        } else {
            console.log('[PatientSummary] No AVS data, using defaults');
            populatePatientSummaryWithDefaults();
        }
    } catch (error) {
        console.error('[PatientSummary] Error fetching AVS:', error);
        populatePatientSummaryWithDefaults();
    }
    
    // Hide loading, show content
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (contentDiv) contentDiv.style.display = 'block';
}

/**
 * Populate Patient Visit Summary sections from AVS data
 * @param {Object} avsData - The after visit summary data from S3
 */
function populatePatientSummaryFromAVS(avsData) {
    // Parse the AVS structure
    let segments = [];
    
    if (avsData.AfterVisitSummary && avsData.AfterVisitSummary.SummarizedSegments) {
        segments = avsData.AfterVisitSummary.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
    } else if (avsData.SummarizedSegments) {
        segments = avsData.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
    } else if (Array.isArray(avsData)) {
        segments = avsData.map(s => s.SummarizedSegment || s).filter(s => s);
    }
    
    console.log('[PatientSummary] Parsed segments (count=' + (segments || []).length + '; content redacted — PHI)');
    
    if (segments.length === 0) {
        populatePatientSummaryWithDefaults();
        return;
    }
    
    // Categorize segments based on content
    const categorized = {
        howYoureDoing: [],
        whatsChanging: [],
        whatYouCanDo: [],
        seeYouSoon: []
    };
    
    segments.forEach(segment => {
        const text = segment.trim();
        const lowerText = text.toLowerCase();
        
        // Categorize based on keywords
        if (lowerText.includes('follow-up') || lowerText.includes('come back') || 
            lowerText.includes('schedule') || lowerText.includes('appointment') ||
            lowerText.includes('next visit') || lowerText.includes('see you')) {
            categorized.seeYouSoon.push(text);
        }
        else if (lowerText.includes('medication') || lowerText.includes('prescri') ||
                 lowerText.includes('dosage') || lowerText.includes('take ') ||
                 lowerText.includes('changing') || lowerText.includes('increase') ||
                 lowerText.includes('decrease') || lowerText.includes('start taking')) {
            categorized.whatsChanging.push(text);
        }
        else if (lowerText.includes('should') || lowerText.includes('recommend') ||
                 lowerText.includes('please') || lowerText.includes('make sure') ||
                 lowerText.includes('try to') || lowerText.includes('continue') ||
                 lowerText.includes('avoid') || lowerText.includes('monitor')) {
            categorized.whatYouCanDo.push(text);
        }
        else {
            // Default to "How you're doing" for general visit info
            categorized.howYoureDoing.push(text);
        }
    });
    
    // Populate each section
    populateSummarySection('summaryHowYoureDoingContent', categorized.howYoureDoing, 'list');
    populateSummarySection('summaryWhatsChangingContent', categorized.whatsChanging, 'list');
    populateSummarySection('summaryWhatYouCanDoContent', categorized.whatYouCanDo, 'checklist');
    populateSummarySection('summarySeeYouSoonContent', categorized.seeYouSoon, 'list');
    
    // Hide empty sections
    toggleSectionVisibility('summaryHowYoureDoing', categorized.howYoureDoing.length > 0);
    toggleSectionVisibility('summaryWhatsChanging', categorized.whatsChanging.length > 0);
    toggleSectionVisibility('summaryWhatYouCanDo', categorized.whatYouCanDo.length > 0);
    toggleSectionVisibility('summarySeeYouSoon', categorized.seeYouSoon.length > 0);
}

/**
 * Populate a single summary section with items
 */
function populateSummarySection(containerId, items, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    if (items.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    
    if (type === 'checklist') {
        items.forEach(item => {
            // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            html += `
                <div class="checklist-item">
                    <div class="checkbox-wrapper">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        </svg>
                    </div>
                    <span>${escapeHtml(item)}</span>
                </div>
            `;
        });
    } else {
        items.forEach(item => {
            // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            html += `
                <div class="patient-summary-item">
                    <span>${escapeHtml(item)}</span>
                </div>
            `;
        });
    }
    
    container.innerHTML = html; // nosemgrep: insecure-innerhtml, insecure-document-method — patient summary items from trusted AWS API, all values passed through escapeHtml()
}

/**
 * Toggle visibility of a summary section
 */
function toggleSectionVisibility(sectionId, visible) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = visible ? 'block' : 'none';
    }
}

/**
 * Populate Patient Visit Summary with default content when no API data available
 */
function populatePatientSummaryWithDefaults() {
    // How you're doing
    const howYoureDoing = document.getElementById('summaryHowYoureDoingContent');
    if (howYoureDoing) {
        howYoureDoing.innerHTML = `
            <div class="patient-summary-item">
                <span>Your visit today went well</span>
            </div>
            <div class="patient-summary-item">
                <span>We discussed your current health concerns</span>
            </div>
        `;
    }
    
    // What's changing
    const whatsChanging = document.getElementById('summaryWhatsChangingContent');
    if (whatsChanging) {
        whatsChanging.innerHTML = `
            <div class="patient-summary-item">
                <span>Continue with your current treatment plan</span>
            </div>
        `;
    }
    
    // What you can do
    const whatYouCanDo = document.getElementById('summaryWhatYouCanDoContent');
    if (whatYouCanDo) {
        whatYouCanDo.innerHTML = `
            <div class="checklist-item">
                <div class="checkbox-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    </svg>
                </div>
                <span>Follow the care plan we discussed</span>
            </div>
            <div class="checklist-item">
                <div class="checkbox-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    </svg>
                </div>
                <span>Take medications as prescribed</span>
            </div>
        `;
    }
    
    // See you soon
    const seeYouSoon = document.getElementById('summarySeeYouSoonContent');
    if (seeYouSoon) {
        seeYouSoon.innerHTML = `
            <div class="patient-summary-item">
                <span>Schedule a follow-up appointment as recommended</span>
            </div>
            <div class="patient-summary-item">
                <span>Contact us if you have any questions</span>
            </div>
        `;
    }
    
    // Show all sections
    toggleSectionVisibility('summaryHowYoureDoing', true);
    toggleSectionVisibility('summaryWhatsChanging', true);
    toggleSectionVisibility('summaryWhatYouCanDo', true);
    toggleSectionVisibility('summarySeeYouSoon', true);
}

/**
 * Restore the default hardcoded SOAP notes content
 */
function restoreDefaultSoapContent() {
    const soapMain = document.querySelector('.soap-notes-main');
    if (!soapMain) return;

    // nosemgrep: insecure-innerhtml — static SOAP template with escapeHtml() on all dynamic values
    soapMain.innerHTML = `
        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">S</div>
                <div class="soap-section-title">Subjective</div>
            </div>
            <div class="soap-section-content">
                <p>No clinical documentation available. Start a consultation to generate SOAP notes.</p>
            </div>
        </div>
        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">O</div>
                <div class="soap-section-title">Objective</div>
            </div>
            <div class="soap-section-content">
                <p>No objective findings recorded.</p>
            </div>
        </div>
        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">A</div>
                <div class="soap-section-title">Assessment</div>
            </div>
            <div class="soap-section-content">
                <p>No assessment recorded.</p>
            </div>
        </div>
        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">P</div>
                <div class="soap-section-title">Plan</div>
            </div>
            <div class="soap-section-content">
                <p>No plan recorded.</p>
            </div>
        </div>
    `;
}

/**
 * Show loading state in SOAP notes overlay
 */
function showSoapNotesLoading() {
    const soapMain = document.querySelector('.soap-notes-main');
    const codeListContainer = document.querySelector('.code-list-sidebar');
    
    if (soapMain) {
        // nosemgrep: insecure-innerhtml — static loading spinner, no dynamic data
        soapMain.innerHTML = `
            <div class="soap-loading">
                <div class="soap-loading-spinner"></div>
                <span>Loading clinical documentation...</span>
            </div>
        `;
    }
    
    if (codeListContainer) {
        codeListContainer.innerHTML = `
            <div class="codes-loading">
                <div class="codes-loading-spinner"></div>
                <span>Loading medical codes...</span>
            </div>
        `;
    }
}

/**
 * Display clinical document (SOAP notes) from S3
 * @param {Object} clinicalDoc - The clinical document from S3
 */
function displayClinicalDoc(clinicalDoc) {
    const soapMain = document.querySelector('.soap-notes-main');
    if (!soapMain) return;
    
    console.log('[SOAP] Displaying clinical doc (length=' + (clinicalDoc || '').length + ' chars; content redacted — PHI)');
    
    // Parse the clinical document structure
    // ConnectHealth API format: { ClinicalDocumentation: { Sections: [...] } }
    let sections = {
        subjective: [],
        objective: [],
        assessment: [],
        plan: []
    };
    
    if (clinicalDoc.ClinicalDocumentation && clinicalDoc.ClinicalDocumentation.Sections) {
        // ConnectHealth API format - group sections by SOAP category
        const docSections = clinicalDoc.ClinicalDocumentation.Sections;
        docSections.forEach(section => {
            const sectionName = (section.SectionName || '').toUpperCase();
            // Subjective sections
            if (sectionName === 'SUBJECTIVE' || sectionName === 'CHIEF_COMPLAINT' || 
                sectionName === 'HISTORY_OF_PRESENT_ILLNESS' || sectionName === 'REVIEW_OF_SYSTEMS' ||
                sectionName === 'PAST_MEDICAL_HISTORY' || sectionName === 'SOCIAL_HISTORY' ||
                sectionName === 'FAMILY_HISTORY' || sectionName === 'ALLERGIES' ||
                sectionName === 'MEDICATIONS') {
                sections.subjective.push(section);
            } 
            // Objective sections
            else if (sectionName === 'OBJECTIVE' || sectionName === 'PHYSICAL_EXAMINATION' ||
                     sectionName === 'VITAL_SIGNS' || sectionName === 'PHYSICAL_EXAM') {
                sections.objective.push(section);
            } 
            // Assessment sections
            else if (sectionName === 'ASSESSMENT' || sectionName === 'DIAGNOSIS' ||
                     sectionName === 'DIFFERENTIAL_DIAGNOSIS') {
                sections.assessment.push(section);
            } 
            // Plan sections
            else if (sectionName === 'PLAN' || sectionName === 'TREATMENT_PLAN' ||
                     sectionName === 'FOLLOW_UP' || sectionName === 'ORDERS' ||
                     sectionName === 'PRESCRIPTIONS') {
                sections.plan.push(section);
            }
        });
    } else if (clinicalDoc.sections) {
        // Alternative format: { sections: { subjective: {...}, objective: {...}, ... } }
        sections = clinicalDoc.sections;
    } else if (Array.isArray(clinicalDoc)) {
        // Array format
        clinicalDoc.forEach(section => {
            const sectionName = (section.sectionName || section.SectionName || '').toUpperCase();
            if (sectionName.includes('SUBJECTIVE') || sectionName.includes('CHIEF')) {
                sections.subjective.push(section);
            } else if (sectionName.includes('OBJECTIVE') || sectionName.includes('PHYSICAL')) {
                sections.objective.push(section);
            } else if (sectionName.includes('ASSESSMENT')) {
                sections.assessment.push(section);
            } else if (sectionName.includes('PLAN')) {
                sections.plan.push(section);
            }
        });
    }
    
    // Build the SOAP notes HTML
    // nosemgrep: insecure-innerhtml — SOAP content from trusted AWS streaming API, all values passed through escapeHtml()
    const _html3 = `
        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">S</div>
                <div class="soap-section-title">Subjective</div>
            </div>
            <div class="soap-section-content" id="soapSubjective">
                ${formatSoapSection(sections.subjective, 'No subjective information recorded.')}
            </div>
        </div>

        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">O</div>
                <div class="soap-section-title">Objective</div>
            </div>
            <div class="soap-section-content" id="soapObjective">
                ${formatSoapSection(sections.objective, 'No objective findings recorded.')}
            </div>
        </div>

        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">A</div>
                <div class="soap-section-title">Assessment</div>
            </div>
            <div class="soap-section-content" id="soapAssessment">
                ${formatSoapSection(sections.assessment, 'No assessment recorded.')}
            </div>
        </div>

        <div class="soap-section">
            <div class="soap-section-header">
                <div class="soap-section-letter">P</div>
                <div class="soap-section-title">Plan</div>
            </div>
            <div class="soap-section-content" id="soapPlan">
                ${formatSoapSection(sections.plan, 'No plan recorded.')}
            </div>
        </div>
    `;
    soapMain.innerHTML = _html3; // nosemgrep: insecure-innerhtml, insecure-document-method
}

/**
 * Format a section name for display (convert SNAKE_CASE to Title Case)
 * @param {string} name - The section name
 * @returns {string} Formatted name
 */
function formatSectionName(name) {
    if (!name) return '';
    return name
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Format a SOAP section for display
 * Handles ConnectHealth API format where segments may be split across multiple items
 * @param {Array|Object|string} sectionData - The section data
 * @param {string} defaultText - Default text if no data
 * @returns {string} HTML string
 */
function formatSoapSection(sectionData, defaultText) {
    if (!sectionData) {
        return `<p class="soap-empty">${defaultText}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
    }
    
    // Handle array of sections (ConnectHealth API format)
    if (Array.isArray(sectionData) && sectionData.length > 0) {
        // STEP 1: Collect all raw segments from all sections
        let allSegments = [];
        
        sectionData.forEach(section => {
            if (section.Summary && Array.isArray(section.Summary)) {
                section.Summary.forEach(item => {
                    if (item.SummarizedSegment) {
                        allSegments.push(item.SummarizedSegment);
                    }
                });
            } else if (section.text || section.content) {
                allSegments.push(section.text || section.content);
            } else if (typeof section === 'string') {
                allSegments.push(section);
            }
        });
        
        if (allSegments.length === 0) {
            return `<p class="soap-empty">${defaultText}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        }
        
        // STEP 2: Concatenate segments intelligently
        // Short segments (< 40 chars, no period) are likely list items — join with newlines
        // Longer segments are narrative — join with space
        let fullText = '';
        for (let i = 0; i < allSegments.length; i++) {
            const seg = allSegments[i].trim();
            if (!seg) continue;
            if (fullText) {
                const prevEndsWithNewline = fullText.endsWith('\n');
                const isShortItem = seg.length < 50 && !seg.includes('. ') && !seg.match(/^(The |This |Patient |He |She |They )/i);
                const prevIsShort = fullText.split('\n').pop().trim().length < 50;
                if (isShortItem || prevIsShort) {
                    fullText += prevEndsWithNewline ? seg : '\n' + seg;
                } else {
                    fullText += prevEndsWithNewline ? seg : ' ' + seg;
                }
            } else {
                fullText = seg;
            }
        }
        
        // STEP 3: Parse the concatenated text into structured sections
        let reviewOfSystems = {};
        let pastMedicalHistory = {};
        let medications = [];
        let assessmentItems = [];
        let planItems = [];
        let generalContent = [];
        
        // Split by known section headers
        const sections = fullText.split(/(?=REVIEW_OF_SYSTEMS|PAST_MEDICAL_HISTORY|Medications:|MEDICATIONS)/);
        
        sections.forEach(sectionText => {
            sectionText = sectionText.trim();
            if (!sectionText) return;
            
            // Parse REVIEW_OF_SYSTEMS
            if (sectionText.startsWith('REVIEW_OF_SYSTEMS')) {
                const content = sectionText.replace(/^REVIEW_OF_SYSTEMS\s*\n?/, '');
                const lines = content.split('\n').filter(l => l.trim());
                lines.forEach(line => {
                    const match = line.trim().match(/^([A-Za-z]+):\s*(.+)$/);
                    if (match) {
                        const category = match[1];
                        const value = match[2].trim();
                        if (!reviewOfSystems[category]) reviewOfSystems[category] = [];
                        reviewOfSystems[category].push(value);
                    }
                });
            }
            // Parse PAST_MEDICAL_HISTORY
            else if (sectionText.startsWith('PAST_MEDICAL_HISTORY')) {
                const content = sectionText.replace(/^PAST_MEDICAL_HISTORY\s*\n?/, '');
                let currentCategory = 'Medical';
                const lines = content.split('\n').filter(l => l.trim());
                lines.forEach(line => {
                    line = line.trim();
                    // Check for category header like "Medical:" or "Surgical:"
                    const categoryMatch = line.match(/^([A-Za-z]+):$/);
                    if (categoryMatch) {
                        currentCategory = categoryMatch[1];
                        if (!pastMedicalHistory[currentCategory]) pastMedicalHistory[currentCategory] = [];
                    }
                    // Check for list item
                    else if (line.startsWith('-')) {
                        const item = line.replace(/^-\s*/, '').trim();
                        if (item) {
                            if (!pastMedicalHistory[currentCategory]) pastMedicalHistory[currentCategory] = [];
                            pastMedicalHistory[currentCategory].push(item);
                        }
                    }
                });
            }
            // Parse Medications
            else if (sectionText.startsWith('Medications:') || sectionText.startsWith('MEDICATIONS')) {
                const content = sectionText.replace(/^(Medications:|MEDICATIONS)\s*\n?/, '');
                const lines = content.split('\n').filter(l => l.trim());
                lines.forEach(line => {
                    const med = line.replace(/^-\s*/, '').trim();
                    if (med && !med.match(/^[A-Z_]+$/)) { // Skip section headers
                        medications.push(med);
                    }
                });
            }
            // General content - check for special patterns
            else {
                // Check for numbered assessment items (e.g., "1. Headache")
                if (sectionText.match(/^\d+\.\s/)) {
                    const items = sectionText.split('\n').filter(l => l.trim());
                    items.forEach(item => {
                        const cleaned = item.replace(/^\d+\.\s*/, '').trim();
                        if (cleaned) assessmentItems.push(cleaned);
                    });
                }
                // Check for plan items (e.g., "Headache:\n- Ruled out...")
                else if (sectionText.match(/^[A-Za-z\s]+:\s*\n-/)) {
                    const colonIndex = sectionText.indexOf(':');
                    const condition = sectionText.substring(0, colonIndex).trim();
                    const actionsText = sectionText.substring(colonIndex + 1);
                    const actions = actionsText.split('\n')
                        .filter(l => l.trim())
                        .map(l => l.replace(/^-\s*/, '').trim())
                        .filter(l => l);
                    if (condition && actions.length > 0) {
                        planItems.push({ condition, actions });
                    }
                }
                // Check for standalone list items (continuation of previous section)
                else if (sectionText.match(/^-\s/)) {
                    // This is likely a continuation - add to medications if we have any
                    const items = sectionText.split('\n').filter(l => l.trim());
                    items.forEach(line => {
                        const item = line.replace(/^-\s*/, '').trim();
                        if (item) medications.push(item);
                    });
                }
                // Regular paragraph content
                else {
                    // Split into lines and check if they're short items vs narrative
                    const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l);
                    const shortLines = lines.filter(l => l.length < 50 && !l.includes('. '));
                    const longLines = lines.filter(l => l.length >= 50 || l.includes('. '));
                    
                    // If mostly short lines, treat as chief complaint items
                    if (shortLines.length > 1 && shortLines.length >= longLines.length) {
                        shortLines.forEach(l => {
                            if (!generalContent.includes(l)) generalContent.push(l);
                        });
                        longLines.forEach(l => {
                            const cleaned = l.replace(/\n\n+/g, ' ').trim();
                            if (cleaned) generalContent.push(cleaned);
                        });
                    } else {
                        const cleaned = sectionText.replace(/\n\n+/g, ' ').replace(/\n/g, ' ').trim();
                        if (cleaned && !cleaned.match(/^[\s\n]*$/)) {
                            generalContent.push(cleaned);
                        }
                    }
                }
            }
        });
        
        // STEP 4: Build HTML output
        let html = '';
        
        // General content (chief complaint, HPI, etc.)
        if (generalContent.length > 0) {
            // Separate short items (chief complaints) from narrative paragraphs
            const shortItems = generalContent.filter(t => t.length < 50 && !t.includes('. '));
            const narratives = generalContent.filter(t => t.length >= 50 || t.includes('. '));
            
            // Render short items as a comma-separated chief complaint line
            if (shortItems.length > 0) {
                html += `<p class="soap-text"><strong>Chief Complaints:</strong> ${shortItems.map(escapeHtml).join(', ')}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            }
            // Render narrative paragraphs
            narratives.forEach(text => {
                html += `<p class="soap-text">${escapeHtml(text)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            });
        }
        
        // Assessment items (numbered list)
        if (assessmentItems.length > 0) {
            html += '<ol class="soap-assessment-list">';
            assessmentItems.forEach(item => {
                html += `<li>${escapeHtml(item)}</li>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            });
            html += '</ol>';
        }
        
        // Plan items (condition + actions)
        if (planItems.length > 0) {
            planItems.forEach(plan => {
                html += `<div class="soap-plan-item">`;
                html += `<div class="soap-plan-condition">${escapeHtml(plan.condition)}</div>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                if (plan.actions.length > 0) {
                    html += '<ul class="soap-plan-actions">';
                    plan.actions.forEach(action => {
                        html += `<li>${escapeHtml(action)}</li>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                    });
                    html += '</ul>';
                }
                html += '</div>';
            });
        }
        
        // Review of Systems
        const rosKeys = Object.keys(reviewOfSystems);
        if (rosKeys.length > 0) {
            html += '<div class="soap-subsection-group">';
            html += '<div class="soap-subsection-title">Review of Systems</div>';
            rosKeys.forEach(key => {
                const items = reviewOfSystems[key];
                html += `<div class="soap-subsection-item">`;
                html += `<span class="soap-subsection-label">${escapeHtml(key)}:</span> `; // nosemgrep: insecure-document-method, html-in-template-string, missing-template-string-indicator
                html += `<span class="soap-subsection-content">${items.map(escapeHtml).join('; ')}</span>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                html += `</div>`;
            });
            html += '</div>';
        }
        
        // Past Medical History
        const pmhKeys = Object.keys(pastMedicalHistory);
        if (pmhKeys.length > 0) {
            html += '<div class="soap-subsection-group">';
            html += '<div class="soap-subsection-title">Past Medical History</div>';
            pmhKeys.forEach(key => {
                const items = pastMedicalHistory[key];
                html += `<div class="soap-subsection-item">`;
                html += `<span class="soap-subsection-label">${escapeHtml(key)}:</span> `; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                html += `<span class="soap-subsection-content">${items.map(escapeHtml).join(', ')}</span>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                html += `</div>`;
            });
            html += '</div>';
        }
        
        // Medications
        if (medications.length > 0) {
            html += '<div class="soap-subsection-group">';
            html += '<div class="soap-subsection-title">Current Medications</div>';
            html += '<ul class="soap-medication-list">';
            medications.forEach(med => {
                html += `<li>${escapeHtml(med)}</li>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            });
            html += '</ul>';
            html += '</div>';
        }
        
        return html || `<p class="soap-empty">${defaultText}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
    }
    
    // Handle object with text/content
    if (typeof sectionData === 'object') {
        if (sectionData.text) return `<p class="soap-text">${escapeHtml(sectionData.text)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        if (sectionData.content) return `<p class="soap-text">${escapeHtml(sectionData.content)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        if (sectionData.Summary) {
            return sectionData.Summary.map(item => 
                // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                item.SummarizedSegment ? `<p class="soap-text">${escapeHtml(item.SummarizedSegment)}</p>` : ''
            ).join('');
        }
    }
    
    // Handle string
    if (typeof sectionData === 'string') {
        return `<p class="soap-text">${escapeHtml(sectionData)}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
    }
    
    return `<p class="soap-empty">${defaultText}</p>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
}

/**
 * Display medical codes from S3 output
 * @param {Object} medicalCodes - The medical codes from S3
 */
function displayMedicalCodesFromS3(medicalCodes) {
    console.log('[SOAP] Displaying medical codes from S3 (entries=' + (Array.isArray(medicalCodes) ? medicalCodes.length : 'n/a') + '; content redacted — PHI)');
    
    // Parse the medical codes structure
    let codes = [];
    
    if (medicalCodes.medicalCodes) {
        // ConnectHealth API format: { medicalCodes: [...] }
        codes = medicalCodes.medicalCodes.map(code => ({
            system: code.system || 'ICD10',
            name: code.name || code.Code || code.code,
            description: code.description || code.Description || '',
            confidence: code.confidence || code.Score || 0.95
        }));
    } else if (medicalCodes.MedicalCodes) {
        // Alternative format: { MedicalCodes: [...] }
        codes = medicalCodes.MedicalCodes.map(code => ({
            system: code.Type || code.system || 'ICD10',
            name: code.Code || code.name,
            description: code.Description || code.description || '',
            confidence: code.Score || code.confidence || 0.95
        }));
    } else if (Array.isArray(medicalCodes)) {
        // Array format
        codes = medicalCodes.map(code => ({
            system: code.Type || code.system || 'ICD10',
            name: code.Code || code.code || code.name,
            description: code.Description || code.description || '',
            confidence: code.Score || code.confidence || 0.95
        }));
    } else if (medicalCodes.codes) {
        // { codes: [...] } format
        codes = medicalCodes.codes;
    }
    
    console.log('[SOAP] Parsed', codes.length, 'codes from S3');
    
    // Deduplicate codes by name (e.g., I10 appearing twice)
    const seen = new Set();
    codes = codes.filter(code => {
        const key = code.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    
    // Render the codes
    if (codes.length > 0) {
        renderMedicalCodesSidebar(codes);
        // Set flag to indicate we've loaded codes from S3
        window.medicalCodesLoadedFromS3 = true;
    } else {
        console.log('[SOAP] No codes found in S3 output, using fallback');
        generateAndDisplayMedicalCodes();
    }
}


function closeSoapNotes() {

    const soapNotesOverlay = document.getElementById('soapNotesOverlay');

    if (soapNotesOverlay) {

        soapNotesOverlay.classList.remove('active');

    }

    

    // Reset processing steps for next time

    resetProcessingSteps();

}


function resetProcessingSteps() {

    const steps = ['step1', 'step2', 'step3', 'step4'];

    steps.forEach(stepId => {

        const stepElement = document.getElementById(stepId);

        if (stepElement) {

            stepElement.classList.remove('active', 'completed');

            const stepIcon = stepElement.querySelector('.step-icon');

            stepIcon.innerHTML = `

                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

                    <circle cx="12" cy="12" r="10"/>

                </svg>

            `;

        }

    });

}


function editSoapNotes() {
    const soapMain = document.querySelector('.soap-notes-main');
    const editBtn = document.getElementById('editNotesBtn') || document.querySelector('.soap-notes-btn.secondary') || document.querySelector('.soap-inline-btn.secondary');
    const soapSections = document.querySelectorAll('.soap-section');
    
    if (!soapMain) return;
    
    // Toggle contenteditable
    const isEditable = soapMain.getAttribute('contenteditable') === 'true';
    
    if (isEditable) {
        // Save mode - make non-editable
        soapMain.setAttribute('contenteditable', 'false');
        soapMain.style.outline = 'none';
        
        // Sanitize edited content to prevent XSS from pasted HTML
        if (typeof DOMPurify !== 'undefined') {
            soapMain.innerHTML = DOMPurify.sanitize(soapMain.innerHTML); // nosemgrep: insecure-innerhtml, insecure-document-method — sanitized by DOMPurify
        } else {
            // DOMPurify unavailable — strip all HTML tags as a safe fallback
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = soapMain.innerHTML; // nosemgrep: insecure-innerhtml, insecure-document-method — throwaway element never inserted into DOM; output is textContent only
            const textOnly = tempDiv.textContent || tempDiv.innerText || '';
            soapMain.textContent = textOnly;
            console.warn('[Security] DOMPurify not loaded — stripped HTML from edited SOAP notes');
        }
        
        // Remove outline from all sections
        soapSections.forEach(section => {
            section.style.outline = 'none';
            section.style.padding = '';
            section.style.borderRadius = '';
            section.style.backgroundColor = '';
        });
        
        editBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Edit Notes
        `;
        
        // Re-generate medical codes from edited content
        regenerateCodesFromEditedNotes();
    } else {
        // Edit mode - make editable
        soapMain.setAttribute('contenteditable', 'true');
        soapMain.style.outline = 'none';
        
        // Add subtle grey outline to each section
        soapSections.forEach(section => {
            section.style.outline = '2px solid #e5e7eb';
            section.style.padding = '16px';
            section.style.borderRadius = '8px';
            section.style.backgroundColor = 'rgba(249, 250, 251, 0.5)';
        });
        
        soapMain.focus();
        editBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
            Save Changes
        `;
    }
}


async function pollForMedicalCodes(sessionId, attempt = 0) {
    const MAX_ATTEMPTS = 30; // 30 x 3s = 90 seconds
    const DELAY = 3000;
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';

    try {
        const resp = await fetch(`${backendUrl}/api/streaming/session/${sessionId}/medical-codes`);
        const data = await resp.json();

        if (data.success && data.medicalCodes && !data.medicalCodes.error) {
            const codes = data.medicalCodes;
            console.log(`[PollCodes] Got ${codes.medicalCodes ? codes.medicalCodes.length : 0} codes on attempt ${attempt + 1}`);
            if (streamingSessionOutputs) {
                streamingSessionOutputs.medicalCodes = codes;
            }
            window.medicalCodesLoadedFromS3 = true;
            displayMedicalCodesFromS3(codes);
            sendCodesToIframe();
            linkEvidenceToSoapText(codes);
            setTimeout(initCodeTextHandlers, 200);
            return;
        }
    } catch (e) {
        console.log(`[PollCodes] Fetch error on attempt ${attempt + 1}:`, e.message); // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
    }

    if (attempt < MAX_ATTEMPTS) {
        console.log(`[PollCodes] Codes not ready, retry ${attempt + 1}/${MAX_ATTEMPTS}...`);
        setTimeout(() => pollForMedicalCodes(sessionId, attempt + 1), DELAY);
    } else {
        console.log('[PollCodes] Gave up after max attempts');
    }
}


async function regenerateCodesFromEditedNotes() {
    const clinicalText = extractSoapNoteText();
    console.log('[Regen] Extracted text (' + (clinicalText ? clinicalText.length : 0) + ' chars):', clinicalText ? clinicalText.substring(0, 200) : 'EMPTY'); // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
    if (!clinicalText || clinicalText.trim().length < 20) {
        console.log('[Regen] Not enough text to generate codes');
        return;
    }

    // Show loading in sidebar (overlay — may be hidden)
    const codeListContainer = document.querySelector('.code-list-sidebar');
    if (codeListContainer) {
        codeListContainer.innerHTML = `
            <div class="code-section-header">ICD-10 Diagnosis Codes</div>
            <div class="codes-loading"><div class="codes-loading-spinner"></div><span>Re-analyzing clinical text...</span></div>
            <div class="code-section-header" style="margin-top:12px;">CPT Procedure Codes</div>
            <div class="codes-loading"><div class="codes-loading-spinner"></div><span>Generating codes...</span></div>
        `;
    }

    // Show loading in iframe
    const iframeEl = document.getElementById('previsitIframe');
    if (iframeEl && iframeEl.contentWindow) {
        iframeEl.contentWindow.postMessage({ type: 'codes-loading' }, window.location.origin);
    }

    const patientContext = getCurrentPatientContext();
    const codes = await fetchMedicalCodes(clinicalText, patientContext, {
        encounterFormat: 'IN_PERSON'
    });

    console.log('[Regen] API returned', codes ? codes.length : 0, 'codes');

    if (codes && codes.length > 0) {
        console.log('[Regen] Codes regenerated (count=' + (codes || []).length + '; content redacted — clinical data)');

        if (!streamingSessionOutputs) streamingSessionOutputs = {};
        streamingSessionOutputs.medicalCodes = { medicalCodes: codes };
        window.medicalCodesLoadedFromS3 = true;

        renderMedicalCodesSidebar(codes);
        sendCodesToIframe();

        // Also directly post to iframe
        const regenIframe = document.getElementById('previsitIframe');
        if (regenIframe && regenIframe.contentWindow) {
            regenIframe.contentWindow.postMessage({ type: 'medical-codes-update', codes: codes }, window.location.origin);
        }

        linkEvidenceToSoapText({ medicalCodes: codes });
        setTimeout(initCodeTextHandlers, 200);
        showMinimalNotification('Medical codes updated (' + codes.length + ' codes)');
    } else {
        renderMedicalCodesSidebar([]);
        sendCodesToIframe();
        showMinimalNotification('No medical codes returned');
    }
}


function approveSoapNotes() {

    console.log('approveSoapNotes called');

    // Show toast notification
    showEHRSaveNotification();

    // Fire FHIR write-back (Task 1.8) — async, non-blocking
    // Resolves before the 2s toast delay completes.
    _triggerFhirWriteback();

    // Wait for notification, then show completion overlay
    setTimeout(() => {

        console.log('Closing SOAP notes and showing completion');

        closeSoapNotes();

        showCompletionOverlay();

    }, 2000);

}

/**
 * Task 1.8 — HealthLake FHIR Write-Back
 * Posts Encounter + SOAP DocumentReference + ICD-10 Conditions to HealthLake.
 * Called automatically when provider clicks "Approve & Sign".
 * Fires-and-forgets — does not block the UI flow.
 */
async function _triggerFhirWriteback() {
    try {
        // Resolve patient FHIR ID from PATIENT_INFO
        const patientKey = window.currentPatientKey;
        const patientInfo = window.PATIENT_INFO && patientKey ? window.PATIENT_INFO[patientKey] : null;
        const patientId   = patientInfo ? patientInfo.id : null;
        const patientName = patientInfo ? patientInfo.name : 'Unknown Patient';

        if (!patientId) {
            console.warn('[FHIR-WB] No patientId available — skipping write-back');
            return;
        }

        const sessionId  = window.currentStreamingSessionId || currentStreamingSessionId || '';
        const clinicalDoc  = streamingSessionOutputs ? streamingSessionOutputs.clinicalDoc  : null;
        const medicalCodes = streamingSessionOutputs ? streamingSessionOutputs.medicalCodes : null;

        console.log(`[FHIR-WB] Writing back — patient=${patientId.substring(0,8)}... session=${sessionId}`);

        const backendUrl = window.BACKEND_URL || '';
        const resp = await fetch(`${backendUrl}/api/fhir-writeback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patientId, sessionId, patientName, clinicalDoc, medicalCodes })
        });

        const result = await resp.json();
        if (result.success) {
            console.log(`[FHIR-WB] ✅ Success — encounterId=${result.encounterId} docRef=${result.documentReferenceId} conditions=${(result.conditionIds||[]).length}`);
            // Store for display in completion overlay
            window._lastWritebackResult = result;
        } else {
            console.warn('[FHIR-WB] Write-back returned error:', result.error);
        }
    } catch (err) {
        // Non-fatal — write-back failure must not block the UI
        console.error('[FHIR-WB] Write-back failed (non-fatal):', err);
    }
}


function injectSoapIntoRightPanel() {
    const rightPanel = document.querySelector('.right-panel');
    if (!rightPanel) return;

    // Switch to Clinical notes tab
    document.querySelectorAll('.tab-nav .tab').forEach(t => t.classList.remove('active'));
    const clinicalTab = document.getElementById('tabClinicalNotes');
    if (clinicalTab) clinicalTab.classList.add('active');

    const doc = streamingSessionOutputs ? streamingSessionOutputs.clinicalDoc : null;
    const codes = streamingSessionOutputs ? streamingSessionOutputs.medicalCodes : null;
    console.log('[SOAP-INLINE] doc:', doc ? 'present' : 'null', 'codes:', codes ? 'present' : 'null');

    // Build the inline wrapper with header, a .soap-notes-main div for displayClinicalDoc, and action buttons
    rightPanel.innerHTML = `
        <div class="soap-notes-inline">
            <div class="soap-notes-header-inline">
                <h2>Clinical Documentation</h2>
                <div class="soap-inline-actions">
                    <button class="soap-inline-btn secondary" id="editNotesBtn" onclick="editSoapNotes()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit Notes
                    </button>
                    <button class="soap-inline-btn primary" onclick="approveSoapNotes()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Approve &amp; Sign
                    </button>
                </div>
            </div>
            <div class="soap-inline-body">
                <div class="soap-notes-main"></div>
            </div>
        </div>`;

    // Use the existing displayClinicalDoc function (writes into .soap-notes-main)
    if (doc) {
        displayClinicalDoc(doc);
    } else {
        const soapMain = document.querySelector('.soap-notes-main');
        if (soapMain) soapMain.innerHTML = '<p style="color:#9ca3af;padding:16px;">No clinical documentation available.</p>';
    }

    // Display medical codes — if not available yet, poll for them
    if (codes && codes.medicalCodes && codes.medicalCodes.length > 0) {
        displayMedicalCodesFromS3(codes);
        sendCodesToIframe();
        if (codes) linkEvidenceToSoapText(codes);
    } else if (currentStreamingSessionId) {
        // Codes not ready — start polling
        sendCodesToIframe(); // Show empty state immediately
        pollForMedicalCodes(currentStreamingSessionId);
    } else {
        sendCodesToIframe(); // Show empty state
    }

    // Initialize code-text click handlers
    setTimeout(initCodeTextHandlers, 200);
}

function linkEvidenceToSoapText(codesData) {
    const soapMain = document.querySelector('.soap-notes-main');
    if (!soapMain) return;

    const rawCodes = codesData.medicalCodes || codesData || [];
    const codeArray = Array.isArray(rawCodes) ? rawCodes : [];
    if (codeArray.length === 0) return;

    // Build a map of evidence phrases → code name
    const evidenceLinks = [];
    const seen = new Set();
    codeArray.forEach(code => {
        if (seen.has(code.name)) return;
        seen.add(code.name);
        if (code.evidence && Array.isArray(code.evidence)) {
            code.evidence.forEach(ev => {
                if (!ev.text || ev.text.trim().length < 5) return;
                // Extract meaningful phrases from evidence text
                // Strip section headers like "## SUBJECTIVE", "REVIEW_OF_SYSTEMS", "PAST_MEDICAL_HISTORY", etc.
                const cleaned = ev.text.trim()
                    .replace(/^##\s*\w+\s*/i, '')
                    .replace(/^(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN|REVIEW_OF_SYSTEMS|PAST_MEDICAL_HISTORY|CHIEF_COMPLAINT|PHYSICAL_EXAMINATION|MEDICATIONS|SOCIAL_HISTORY|FAMILY_HISTORY|ALLERGIES|VITAL_SIGNS)\s*/gi, '')
                    .replace(/^(Constitutional|Cardiovascular|Respiratory|Musculoskeletal|Neurological|Medical):\s*/gi, '')
                    .trim();
                // Split on common delimiters and take phrases > 4 chars
                const phrases = cleaned.split(/[.\n\-]+/).map(p => p.trim()).filter(p => p.length > 4);
                phrases.forEach(phrase => {
                    evidenceLinks.push({ text: phrase, code: code.name });
                });
            });
        }
    });

    if (evidenceLinks.length === 0) return;

    // Sort by text length descending so longer matches are tried first
    evidenceLinks.sort((a, b) => b.text.length - a.text.length);

    // Walk through all text nodes in the SOAP notes and wrap matches
    const contentEls = soapMain.querySelectorAll('p, li, .soap-subsection-item, .soap-assessment-list li, .soap-plan-condition, .soap-plan-actions li, .soap-medication-list li, span, div.soap-section-content');
    let linkCount = 0;
    contentEls.forEach(el => {
        // Skip if already has linked text from a previous run
        if (el.querySelector('.code-linked-text')) return;
        const originalText = el.textContent;
        if (!originalText || originalText.trim().length < 3) return;
        evidenceLinks.forEach(({ text, code }) => {
            // Check against current innerHTML (which may have been modified by previous matches)
            const currentText = el.textContent;
            if (currentText.toLowerCase().includes(text.toLowerCase())) {
                const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const before = el.innerHTML;
                // nosemgrep: insecure-innerhtml — wrapping existing SOAP text with evidence link spans, code name is from trusted API
                const _html4 = el.innerHTML.replace(
                    // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                    new RegExp(escaped, 'i'),
                    // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
                    `<span class="code-linked-text" data-code="${code}">$&</span>`
                );
                el.innerHTML = _html4; // nosemgrep: insecure-innerhtml, insecure-document-method
                if (el.innerHTML !== before) {
                    linkCount++;
                }
            }
        });
    });

    console.log('[Evidence] Linked', linkCount, 'evidence phrases to SOAP text from', evidenceLinks.length, 'candidates');
}

function sendCodesToIframe() {
    const iframe = document.getElementById('previsitIframe');
    if (!iframe || !iframe.contentWindow) return;

    let codes = [];
    if (streamingSessionOutputs && streamingSessionOutputs.medicalCodes) {
        const raw = streamingSessionOutputs.medicalCodes.medicalCodes || streamingSessionOutputs.medicalCodes || [];
        codes = Array.isArray(raw) ? raw : [];
    }

    // Deduplicate descriptions (API sometimes returns "text text" duplicates) and truncate long ones
    codes = codes.map(c => {
        let desc = c.description || '';
        // Fix doubled descriptions
        const half = Math.floor(desc.length / 2);
        if (desc.length > 10 && desc.substring(0, half).trim() === desc.substring(half).trim()) {
            desc = desc.substring(0, half).trim();
        }
        // Truncate long CPT descriptions — keep only the first sentence/clause
        if (desc.length > 100) {
            const cutPoints = ['. ', '; ', ', which ', ' This ', ' When '];
            let cutAt = desc.length;
            cutPoints.forEach(cp => {
                const idx = desc.indexOf(cp);
                if (idx > 20 && idx < cutAt) cutAt = idx;
            });
            if (cutAt < desc.length) desc = desc.substring(0, cutAt);
        }
        return { ...c, description: desc };
    });

    if (codes.length > 0) {
        iframe.contentWindow.postMessage({ type: 'medical-codes-update', codes: codes }, window.location.origin);
        console.log('[Codes] Sent', codes.length, 'codes to iframe');
    } else {
        // Send empty codes so iframe switches to codes panel with "No codes detected"
        iframe.contentWindow.postMessage({ type: 'medical-codes-update', codes: [] }, window.location.origin);
        console.log('[Codes] Sent empty codes to iframe');
    }

    // Change iframe title to "Coding Insights"
    const titleText = document.getElementById('previsitTitleText');
    if (titleText) titleText.textContent = 'Coding Insights';
}

function initCodeTextHandlers() {
    const linkedTexts = document.querySelectorAll('.code-linked-text[data-code]');
    linkedTexts.forEach(el => {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            const codeId = this.getAttribute('data-code');
            toggleCodeTextHighlight(codeId);
        });
    });
}

function toggleCodeTextHighlight(codeId) {
    const allLinked = document.querySelectorAll('.code-linked-text');
    const matching = document.querySelectorAll(`.code-linked-text[data-code="${codeId}"]`);
    const wasHighlighted = matching.length > 0 && matching[0].classList.contains('highlighted');

    // Clear all highlights
    allLinked.forEach(el => el.classList.remove('highlighted'));

    const iframe = document.getElementById('previsitIframe');

    if (wasHighlighted) {
        // Deselect — clear iframe highlights too
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'clear-code-highlights' }, window.location.origin);
        }
    } else {
        // Highlight matching text
        matching.forEach(el => el.classList.add('highlighted'));
        // Highlight code in iframe
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'highlight-code', codeId: codeId }, window.location.origin);
        }
    }
}

function injectClinicalDocIntoEHR() {
    const portal = document.querySelector('.patient-portal-background');
    if (!portal) return;

    let soapHTML = '<div class="clinical-doc-ehr"><div class="clinical-doc-header"><h2>Clinical Documentation</h2><div class="clinical-doc-actions"><button class="clinical-doc-btn edit" onclick="editSoapNotes()">✏️ Edit Notes</button><button class="clinical-doc-btn approve signed" disabled title="Already approved and signed">✅ Signed</button></div></div>';

    if (streamingSessionOutputs && streamingSessionOutputs.clinicalDoc) {
        const doc = streamingSessionOutputs.clinicalDoc;
        const sections = doc.ClinicalDocumentation ? doc.ClinicalDocumentation.Sections : [];
        const sectionMap = { CHIEF_COMPLAINT: 'S - Subjective', HISTORY_OF_PRESENT_ILLNESS: 'S - Subjective', REVIEW_OF_SYSTEMS: 'S - Subjective', PHYSICAL_EXAMINATION: 'O - Objective', ASSESSMENT: 'A - Assessment', PLAN: 'P - Plan' };
        const grouped = {};

        sections.forEach(s => {
            const label = sectionMap[s.SectionName] || s.SectionName;
            if (!grouped[label]) grouped[label] = [];
            (s.Summary || []).forEach(item => {
                const text = item.SummarizedSegment || '';
                if (text.trim()) grouped[label].push(text);
            });
        });

        ['S - Subjective', 'O - Objective', 'A - Assessment', 'P - Plan'].forEach(section => {
            const items = grouped[section] || [];
            const color = section.startsWith('S') ? '#3b82f6' : section.startsWith('O') ? '#10b981' : section.startsWith('A') ? '#8b5cf6' : '#f59e0b';
            soapHTML += `<div class="clinical-doc-section"><h3 style="color:${color};">${section}</h3>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            if (items.length > 0) {
                soapHTML += items.map(t => `<p>${escapeHtml(t)}</p>`).join(''); // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            } else {
                soapHTML += '<p style="color:#9ca3af;">No data available</p>';
            }
            soapHTML += '</div>';
        });
    } else {
        soapHTML += '<p style="color:#9ca3af;padding:20px;">Clinical documentation not available</p>';
    }
    soapHTML += '</div>';

    // Replace portal content
    const contentArea = portal.querySelector('.content-area') || portal;
    contentArea.innerHTML = soapHTML; // nosemgrep: insecure-innerhtml, insecure-document-method — SOAP content from trusted AWS streaming API, all values passed through escapeHtml()
}

function injectMedicalCodesIntoSidebar() {
    const sidebar = document.getElementById('previsitContainer');
    if (!sidebar) return;

    let codesHTML = '<div class="medical-codes-sidebar"><div class="medical-codes-header"><span>Medical Codes</span></div><div class="medical-codes-list">';

    if (streamingSessionOutputs && streamingSessionOutputs.medicalCodes) {
        let codes = streamingSessionOutputs.medicalCodes.medicalCodes || streamingSessionOutputs.medicalCodes || [];
        let codeArray = Array.isArray(codes) ? codes : [];
        const colors = { ICD10: '#8b5cf6', CPT: '#10b981' };

        // Deduplicate by name
        const seen = new Set();
        codeArray = codeArray.filter(code => {
            if (seen.has(code.name)) return false;
            seen.add(code.name);
            return true;
        });

        if (codeArray.length > 0) {
            codeArray.forEach(code => {
                const color = colors[code.system] || '#6366f1';
                const confidence = code.confidence ? Math.round(code.confidence * 100) : null;
                // Fix doubled descriptions and truncate long ones
                let desc = code.description || '';
                const half = Math.floor(desc.length / 2);
                if (desc.length > 10 && desc.substring(0, half).trim() === desc.substring(half).trim()) {
                    desc = desc.substring(0, half).trim();
                }
                if (desc.length > 100) {
                    const cutPoints = ['. ', '; ', ', which ', ' This ', ' When '];
                    let cutAt = desc.length;
                    cutPoints.forEach(cp => {
                        const idx = desc.indexOf(cp);
                        if (idx > 20 && idx < cutAt) cutAt = idx;
                    });
                    if (cutAt < desc.length) desc = desc.substring(0, cutAt);
                }
                codesHTML += `<div class="medical-code-item"><span class="medical-code-badge" style="background:${color};">${escapeHtml(code.name)}</span><div class="medical-code-info"><div class="medical-code-desc">${escapeHtml(desc)}</div>${confidence ? `<div class="medical-code-confidence">${confidence}% confidence</div>` : ''}</div></div>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
            });
        } else {
            codesHTML += '<p style="color:#9ca3af;padding:12px;">No medical codes generated</p>';
        }
    } else {
        codesHTML += '<p style="color:#9ca3af;padding:12px;">Medical codes not available</p>';
    }
    codesHTML += '</div></div>';

    // Replace iframe with medical codes
    const iframeContainer = sidebar.querySelector('.previsit-iframe-container');
    if (iframeContainer) {
        iframeContainer.innerHTML = codesHTML; // nosemgrep: insecure-innerhtml, insecure-document-method — medical codes from trusted AWS API, all values passed through escapeHtml()
    }
    // Update header
    const titleEl = sidebar.querySelector('.previsit-title span');
    if (titleEl) titleEl.textContent = 'Medical Codes';
}


function saveSoapDraft() {

    console.log('Saving SOAP notes as draft');

    

    // Show toast notification

    const toast = document.createElement('div');

    toast.style.cssText = `

        position: fixed;

        top: 24px;

        right: 24px;

        background: linear-gradient(135deg, #10b981 0%, #059669 100%);

        color: white;

        padding: 16px 24px;

        border-radius: 12px;

        box-shadow: 0 8px 24px rgba(16, 185, 129, 0.3);

        z-index: 10001;

        font-size: 14px;

        font-weight: 500;

        display: flex;

        align-items: center;

        gap: 12px;

        animation: slideInRight 0.3s ease;

    `;

    // nosemgrep: insecure-innerhtml — static SVG + static text, no dynamic data
    toast.innerHTML = `

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">

            <polyline points="20 6 9 17 4 12"/>

        </svg>

        Draft saved successfully

    `;

    document.body.appendChild(toast);

    

    setTimeout(() => {

        toast.style.animation = 'slideOutRight 0.3s ease';

        setTimeout(() => toast.remove(), 300);

    }, 2500);

}


function backToPatientList() {
    console.log('backToPatientList function called');
    
    // Hide Clinical Documentation overlay first
    const soapOverlay = document.getElementById('soapNotesOverlay');
    if (soapOverlay) {
        soapOverlay.classList.remove('active');
    }
    
    // Hide Patient Visit Summary overlay
    const completionOverlay = document.getElementById('completionOverlay');
    if (completionOverlay) {
        completionOverlay.classList.remove('active');
    }
    
    // Hide Patient Notes overlay
    const patientNotesOverlay = document.getElementById('patientNotesOverlay');
    if (patientNotesOverlay) {
        patientNotesOverlay.classList.remove('active');
    }
    
    // Show confirmation overlay after a brief delay
    setTimeout(() => {
        const confirmationOverlay = document.getElementById('backToPatientListConfirmation');
        console.log('Confirmation overlay element:', confirmationOverlay);
        if (confirmationOverlay) {
            confirmationOverlay.classList.add('active');
            console.log('Added active class to confirmation overlay');
        } else {
            console.error('backToPatientListConfirmation element not found!');
        }
    }, 200);
}

function hideBackToPatientListConfirmation() {
    const confirmationOverlay = document.getElementById('backToPatientListConfirmation');
    if (confirmationOverlay) {
        confirmationOverlay.classList.remove('active');
    }
    
    // Bring back the Clinical Documentation overlay
    setTimeout(() => {
        const soapOverlay = document.getElementById('soapNotesOverlay');
        if (soapOverlay) {
            soapOverlay.classList.add('active');
        }
    }, 200);
}

function confirmBackToPatientList() {
    console.log('Saving to drafts and returning to patient list');
    
    // Hide confirmation overlay
    const confirmationOverlay = document.getElementById('backToPatientListConfirmation');
    if (confirmationOverlay) {
        confirmationOverlay.classList.remove('active');
    }
    
    // Wait for overlay to fade out before proceeding
    setTimeout(() => {
        // Hide the iframe container
        const previsitContainer = document.getElementById('previsitContainer');
        if (previsitContainer) {
            previsitContainer.classList.remove('active');
        }
        
        // Show the schedule screen (Today's Schedule)
        const scheduleScreen = document.getElementById('scheduleScreen');
        if (scheduleScreen) {
            scheduleScreen.classList.remove('hidden');
        }
    }, 200);
}


// ==========================================================================

// CODE HIGHLIGHTING FUNCTIONS

// ==========================================================================

let activeCodeHighlight = null;


function highlightCodeInNotes(codeId) {

    // Clear any existing highlights

    clearHighlights();

    

    // Find all text elements with this code

    const linkedTexts = document.querySelectorAll(`.code-linked-text[data-code="${codeId}"]`);

    

    // Add highlight class

    linkedTexts.forEach(text => {

        text.classList.add('highlighted');

    });

    

    // Scroll first occurrence into view smoothly

    if (linkedTexts.length > 0) {

        linkedTexts[0].scrollIntoView({ 

            behavior: 'smooth', 

            block: 'center',

            inline: 'nearest'

        });

    }

}


function clearHighlights() {

    // Remove all highlights unless there's an active click

    if (!activeCodeHighlight) {

        const highlightedTexts = document.querySelectorAll('.code-linked-text.highlighted');

        highlightedTexts.forEach(text => {

            text.classList.remove('highlighted');

        });

        

        // Remove active state from code items

        const activeCodeItems = document.querySelectorAll('.code-item-sidebar.active');

        activeCodeItems.forEach(item => {

            item.classList.remove('active');

        });

    }

}


function toggleCodeHighlight(codeId) {

    const codeItem = document.querySelector(`.code-item-sidebar[data-code="${codeId}"]`);

    

    // If clicking the same code, deactivate it

    if (activeCodeHighlight === codeId) {

        activeCodeHighlight = null;

        

        // Clear all highlights

        const allHighlighted = document.querySelectorAll('.code-linked-text.highlighted');

        allHighlighted.forEach(text => text.classList.remove('highlighted'));

        

        // Remove active state from all code items

        const allActiveItems = document.querySelectorAll('.code-item-sidebar.active');

        allActiveItems.forEach(item => item.classList.remove('active'));

    } else {

        // Activate new code

        activeCodeHighlight = codeId;

        

        // Clear all previous highlights

        const allHighlighted = document.querySelectorAll('.code-linked-text.highlighted');

        allHighlighted.forEach(text => text.classList.remove('highlighted'));

        

        // Remove active state from all code items

        const allActiveItems = document.querySelectorAll('.code-item-sidebar.active');

        allActiveItems.forEach(item => item.classList.remove('active'));

        

        // Highlight all instances of this code in the notes

        const linkedTexts = document.querySelectorAll(`.code-linked-text[data-code="${codeId}"]`);

        linkedTexts.forEach(text => {

            text.classList.add('highlighted');

        });

        

        // Mark code item as active

        if (codeItem) {

            codeItem.classList.add('active');

        }

        

        // Scroll first occurrence into view smoothly

        if (linkedTexts.length > 0) {

            linkedTexts[0].scrollIntoView({ 

                behavior: 'smooth', 

                block: 'center',

                inline: 'nearest'

            });

        }

    }

}


// ==========================================================================

// TAB SWITCHING AND CODE HIGHLIGHTING FUNCTIONS

// ==========================================================================

function switchTab(tabName) {

    // Update tab buttons

    const tabs = document.querySelectorAll('.soap-tab');

    tabs.forEach(tab => tab.classList.remove('active'));

    event.target.closest('.soap-tab').classList.add('active');


    // Update tab content

    const tabContents = document.querySelectorAll('.tab-content');

    tabContents.forEach(content => content.classList.remove('active'));

    

    if (tabName === 'notes') {

        document.getElementById('notesTab').classList.add('active');

    } else if (tabName === 'transcript') {

        document.getElementById('transcriptTab').classList.add('active');

    } else if (tabName === 'flagged') {

        document.getElementById('flaggedTab').classList.add('active');

    }

}


function highlightCodeSource(codeId) {

    // Clear any existing highlights

    clearHighlights();

    

    // Find all elements with this code

    const elements = document.querySelectorAll(`[data-code="${codeId}"]`);

    elements.forEach(el => {

        if (el.classList.contains('highlight-source')) {

            el.classList.add('highlighted');

        }

    });

    

    // Highlight the code item in sidebar

    const codeItem = document.querySelector(`.code-item[data-code="${codeId}"]`);

    if (codeItem) {

        codeItem.classList.add('active');

    }

    

    // Scroll to first highlighted element if not in view

    if (elements.length > 0) {

        const firstElement = elements[0];

        if (firstElement.classList.contains('highlight-source')) {

            firstElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        }

    }

}


function clearHighlights() {

    // Remove all highlights from notes

    const highlighted = document.querySelectorAll('.highlight-source.highlighted');

    highlighted.forEach(el => el.classList.remove('highlighted'));

    

    // Remove active state from code items

    const activeCodeItems = document.querySelectorAll('.code-item.active');

    activeCodeItems.forEach(item => item.classList.remove('active'));

}


// ==========================================================================

// EVIDENCE MAPPING - AUDIO PLAYBACK FUNCTIONS

// ==========================================================================


let currentAudioSegment = null;

let audioPlaybackTimer = null;


// Evidence data mapping - links note segments to audio timestamps

const evidenceMap = {

    'diabetes-diagnosis': {

        timestamp: '00:22',

        duration: 8,

        quote: "I've been doing better overall. My blood sugar has been more stable, usually between 110 and 140.",

        speaker: 'Patient'

    },

    'medication-adherence': {

        timestamp: '00:42',

        duration: 12,

        quote: "I've been pretty good about it, but I do forget sometimes. Maybe once or twice a week I miss a dose because I get busy at work.",

        speaker: 'Patient'

    },

    'hba1c-result': {

        timestamp: '01:15',

        duration: 10,

        quote: "Your HbA1c came back at 8.1%, which is higher than your last result of 7.4%. We need to work on bringing this down.",

        speaker: 'Doctor'

    },

    'weight-bmi': {

        timestamp: '02:10',

        duration: 8,

        quote: "Your weight is stable at 168 pounds, which gives you a BMI of 28.4.",

        speaker: 'Doctor'

    },

    'metformin-plan': {

        timestamp: '00:58',

        duration: 10,

        quote: "Have you considered setting reminders on your phone? That might help you stay on track.",

        speaker: 'Doctor'

    },

    'followup-plan': {

        timestamp: '03:20',

        duration: 12,

        quote: "Let's schedule you to come back in 3 months. We'll repeat your HbA1c and lipid panel at that time.",

        speaker: 'Doctor'

    }

};


function playEvidenceAudio(evidenceId, event) {

    const evidence = evidenceMap[evidenceId];

    if (!evidence) return;


    // Get the clicked element

    const clickedElement = event ? event.target : document.querySelector(`[data-evidence="${evidenceId}"]`);

    if (!clickedElement) return;


    // Show audio player

    const audioPlayer = document.getElementById('audioPlayerOverlay');

    if (!audioPlayer) return;


    // Position the player near the clicked element

    const rect = clickedElement.getBoundingClientRect();

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    

    // Position below the element with some offset

    audioPlayer.style.position = 'absolute';

    audioPlayer.style.top = (rect.bottom + scrollTop + 10) + 'px';

    audioPlayer.style.left = (rect.left + scrollLeft) + 'px';


    // Update player info

    document.getElementById('audioPlayerTitle').textContent = `${evidence.speaker} - ${evidence.timestamp}`;

    document.getElementById('audioTime').textContent = `${evidence.duration}s`;


    // Show player

    audioPlayer.classList.add('active');


    // Highlight the evidence link

    const evidenceLinks = document.querySelectorAll('.evidence-link');

    evidenceLinks.forEach(link => link.classList.remove('playing'));

    clickedElement.classList.add('playing');


    // Store current segment

    currentAudioSegment = evidenceId;


    // Auto-play simulation (in real implementation, this would play actual audio)

    startAudioPlayback(evidence.duration);

}


function startAudioPlayback(duration) {

    const audioPlayer = document.getElementById('audioPlayerOverlay');

    const playBtn = document.getElementById('audioPlayBtn');

    

    // Update UI to playing state

    audioPlayer.classList.add('playing');

    playBtn.innerHTML = `

        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">

            <rect x="6" y="4" width="4" height="16"/>

            <rect x="14" y="4" width="4" height="16"/>

        </svg>

    `;


    // Simulate audio playback with countdown

    let timeLeft = duration;

    const timeDisplay = document.getElementById('audioTime');

    

    audioPlaybackTimer = setInterval(() => {

        timeLeft--;

        timeDisplay.textContent = `${timeLeft}s`;

        

        if (timeLeft <= 0) {

            stopAudioPlayback();

        }

    }, 1000);

}


function stopAudioPlayback() {

    const audioPlayer = document.getElementById('audioPlayerOverlay');

    const playBtn = document.getElementById('audioPlayBtn');

    

    // Clear timer

    if (audioPlaybackTimer) {

        clearInterval(audioPlaybackTimer);

        audioPlaybackTimer = null;

    }


    // Update UI to stopped state

    audioPlayer.classList.remove('playing');

    playBtn.innerHTML = `

        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">

            <polygon points="5,3 19,12 5,21"/>

        </svg>

    `;


    // Remove playing state from evidence links

    const evidenceLinks = document.querySelectorAll('.evidence-link');

    evidenceLinks.forEach(link => link.classList.remove('playing'));

}


function toggleAudioPlayback() {

    const audioPlayer = document.getElementById('audioPlayerOverlay');

    

    if (audioPlayer.classList.contains('playing')) {

        stopAudioPlayback();

    } else {

        // Resume playback

        if (currentAudioSegment) {

            const evidence = evidenceMap[currentAudioSegment];

            if (evidence) {

                startAudioPlayback(evidence.duration);

            }

        }

    }

}


function closeAudioPlayer() {

    stopAudioPlayback();

    const audioPlayer = document.getElementById('audioPlayerOverlay');

    if (audioPlayer) {

        audioPlayer.classList.remove('active');

    }

    currentAudioSegment = null;

}


// Close SOAP notes when clicking outside

document.addEventListener('click', function(e) {

    const soapOverlay = document.getElementById('soapNotesOverlay');

    if (soapOverlay && soapOverlay.classList.contains('active') && e.target === soapOverlay) {

        closeSoapNotes();

    }

});


// Close SOAP notes with Escape key

document.addEventListener('keydown', function(e) {

    if (e.key === 'Escape') {

        const soapOverlay = document.getElementById('soapNotesOverlay');

        if (soapOverlay && soapOverlay.classList.contains('active')) {

            closeSoapNotes();

        }

    }

});


// Close confirmation modal when clicking outside

document.addEventListener('click', function(e) {

    const overlay = document.getElementById('stopConfirmationOverlay');

    if (overlay && overlay.classList.contains('active') && e.target === overlay) {

        hideStopConsultationConfirmation();

    }

});


// Close confirmation modal with Escape key

document.addEventListener('keydown', function(e) {

    if (e.key === 'Escape') {

        const overlay = document.getElementById('stopConfirmationOverlay');

        if (overlay && overlay.classList.contains('active')) {

            hideStopConsultationConfirmation();

        }

    }

});


function minimizeScribe() {

    const scribeExpanded = document.getElementById('scribeExpanded');

    if (scribeExpanded) {

        scribeExpanded.classList.remove('active');

        isScribeExpanded = false;

    }

}


function toggleScribeExpanded(event) {

    event.stopPropagation();

    const scribeExpanded = document.getElementById('scribeExpanded');

    if (scribeExpanded) {

        if (isScribeExpanded) {

            scribeExpanded.classList.remove('active');

            isScribeExpanded = false;

        } else {

            scribeExpanded.classList.add('active');

            isScribeExpanded = true;

        }

    }

}


function closeScribeExpanded() {

    const scribeExpanded = document.getElementById('scribeExpanded');

    if (scribeExpanded) {

        scribeExpanded.classList.remove('active');

        isScribeExpanded = false;

    }

}


function showMinimalNotification(message) {

    const notification = document.createElement('div');

    notification.style.cssText = `

        position: fixed;

        top: 20px;

        right: 20px;

        background: rgba(255, 255, 255, 0.95);

        backdrop-filter: blur(20px);

        border: 1px solid rgba(139, 92, 246, 0.2);

        border-radius: 12px;

        padding: 12px 16px;

        font-size: 13px;

        font-weight: 500;

        color: #374151;

        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);

        z-index: 4000;

        animation: slideInRight 0.3s ease;

        max-width: 280px;

    `;

    

    notification.textContent = message;

    

    document.body.appendChild(notification);

    

    // Auto-remove after 3 seconds

    setTimeout(() => {

        notification.style.animation = 'slideInRight 0.3s reverse';

        setTimeout(() => {

            if (notification.parentNode) {

                notification.parentNode.removeChild(notification);

            }

        }, 300);

    }, 3000);

}


// ==========================================================================

// UTILITY FUNCTIONS

// ==========================================================================

function refreshHeaderData() {

    const syncTimeElement = document.getElementById('headerSyncTime');

    if (syncTimeElement) {

        const now = new Date();

        const timeString = now.toLocaleTimeString('en-US', { 

            hour: 'numeric', 

            minute: '2-digit',

            hour12: true 

        });

        syncTimeElement.textContent = timeString;

        

        // Add refresh animation

        const refreshBtn = document.querySelector('.refresh-btn-header');

        if (refreshBtn) {

            refreshBtn.style.transform = 'rotate(360deg)';

            setTimeout(() => {

                refreshBtn.style.transform = 'rotate(0deg)';

            }, 500);

        }

        

        console.log('Header data refreshed at:', timeString);

    }

}


function updateToggleButton(state) {

    const toggleBtn = document.getElementById('toggleBtn');

    if (!toggleBtn) return;

    

    if (state === 'minimize') {

        // Minimize icon: corners pointing inward (matches AWS Scribe)

        toggleBtn.innerHTML = `

            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>

            </svg>

        `;

        toggleBtn.title = 'Minimize';

    } else if (state === 'restore') {

        // Restore icon: 4 corner brackets pointing outward ⌜ ⌝ ⌞ ⌟

        toggleBtn.innerHTML = `

            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">

                <polyline points="15 3 21 3 21 9"></polyline>

                <polyline points="21 15 21 21 15 21"></polyline>

                <polyline points="9 21 3 21 3 15"></polyline>

                <polyline points="3 9 3 3 9 3"></polyline>

            </svg>

        `;

        toggleBtn.title = 'Restore';

    }

}


function toggleChat() {

    const chatOverlay = document.getElementById('chatOverlay');

    if (chatOverlay) {

        chatOverlay.classList.toggle('active');

    }

}


function sendMessage() {

    const chatInput = document.querySelector('.chat-input');

    const message = chatInput.value.trim();

    

    if (message) {

        console.log('Chat message sent:', message);

        chatInput.value = '';

        // Add your chat logic here

    }

}


function clearAllTopicSelections() {

    // Clear all topic selections and reset chat input

    const chatIcon = document.querySelector('.chat-input-icon');

    const chatInput = document.querySelector('.patient-chat-input');

    const pillsContainer = document.getElementById('chatTopicPills');

    

    if (chatIcon) {

        chatIcon.className = 'chat-input-icon';

        chatIcon.removeAttribute('data-count');

        chatIcon.title = 'No topics selected';

        

        // Add clear feedback animation

        chatIcon.style.animation = 'clearFeedback 0.3s ease';

        setTimeout(() => {

            chatIcon.style.animation = '';

        }, 300);

    }

    

    if (chatInput) {

        chatInput.placeholder = 'Type a message...';

    }

    

    if (pillsContainer) {

        pillsContainer.innerHTML = '';

    }

    

    // Send message to iframe to clear selections

    const iframe = document.getElementById('previsitIframe');

    if (iframe && iframe.contentWindow) {

        iframe.contentWindow.postMessage({

            type: 'clearAllSelections'

        }, window.location.origin);

    }

    

    console.log('All topic selections cleared');

}


// Auto-update timestamp every 30 seconds

setInterval(refreshHeaderData, 30000);


// ==========================================================================
// MEDICAL CODES API INTEGRATION
// ==========================================================================

/**
 * Fetch medical codes from the backend API
 * @param {string} clinicalText - The SOAP note text to analyze
 * @param {object} patientContext - Optional patient context (dateOfBirth, sex, status)
 * @param {object} encounterContext - Optional encounter context (encounterType, encounterFormat)
 * @returns {Promise<Array>} Array of medical codes
 */
async function fetchMedicalCodes(clinicalText, patientContext = null, encounterContext = null) {
    try {
        const requestBody = {
            text: clinicalText
        };
        
        if (patientContext) {
            requestBody.patientContext = patientContext;
        }
        
        if (encounterContext) {
            requestBody.encounterContext = encounterContext;
        }
        
        const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
        console.log('Calling /api/medical-codes with text length:', clinicalText.length);
        
        const response = await fetch(`${backendUrl}/api/medical-codes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('API response status:', response.status);
        
        if (!response.ok) {
            console.error('API request failed with status:', response.status);
            return [];
        }
        
        const data = await response.json();
        console.log('API response data:', data);
        
        if (data.success) {
            // Default confidence to 0.90 if not provided (standalone API doesn't return it)
            const codes = (data.medicalCodes || []).map(c => ({
                ...c,
                confidence: c.confidence != null ? c.confidence : 0.90
            }));
            console.log('Medical codes fetched:', codes);
            return codes;
        } else {
            console.error('Medical codes API error:', data.error);
            return [];
        }
    } catch (error) {
        console.error('Failed to fetch medical codes:', error);
        return [];
    }
}

/**
 * Extract plain text from SOAP notes for API submission
 * @returns {string} Combined SOAP note text
 */
function extractSoapNoteText() {
    // Prefer inline view, fall back to overlay
    const inlineMain = document.querySelector('.soap-notes-inline .soap-notes-main');
    const target = inlineMain || document.querySelector('.soap-notes-main');

    if (!target) return '';

    const sections = target.querySelectorAll('.soap-section-content');
    if (sections.length > 0) {
        let text = '';
        sections.forEach(section => { text += section.textContent + '\n\n'; });
        return text.trim();
    }
    return target.textContent.trim();
}

/**
 * Render medical codes in the sidebar
 * @param {Array} codes - Array of medical code objects from API
 */
function renderMedicalCodesSidebar(codes) {
    const codeListContainer = document.querySelector('.code-list-sidebar');
    if (!codeListContainer) {
        console.error('Code list sidebar container not found');
        return;
    }

    // Clear existing codes
    codeListContainer.innerHTML = '';

    if (!codes || codes.length === 0) {
        codeListContainer.innerHTML = `
            <div class="code-section-header">ICD-10 Diagnosis Codes</div>
            <div class="no-codes-message">No codes detected</div>
            <div class="code-section-header" style="margin-top:12px;">CPT Procedure Codes</div>
            <div class="no-codes-message">No codes detected</div>
        `;
        return;
    }

    // Separate ICD10 and CPT codes
    const icdCodes = codes.filter(c => {
        const sys = (c.system || '').toUpperCase();
        return sys === 'ICD10' || sys === 'ICD-10' || (c.name && c.name.match(/^[A-Z]\d/));
    });
    const cptCodes = codes.filter(c => {
        const sys = (c.system || '').toUpperCase();
        return sys === 'CPT' || (c.name && c.name.match(/^\d{5}$/));
    });

    // Helper to split into primary (>=60%) and low confidence (<60%)
    function splitByConfidence(arr) {
        const primary = arr.filter(c => {
            const conf = typeof c.confidence === 'number' ? c.confidence : parseFloat(c.confidence) / 100;
            return conf >= 0.60;
        });
        const low = arr.filter(c => {
            const conf = typeof c.confidence === 'number' ? c.confidence : parseFloat(c.confidence) / 100;
            return conf < 0.60;
        });
        return { primary, low };
    }

    // Render ICD-10 section
    const icdHeader = document.createElement('div');
    icdHeader.className = 'code-section-header';
    icdHeader.textContent = 'ICD-10 Diagnosis Codes';
    codeListContainer.appendChild(icdHeader);

    if (icdCodes.length === 0) {
        const noIcd = document.createElement('div');
        noIcd.className = 'no-codes-message';
        noIcd.textContent = 'No diagnosis codes detected';
        codeListContainer.appendChild(noIcd);
    } else {
        const { primary, low } = splitByConfidence(icdCodes);
        primary.forEach(code => codeListContainer.appendChild(createCodeElement(code, true)));
        if (low.length > 0) {
            const otherSection = document.createElement('div');
            otherSection.className = 'other-predictions-section';
            // nosemgrep: insecure-innerhtml — static toggle UI with count, no user data
            const _html5 = `
                <div class="other-predictions-toggle" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>Other predictions (${low.length})</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,4 6,8 10,4"/></svg>
                </div>
                <div class="other-predictions-list"></div>
            `;
            otherSection.innerHTML = _html5; // nosemgrep: insecure-innerhtml, insecure-document-method
            const listEl = otherSection.querySelector('.other-predictions-list');
            low.forEach(code => listEl.appendChild(createCodeElement(code, false)));
            codeListContainer.appendChild(otherSection);
        }
    }

    // Render CPT section
    const cptHeader = document.createElement('div');
    cptHeader.className = 'code-section-header';
    cptHeader.style.marginTop = '12px';
    cptHeader.textContent = 'CPT Procedure Codes';
    codeListContainer.appendChild(cptHeader);

    if (cptCodes.length === 0) {
        const noCpt = document.createElement('div');
        noCpt.className = 'no-codes-message';
        noCpt.textContent = 'No procedure codes detected';
        codeListContainer.appendChild(noCpt);
    } else {
        const { primary, low } = splitByConfidence(cptCodes);
        primary.forEach(code => codeListContainer.appendChild(createCodeElement(code, true)));
        if (low.length > 0) {
            const otherSection = document.createElement('div');
            otherSection.className = 'other-predictions-section';
            // nosemgrep: insecure-innerhtml — static toggle UI with count, no user data
            const _html6 = `
                <div class="other-predictions-toggle" onclick="this.parentElement.classList.toggle('expanded')">
                    <span>Other predictions (${low.length})</span>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,4 6,8 10,4"/></svg>
                </div>
                <div class="other-predictions-list"></div>
            `;
            otherSection.innerHTML = _html6; // nosemgrep: insecure-innerhtml, insecure-document-method
            const listEl = otherSection.querySelector('.other-predictions-list');
            low.forEach(code => listEl.appendChild(createCodeElement(code, false)));
            codeListContainer.appendChild(otherSection);
        }
    }

    console.log(`Rendered ${icdCodes.length} ICD-10 + ${cptCodes.length} CPT codes`);
}

function createCodeElement(code, selected) {
    const codeElement = document.createElement('div');
    codeElement.className = 'code-item-sidebar' + (selected ? ' selected' : '');
    codeElement.setAttribute('data-code', code.name);

    // Format confidence as percentage
    const confidenceRaw = typeof code.confidence === 'number' ? code.confidence : parseFloat(code.confidence) / 100;
    const confidencePercent = Math.round(confidenceRaw * 100);

    // Confidence color: 80%+ green, 50-80% orange, <50% red
    let confClass = 'conf-high';
    if (confidencePercent < 50) confClass = 'conf-low';
    else if (confidencePercent < 80) confClass = 'conf-medium';

    // Clean description — sometimes the API returns the description doubled
    let desc = code.description || 'No description';
    const half = desc.length / 2;
    if (desc.length > 10 && desc.substring(0, Math.floor(half)).trim() === desc.substring(Math.ceil(half)).trim()) {
        desc = desc.substring(0, Math.floor(half)).trim();
    }

    // nosemgrep: insecure-innerhtml — medical code data from trusted AWS API, all values passed through escapeHtml()
    const _html7 = `
        <div class="code-item-header">
            <label class="code-checkbox-label" onclick="event.stopPropagation()">
                <input type="checkbox" class="code-checkbox" ${selected ? 'checked' : ''}
                    onchange="toggleCodeSelection(this, '${escapeHtml(code.name)}')" />
                <span class="code-checkbox-custom"></span>
            </label>
            <div class="code-badge-sidebar">${escapeHtml(code.name)}</div>
            <div class="code-confidence ${confClass}">${confidencePercent}%</div>
        </div>
        <div class="code-description-sidebar">${escapeHtml(desc)}</div>
    `;
    codeElement.innerHTML = _html7; // nosemgrep: insecure-innerhtml, insecure-document-method

    // Click on the card highlights in SOAP notes (not the checkbox)
    codeElement.addEventListener('click', (e) => {
        if (e.target.closest('.code-checkbox-label')) return;
        toggleCodeHighlight(code.name);
    });

    return codeElement;
}

function toggleCodeSelection(checkbox, codeName) {
    const codeItem = checkbox.closest('.code-item-sidebar');
    if (checkbox.checked) {
        codeItem.classList.add('selected');
    } else {
        codeItem.classList.remove('selected');
    }
    const total = document.querySelectorAll('.code-item-sidebar .code-checkbox').length;
    const selected = document.querySelectorAll('.code-item-sidebar .code-checkbox:checked').length;
    console.log(`[MedicalCodes] ${selected}/${total} codes selected`);
}

/**
 * Generate medical codes from current SOAP notes and update sidebar
 * Called when SOAP notes are displayed or updated
 */
async function generateAndDisplayMedicalCodes() {
    // Skip if codes were already loaded from S3
    if (window.medicalCodesLoadedFromS3) {
        console.log('[MedicalCodes] Skipping - codes already loaded from S3');
        return;
    }
    
    // Show loading state
    const codeListContainer = document.querySelector('.code-list-sidebar');
    if (codeListContainer) {
        codeListContainer.innerHTML = `
            <div class="codes-loading">
                <div class="codes-loading-spinner"></div>
                <span>Analyzing clinical text...</span>
            </div>
        `;
    }
    
    // Extract SOAP note text
    const clinicalText = extractSoapNoteText();
    
    if (!clinicalText) {
        console.warn('No SOAP note text found');
        renderMedicalCodesSidebar([]);
        return;
    }
    
    console.log('Extracted SOAP text length:', clinicalText.length);
    console.log('SOAP text preview:', clinicalText.substring(0, 200) + '...');
    
    // Get current patient context if available
    const patientContext = getCurrentPatientContext();
    console.log('Patient context:', patientContext);
    
    // Fetch codes from API
    const codes = await fetchMedicalCodes(clinicalText, patientContext, {
        encounterFormat: 'IN_PERSON'
    });
    
    console.log('API returned codes:', codes);
    
    // If API returned empty or failed, show the hardcoded codes as fallback
    if (!codes || codes.length === 0) {
        console.log('No codes from API');
        renderMedicalCodesSidebar([]);
        return;
    }
    
    // Render codes in sidebar
    renderMedicalCodesSidebar(codes);
    
    // Optionally link codes to text spans
    linkCodesToText(codes);
}

/**
 * Get current patient context for API call
 * @returns {object|null} Patient context object
 */
function getCurrentPatientContext() {
    // Try to get patient info from the header
    const patientDemo = document.getElementById('headerPatientDemo');
    if (!patientDemo) return null;
    
    const demoText = patientDemo.textContent || '';
    
    // Parse age and gender from "58 yrs • Female" format
    const ageMatch = demoText.match(/(\d+)\s*yrs?/i);
    const genderMatch = demoText.match(/\b(male|female)\b/i);
    
    const context = {
        status: 'ESTABLISHED'
    };
    
    if (ageMatch) {
        // Estimate birth year from age
        const age = parseInt(ageMatch[1]);
        const birthYear = new Date().getFullYear() - age;
        context.dateOfBirth = `${birthYear}-01-01`;
    }
    
    if (genderMatch) {
        context.sex = genderMatch[1].toUpperCase();
    }
    
    return context;
}

/**
 * Link medical codes to text spans in SOAP notes
 * Adds data-code attributes to matching text
 * @param {Array} codes - Array of medical codes
 */
function linkCodesToText(codes) {
    if (!codes || codes.length === 0) return;
    
    // Map of common conditions to their codes
    const codePatterns = {
        'E11': /type\s*2\s*diabetes|diabetes\s*mellitus|t2dm|dm2/gi,
        'I10': /hypertension|high\s*blood\s*pressure|htn/gi,
        'E66': /overweight|obesity|obese|bmi/gi,
        'Z79.84': /metformin|oral\s*hypoglycemic|diabetes\s*medication/gi,
        'Z91.12': /non-?adherence|missed\s*doses?|underdosing/gi,
        '99214': /follow-?up|office\s*visit|established\s*patient/gi,
        '99213': /office\s*visit|low\s*complexity/gi
    };
    
    // For each code, find matching text and add highlighting capability
    codes.forEach(code => {
        const codePrefix = code.name.split('.')[0];
        const pattern = codePatterns[codePrefix] || codePatterns[code.name];
        
        if (pattern) {
            // Find text nodes that match and could be linked
            const soapContent = document.querySelectorAll('.soap-section-content');
            soapContent.forEach(section => {
                // Check if any existing spans already have this code
                const existingLinks = section.querySelectorAll(`[data-code="${code.name}"]`);
                if (existingLinks.length === 0) {
                    // Could add dynamic linking here if needed
                    console.log('Code could be linked to matching text (name redacted — clinical data)');
                }
            });
        }
    });
}


// ==========================================================================

// ERROR HANDLING

// ==========================================================================

window.addEventListener('error', function(e) {

    console.error('JavaScript error:', e.error);

});


// ==========================================================================

// PERFORMANCE OPTIMIZATION

// ==========================================================================

// Debounce function for resize events

function debounce(func, wait) {

    let timeout;

    return function executedFunction(...args) {

        const later = () => {

            clearTimeout(timeout);

            func(...args);

        };

        clearTimeout(timeout);

        timeout = setTimeout(later, wait);

    };

}


// Handle window resize

window.addEventListener('resize', debounce(function() {

    // Adjust container if needed on window resize

    if (!isMinimized && !isMaximized) {

        storeOriginalState();

    }

}, 250));


// ==========================================================================
// STREAMING INTEGRATION
// ==========================================================================

// Store for live transcripts
let liveTranscripts = [];
let partialTranscript = '';

/**
 * Start streaming transcription
 */
async function startStreaming() {
    console.log('[Streaming] Starting streaming transcription...');
    
    // Reset the S3 codes flag for new session
    window.medicalCodesLoadedFromS3 = false;
    
    // Demo mode: skip real WebSocket, generate a fake session ID
    if (window.DEMO_MODE) {
        console.log('[Streaming] DEMO MODE — skipping real streaming');
        currentStreamingSessionId = 'demo-session-' + Date.now();
        console.log('[Streaming] Demo session ID:', currentStreamingSessionId);
        return;
    }
    
    // Check if ConnectHealthStreaming is available
    if (typeof ConnectHealthStreaming === 'undefined') {
        console.warn('[Streaming] ConnectHealthStreaming not loaded, skipping real transcription');
        return;
    }
    
    try {
        const sessionId = await ConnectHealthStreaming.start({
            onTranscript: handleStreamTranscript,
            onStatusChange: handleStreamStatusChange,
            onError: handleStreamError
        });
        
        // Store the session ID globally for fetching S3 outputs later
        currentStreamingSessionId = sessionId;
        console.log('[Streaming] Streaming started successfully, session ID:', sessionId);
        
    } catch (error) {
        console.error('[Streaming] Failed to start streaming:', error);
        // Show user-friendly error
        showStreamError('Could not start transcription. Please check microphone permissions.');
    }
}

/**
 * Stop streaming transcription
 */
function stopConnectHealthStreaming() {
    console.log('[Streaming] Stopping streaming transcription...');
    
    // Demo mode: nothing to stop
    if (window.DEMO_MODE) {
        console.log('[Streaming] DEMO MODE — stop (no-op), session ID preserved:', currentStreamingSessionId);
        return;
    }
    
    if (typeof ConnectHealthStreaming !== 'undefined' && ConnectHealthStreaming.isActive()) {
        ConnectHealthStreaming.stop();
        // Note: Don't clear currentStreamingSessionId here - we need it to fetch S3 outputs
        console.log('[Streaming] Stopped streaming, session ID preserved:', currentStreamingSessionId);
    }
}

/**
 * Handle transcript updates from streaming
 */
function handleStreamTranscript(data) {
    const { text, isFinal } = data;
    
    if (!text) return;
    
    if (isFinal) {
        // Add to final transcripts
        liveTranscripts.push({
            text: text,
            timestamp: new Date(),
            isFinal: true
        });
        partialTranscript = '';
        
        console.log('[Streaming] Final transcript received (length=' + (text || '').length + ' chars; content redacted — PHI)');
    } else {
        // Update partial transcript
        partialTranscript = text;
    }
    
    // Update the UI
    updateLiveTranscriptDisplay();
    
    // Feed to scribe sidebar transcript panel
    if (typeof addTranscriptEntry === 'function') {
        addTranscriptEntry(text, isFinal);
    }
}

/**
 * Handle streaming status changes
 */
function handleStreamStatusChange(status) {
    console.log('[Streaming] Status changed:', status);
    
    // Update UI based on status
    const statusIndicator = document.querySelector('.streaming-status');
    if (statusIndicator) {
        statusIndicator.className = 'streaming-status ' + status;
        statusIndicator.textContent = status;
    }
}

/**
 * Handle streaming errors
 */
function handleStreamError(error) {
    console.error('[Streaming] Error:', error);
    showStreamError(error.message || 'Transcription error occurred');
}

/**
 * Update the live transcript display in the UI
 */
function updateLiveTranscriptDisplay() {
    // Find or create transcript display element
    let transcriptDisplay = document.getElementById('liveTranscriptDisplay');
    
    if (!transcriptDisplay) {
        // Create transcript display in the scribe interface
        const scribeInterface = document.querySelector('.scribe-interface');
        if (scribeInterface) {
            transcriptDisplay = document.createElement('div');
            transcriptDisplay.id = 'liveTranscriptDisplay';
            transcriptDisplay.className = 'live-transcript';
            transcriptDisplay.innerHTML = '<div class="transcript-content"></div>';
            
            // Insert after the soundwave container
            const soundwave = scribeInterface.querySelector('.soundwave-container');
            if (soundwave) {
                soundwave.after(transcriptDisplay);
            } else {
                scribeInterface.appendChild(transcriptDisplay);
            }
        }
    }
    
    if (transcriptDisplay) {
        const content = transcriptDisplay.querySelector('.transcript-content') || transcriptDisplay;
        
        // Clear existing content and rebuild with safe DOM APIs
        content.replaceChildren();
        
        // Show final transcripts
        liveTranscripts.forEach(t => {
            const entry = document.createElement('div');
            entry.className = 'transcript-entry final';
            entry.textContent = t.text;
            content.appendChild(entry);
        });
        
        // Show partial transcript
        if (partialTranscript) {
            const partialEntry = document.createElement('div');
            partialEntry.className = 'transcript-entry partial';
            partialEntry.textContent = partialTranscript;
            content.appendChild(partialEntry);
        }
        
        if (content.children.length === 0) {
            const placeholder = document.createElement('p');
            placeholder.className = 'transcript-placeholder';
            placeholder.textContent = 'Listening...';
            content.appendChild(placeholder);
        }
        
        // Auto-scroll the transcript container to bottom
        transcriptDisplay.scrollTop = transcriptDisplay.scrollHeight;
    }
}

/**
 * Show streaming error to user
 */
function showStreamError(message) {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = 'streaming-error-toast';
    // nosemgrep: insecure-innerhtml — static SVG + escapeHtml on message
    const _html8 = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>${escapeHtml(message)}</span>
    `;
    toast.innerHTML = _html8; // nosemgrep: insecure-innerhtml, insecure-document-method
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Get all transcripts for export/saving
 */
function getStreamTranscripts() {
    return liveTranscripts;
}

/**
 * Clear transcripts (call when starting new consultation)
 */
function clearStreamTranscripts() {
    liveTranscripts = [];
    partialTranscript = '';
    updateLiveTranscriptDisplay();
}

// ==========================================================================
// SMS NOTIFICATION FUNCTIONS
// ==========================================================================

/**
 * Initialize SMS character counter
 */
function initializeSMSCharCounter() {
    const textarea = document.getElementById('smsMessageTextarea');
    const counter = document.getElementById('smsCharCounter');
    
    if (!textarea || !counter) return;
    
    const updateCounter = () => {
        const length = textarea.value.length;
        counter.textContent = `${length}/160`;
        
        // Update styling based on length
        counter.classList.remove('warning', 'danger');
        if (length > 160) {
            counter.classList.add('danger');
        } else if (length > 140) {
            counter.classList.add('warning');
        }
    };
    
    textarea.addEventListener('input', updateCounter);
    updateCounter(); // Initial update
}

/**
 * Populate SMS message from After Visit Summary data
 */
function populateSMSFromAVS() {
    const textarea = document.getElementById('smsMessageTextarea');
    const smsSection = document.querySelector('.sms-section');
    if (!textarea) return;

    // Get patient name from header
    const patientNameEl = document.getElementById('headerPatientName');
    const fullName = patientNameEl ? patientNameEl.textContent.trim() : 'Patient';
    const firstName = fullName.split(' ')[0];

    // Update inline patient name in SMS header
    const smsPatientNameEl = document.getElementById('smsPatientName');
    if (smsPatientNameEl) {
        smsPatientNameEl.textContent = fullName;
    }

    // Check if a follow-up was actually discussed in the AVS
    let followupSegment = null;
    let followupTimeframe = 'recommended';

    if (streamingSessionOutputs && streamingSessionOutputs.afterVisitSummary) {
        const avs = streamingSessionOutputs.afterVisitSummary;
        let segments = [];

        if (avs.AfterVisitSummary && avs.AfterVisitSummary.SummarizedSegments) {
            segments = avs.AfterVisitSummary.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
        } else if (avs.SummarizedSegments) {
            segments = avs.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
        }

        // Find follow-up related segment
        followupSegment = segments.find(s =>
            s.toLowerCase().includes('follow-up') ||
            s.toLowerCase().includes('come back') ||
            s.toLowerCase().includes('schedule') ||
            s.toLowerCase().includes('appointment')
        );

        // Try to extract timeframe from the segment
        if (followupSegment) {
            const timeMatch = followupSegment.match(/(\d+[\s-]*(week|month|day|year)s?)/i);
            if (timeMatch) {
                followupTimeframe = timeMatch[1].toLowerCase();
            }
        }
    }

    // If no follow-up was discussed, hide the SMS section entirely
    if (!followupSegment) {
        if (smsSection) smsSection.style.display = 'none';
        window._followUpDiscussed = false;
        return;
    }

    // Follow-up was discussed — show SMS section and populate
    if (smsSection) smsSection.style.display = '';
    window._followUpDiscussed = true;

    // Pre-populated message with doctor name, timeframe, and office number
    const schedPhone = window.CLINIC_PHONE ? window.CLINIC_PHONE.schedulingNumber : '(555) 010-0100';
    const officePhone = window.CLINIC_PHONE ? window.CLINIC_PHONE.officeNumber : '(555) 010-0100';
    let message = `Hi ${firstName}, this is Dr. Patel's office. `;
    message += `Please call ${schedPhone} to schedule the ${followupTimeframe} follow-up appointment you spoke about with Dr. Patel. `;
    message += `If you have any questions or problems, call our office at ${officePhone}. Thank you!`;

    textarea.value = message;

    // Update character counter
    initializeSMSCharCounter();
}

/**
 * Send follow-up SMS to patient via backend
 */
async function sendFollowupSMS() {
    const phoneInput = document.getElementById('smsPhoneInput');
    const messageTextarea = document.getElementById('smsMessageTextarea');
    const sendBtn = document.getElementById('smsSendBtn');
    const statusContainer = document.getElementById('smsStatusContainer');
    const backendUrl = window.BACKEND_URL || 'http://localhost:5000';
    
    if (!phoneInput || !messageTextarea || !sendBtn) return;
    
    const phoneNumber = phoneInput.value.trim();
    const message = messageTextarea.value.trim();
    
    // Validate phone number
    if (!phoneNumber) {
        showSMSStatus('error', 'Please enter a phone number');
        return;
    }
    
    // Format phone number to E.164 if needed
    let formattedPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');
    if (!formattedPhone.startsWith('+')) {
        // Assume US number if no country code
        if (formattedPhone.length === 10) {
            formattedPhone = '+1' + formattedPhone;
        } else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) {
            formattedPhone = '+' + formattedPhone;
        }
    }
    
    // Validate E.164 format
    if (!/^\+[1-9]\d{9,14}$/.test(formattedPhone)) {
        showSMSStatus('error', 'Invalid phone number format. Use format: +15551234567');
        return;
    }
    
    if (!message) {
        showSMSStatus('error', 'Please enter a message');
        return;
    }
    
    // Disable button and show sending state
    sendBtn.disabled = true;
    // nosemgrep: insecure-innerhtml — static SVG spinner, no dynamic data
    sendBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spinning">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/>
        </svg>
        Sending...
    `;
    
    showSMSStatus('sending', 'Sending SMS...');
    
    try {
        const response = await fetch(`${backendUrl}/api/send-sms`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phoneNumber: formattedPhone,
                message: message
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showSMSStatus('success', 'SMS sent successfully!');
            
            // Replace SMS section with confirmation
            const smsSection = document.getElementById('smsNotificationSection');
            if (smsSection) {
                // nosemgrep: insecure-innerhtml — static template; phone number is E.164-validated and escapeHtml'd
                const _html9 = `
                    <div class="sms-sent-confirmation">
                        <div class="sms-sent-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                        </div>
                        <div class="sms-sent-details">
                            <div class="sms-sent-title">Follow-up reminder sent</div>
                            <div class="sms-sent-subtitle">SMS delivered to ${escapeHtml(formattedPhone)}</div>
                        </div>
                    </div>
                `;
                smsSection.innerHTML = _html9; // nosemgrep: insecure-innerhtml, insecure-document-method
            }
            
            // Update the follow-up section to reflect SMS was sent
            updateFollowUpAfterSMS();
        } else {
            showSMSStatus('error', result.error || 'Failed to send SMS');
            resetSMSButton();
        }
    } catch (error) {
        console.error('[SMS] Error sending SMS:', error);
        showSMSStatus('error', 'Network error. Please try again.');
        resetSMSButton();
    }
}

/**
 * Reset SMS send button to default state
 */
function resetSMSButton() {
    const sendBtn = document.getElementById('smsSendBtn');
    if (sendBtn) {
        sendBtn.disabled = false;
        // nosemgrep: insecure-innerhtml — static SVG icon + static text
        sendBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
            Send SMS
        `;
    }
}

/**
 * Show SMS status message
 * @param {string} type - 'success', 'error', or 'sending'
 * @param {string} message - Status message to display
 */
function showSMSStatus(type, message) {
    const container = document.getElementById('smsStatusContainer');
    if (!container) return;
    
    let icon = '';
    switch (type) {
        case 'success':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>`;
            break;
        case 'error':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>`;
            break;
        case 'sending':
            icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>`;
            break;
    }
    
    // nosemgrep: insecure-innerhtml — static SVG icons + escapeHtml on message, type is from hardcoded switch
    const _html10 = `
        <div class="sms-status ${type}">
            ${icon}
            <span>${escapeHtml(message)}</span>
        </div>
    `;
    container.innerHTML = _html10; // nosemgrep: insecure-innerhtml, insecure-document-method
    
    // Auto-hide success/error after 5 seconds
    if (type !== 'sending') {
        setTimeout(() => {
            const status = container.querySelector('.sms-status');
            if (status) {
                status.style.opacity = '0';
                setTimeout(() => {
                    container.innerHTML = '';
                }, 300);
            }
        }, 5000);
    }
}

/**
 * Skip SMS notification
 */
function skipSMS() {
    const smsSection = document.getElementById('smsNotificationSection');
    if (smsSection) {
        smsSection.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        smsSection.style.opacity = '0';
        smsSection.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            smsSection.style.display = 'none';
        }, 300);
    }
}

/**
 * Initialize SMS section when completion overlay is shown
 * Called from showFinalCompletionOverlay
 */
function initializeSMSSection() {
    // Populate message from AVS data
    populateSMSFromAVS();
    
    // Initialize character counter
    initializeSMSCharCounter();
}

// Add CSS for spinning animation
const smsSpinStyle = document.createElement('style');
// nosemgrep: insecure-document-method, html-in-template-string, missing-template-string-indicator
smsSpinStyle.textContent = `
    .sms-send-btn .spinning {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(smsSpinStyle);


// ==========================================================================
// DYNAMIC COMPLETION DATA FUNCTIONS
// ==========================================================================

/**
 * Populate dynamic billing codes and follow-up recommendation from API data
 */
function populateDynamicCompletionData() {
    // Populate billing codes from streamingSessionOutputs
    populateBillingCodesText();
    
    // Populate follow-up recommendation from AVS data
    populateFollowUpRecommendation();
    
    // Populate Patient Visit Summary date and visit type
    populatePatientSummaryMeta();
}

/**
 * Populate billing codes text from medical codes data
 */
function populateBillingCodesText() {
    const billingCodesText = document.getElementById('billingCodesText');
    if (!billingCodesText) return;
    
    console.log('[BillingCodes] streamingSessionOutputs:', streamingSessionOutputs);
    console.log('[BillingCodes] processingS3Data:', typeof processingS3Data !== 'undefined' ? processingS3Data : 'undefined');
    
    // Try to get medical codes from multiple sources
    let medicalCodesData = null;
    
    // First try streamingSessionOutputs
    if (streamingSessionOutputs && streamingSessionOutputs.medicalCodes) {
        medicalCodesData = streamingSessionOutputs.medicalCodes;
        console.log('[BillingCodes] Found codes in streamingSessionOutputs');
    }
    // Then try processingS3Data (from processing page)
    else if (typeof processingS3Data !== 'undefined' && processingS3Data && processingS3Data.medicalCodes) {
        medicalCodesData = processingS3Data.medicalCodes;
        console.log('[BillingCodes] Found codes in processingS3Data');
    }
    
    if (medicalCodesData) {
        console.log('[BillingCodes] Medical codes data:', medicalCodesData);
        
        let codeList = [];
        
        // Parse medical codes - handle different formats
        let medicalCodes = [];
        if (medicalCodesData.medicalCodes && Array.isArray(medicalCodesData.medicalCodes)) {
            medicalCodes = medicalCodesData.medicalCodes;
        } else if (Array.isArray(medicalCodesData)) {
            medicalCodes = medicalCodesData;
        }
        
        console.log('[BillingCodes] Parsed codes array:', medicalCodes);
        
        // Separate by type
        const icd10Codes = [];
        const cptCodes = [];
        
        medicalCodes.forEach(code => {
            const codeName = code.name || code.code || '';
            const system = (code.system || '').toUpperCase();
            
            if (system === 'ICD10' || system === 'ICD-10' || codeName.match(/^[A-Z]\d/)) {
                icd10Codes.push(codeName);
            } else if (system === 'CPT' || codeName.match(/^\d{5}$/)) {
                cptCodes.push(codeName);
            } else {
                // Default to ICD10 if unclear
                icd10Codes.push(codeName);
            }
        });
        
        console.log('[BillingCodes] ICD10:', icd10Codes, 'CPT:', cptCodes);
        
        // Build display text
        let displayParts = [];
        
        if (cptCodes.length > 0) {
            // Find E&M code (99xxx)
            const emCode = cptCodes.find(c => c.startsWith('99'));
            if (emCode) {
                displayParts.push(`E&M ${emCode}`);
            }
        }
        
        if (icd10Codes.length > 0) {
            // Show up to 3 ICD10 codes
            const displayCodes = icd10Codes.slice(0, 3).join(', ');
            displayParts.push(displayCodes);
        }
        
        if (displayParts.length > 0) {
            billingCodesText.textContent = `Billing codes (${displayParts.join(', ')}) recorded`;
            console.log('[BillingCodes] Set text to:', billingCodesText.textContent);
        } else {
            billingCodesText.textContent = 'Billing codes recorded';
        }
    } else {
        // Default text if no codes available
        console.log('[BillingCodes] No medical codes data found');
        billingCodesText.textContent = 'Billing codes recorded';
    }
}

/**
 * Populate follow-up recommendation from After Visit Summary data
 */
function populateFollowUpRecommendation() {
    const aiInsightText = document.getElementById('aiInsightText');
    const aiInsightFooter = document.getElementById('aiInsightFooter');
    const sectionTitle = document.getElementById('followUpSectionTitle');
    const smsSection = document.getElementById('smsNotificationSection');

    if (!aiInsightText) return;

    // Try to get follow-up info from AVS
    let followUpInfo = null;

    if (streamingSessionOutputs && streamingSessionOutputs.afterVisitSummary) {
        const avs = streamingSessionOutputs.afterVisitSummary;
        let segments = [];

        if (avs.AfterVisitSummary && avs.AfterVisitSummary.SummarizedSegments) {
            segments = avs.AfterVisitSummary.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
        } else if (avs.SummarizedSegments) {
            segments = avs.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
        }

        // Find follow-up related segment
        followUpInfo = segments.find(s =>
            s.toLowerCase().includes('follow-up') ||
            s.toLowerCase().includes('come back') ||
            s.toLowerCase().includes('schedule') ||
            s.toLowerCase().includes('appointment') ||
            s.toLowerCase().includes('return') ||
            s.toLowerCase().includes('weeks') ||
            s.toLowerCase().includes('days')
        );
    }

    if (followUpInfo) {
        // Follow-up was discussed — show full section with SMS
        if (sectionTitle) sectionTitle.textContent = 'Follow-up Recommended';
        if (smsSection) smsSection.style.display = '';

        // Extract time frame if mentioned
        const timeMatch = followUpInfo.match(/(\d+)\s*(week|day|month)s?/i);
        let timeFrame = 'a follow-up visit';

        if (timeMatch) {
            const num = timeMatch[1];
            const unit = timeMatch[2].toLowerCase();
            timeFrame = `a <span class="ai-insight-highlight">${escapeHtml(num)}-${escapeHtml(unit)} follow-up</span>`; // nosemgrep: insecure-document-method, html-in-template-string, detect-non-literal-regexp, unsafe-formatstring
        }

        // Clean up the segment text for display
        let cleanedText = followUpInfo.trim();

        if (cleanedText.length < 150) {
            aiInsightText.innerHTML = `Next steps discussed: <span class="ai-insight-highlight">${escapeHtml(cleanedText)}</span>`; // nosemgrep: html-in-template-string, insecure-innerhtml, insecure-document-method — escapeHtml on AVS text
        } else {
            aiInsightText.innerHTML = `Next steps: ${timeFrame} was discussed to monitor progress and adjust treatment as needed.`; // nosemgrep: html-in-template-string, insecure-innerhtml, insecure-document-method — timeFrame built from escapeHtml values
        }

        if (aiInsightFooter) {
            const oPhone = window.CLINIC_PHONE ? window.CLINIC_PHONE.officeNumber : '(555) 010-0100';
            aiInsightFooter.innerHTML = `The patient can call the front desk at <span class="ai-insight-highlight">${oPhone}</span> to schedule.`; // nosemgrep: html-in-template-string, insecure-innerhtml, insecure-document-method — oPhone from hardcoded config
        }
    } else {
        // No follow-up discussed — update title and hide SMS
        if (sectionTitle) sectionTitle.textContent = 'Follow-up Status';
        if (smsSection) smsSection.style.display = 'none';

        aiInsightText.innerHTML = 'No follow-up visit was discussed during this encounter.'; // nosemgrep: insecure-innerhtml, insecure-document-method — static text

        if (aiInsightFooter) {
            const oPhone = window.CLINIC_PHONE ? window.CLINIC_PHONE.officeNumber : '(555) 010-0100';
            aiInsightFooter.innerHTML = `If a follow-up is needed, the patient can call <span class="ai-insight-highlight">${oPhone}</span>.`; // nosemgrep: html-in-template-string, insecure-innerhtml, insecure-document-method — oPhone from hardcoded config
        }
    }
}

/**
 * Update follow-up footer after SMS is sent
 */
function updateFollowUpAfterSMS() {
    const aiInsightFooter = document.getElementById('aiInsightFooter');
    if (aiInsightFooter) {
        const oPhone = window.CLINIC_PHONE ? window.CLINIC_PHONE.officeNumber : '(555) 010-0100';
        aiInsightFooter.innerHTML = `A reminder has been <span class="ai-insight-highlight">sent via text</span>. The patient can also call the front desk at <span class="ai-insight-highlight">${oPhone}</span>.`; // nosemgrep: html-in-template-string, insecure-innerhtml, insecure-document-method — oPhone from hardcoded config
    }
}


/**
 * Populate Patient Visit Summary date and visit type
 */
function populatePatientSummaryMeta() {
    const dateEl = document.getElementById('patientSummaryDate');
    const visitTypeEl = document.getElementById('patientSummaryVisitType');
    
    // Set current date
    if (dateEl) {
        const today = new Date();
        const options = { year: 'numeric', month: 'long', day: '2-digit' };
        dateEl.textContent = today.toLocaleDateString('en-US', options);
    }
    
    // Try to determine visit type from AVS or clinical doc
    if (visitTypeEl) {
        let visitType = 'Follow-up Visit'; // Default
        
        // Try to extract visit type from AVS
        if (streamingSessionOutputs && streamingSessionOutputs.afterVisitSummary) {
            const avs = streamingSessionOutputs.afterVisitSummary;
            let segments = [];
            
            if (avs.AfterVisitSummary && avs.AfterVisitSummary.SummarizedSegments) {
                segments = avs.AfterVisitSummary.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
            } else if (avs.SummarizedSegments) {
                segments = avs.SummarizedSegments.map(s => s.SummarizedSegment || s.Text).filter(s => s);
            }
            
            // Look for visit type indicators in the text
            const allText = segments.join(' ').toLowerCase();
            
            if (allText.includes('annual') || allText.includes('physical') || allText.includes('wellness')) {
                visitType = 'Annual Physical';
            } else if (allText.includes('diabetes') || allText.includes('a1c') || allText.includes('blood sugar') || allText.includes('glucose')) {
                visitType = 'Diabetes Follow-up';
            } else if (allText.includes('blood pressure') || allText.includes('hypertension') || allText.includes('bp')) {
                visitType = 'Blood Pressure Check';
            } else if (allText.includes('headache') || allText.includes('migraine')) {
                visitType = 'Headache Evaluation';
            } else if (allText.includes('pain')) {
                visitType = 'Pain Management';
            } else if (allText.includes('medication') || allText.includes('refill')) {
                visitType = 'Medication Review';
            } else if (allText.includes('lab') || allText.includes('results') || allText.includes('test')) {
                visitType = 'Lab Review';
            }
        }
        
        // Also check clinical doc for visit type hints
        if (visitType === 'Follow-up Visit' && streamingSessionOutputs && streamingSessionOutputs.clinicalDoc) {
            const clinicalDoc = streamingSessionOutputs.clinicalDoc;
            let sections = [];
            
            if (clinicalDoc.ClinicalDocumentation && clinicalDoc.ClinicalDocumentation.Sections) {
                sections = clinicalDoc.ClinicalDocumentation.Sections;
            }
            
            // Look at Assessment section for diagnosis hints
            const assessmentSection = sections.find(s => 
                s.SectionName && s.SectionName.toUpperCase().includes('ASSESSMENT')
            );
            
            if (assessmentSection && assessmentSection.Summary) {
                const summaryText = assessmentSection.Summary.map(s => s.SummarizedSegment || '').join(' ').toLowerCase();
                
                if (summaryText.includes('diabetes') || summaryText.includes('a1c')) {
                    visitType = 'Diabetes Follow-up';
                } else if (summaryText.includes('hypertension') || summaryText.includes('blood pressure')) {
                    visitType = 'Blood Pressure Check';
                } else if (summaryText.includes('headache')) {
                    visitType = 'Headache Evaluation';
                }
            }
        }
        
        visitTypeEl.textContent = visitType;
    }
}
