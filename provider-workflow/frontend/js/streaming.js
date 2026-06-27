// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Streaming Client
 * 
 * Handles WebSocket connection to ConnectHealth streaming service,
 * microphone capture, and real-time transcription.
 */

const ConnectHealthStreaming = (function() {
    'use strict';
    
    // Configuration
    const WS_URL = window.WS_URL || 'wss://localhost:8081/stream';
    const SAMPLE_RATE = 16000;
    
    // State
    let ws = null;
    let mediaStream = null;
    let audioContext = null;
    let processor = null;
    let isStreaming = false;
    let isPaused = false;
    let sessionId = null;
    
    // Callbacks
    let onTranscriptCallback = null;
    let onStatusChangeCallback = null;
    let onErrorCallback = null;
    
    /**
     * Start streaming session
     * @param {Object} options - Configuration options
     * @param {Function} options.onTranscript - Called with transcript updates
     * @param {Function} options.onStatusChange - Called with status changes
     * @param {Function} options.onError - Called on errors
     * @returns {Promise<string>} Session ID
     */
    async function start(options = {}) {
        if (isStreaming) {
            console.warn('[Streaming] Already streaming');
            return sessionId;
        }
        
        onTranscriptCallback = options.onTranscript || (() => {});
        onStatusChangeCallback = options.onStatusChange || (() => {});
        onErrorCallback = options.onError || console.error;
        
        try {
            updateStatus('connecting');
            
            // Request microphone access
            console.log('[Streaming] Requesting microphone access...');
            mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            console.log('[Streaming] Microphone access granted');
            
            // Connect WebSocket
            await connectWebSocket();
            
            // Generate session ID
            sessionId = crypto.randomUUID();
            
            // Send start command
            ws.send(JSON.stringify({ type: 'start', sessionId }));
            console.log('[Streaming] Sent start command:', sessionId);
            
            return sessionId;
            
        } catch (error) {
            console.error('[Streaming] Failed to start:', error);
            cleanup();
            onErrorCallback(error);
            throw error;
        }
    }
    
    /**
     * Stop streaming session
     */
    function stop() {
        if (!isStreaming) {
            return;
        }
        
        console.log('[Streaming] Stopping session:', sessionId);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'stop' }));
            // Don't cleanup immediately - wait for 'stopped' response or timeout
            setTimeout(() => {
                if (isStreaming) {
                    console.log('[Streaming] Cleanup timeout - forcing cleanup');
                    cleanup();
                    updateStatus('stopped');
                }
            }, 5000); // 5 second timeout
        } else {
            cleanup();
            updateStatus('stopped');
        }
    }
    
    /**
     * Check if currently streaming
     */
    function isActive() {
        return isStreaming;
    }
    
    /**
     * Get current session ID
     */
    function getSessionId() {
        return sessionId;
    }
    
    // Private functions
    
    function connectWebSocket() {
        return new Promise((resolve, reject) => {
            console.log('[Streaming] Connecting to:', WS_URL);
            ws = new WebSocket(WS_URL);
            
            ws.onopen = () => {
                console.log('[Streaming] WebSocket connected');
                resolve();
            };
            
            ws.onmessage = (event) => {
                handleMessage(JSON.parse(event.data));
            };
            
            ws.onerror = (error) => {
                console.error('[Streaming] WebSocket error:', error);
                reject(new Error('WebSocket connection failed'));
            };
            
            ws.onclose = () => {
                console.log('[Streaming] WebSocket closed');
                if (isStreaming) {
                    cleanup();
                    updateStatus('disconnected');
                }
            };
        });
    }
    
    function handleMessage(data) {
        console.log('[Streaming] Received:', data.type);
        
        switch (data.type) {
            case 'started':
                isStreaming = true;
                startAudioProcessing();
                updateStatus('streaming');
                break;
                
            case 'transcript':
                if (onTranscriptCallback) {
                    onTranscriptCallback({
                        text: data.text,
                        isFinal: data.final,
                        sessionId: data.sessionId
                    });
                }
                break;
                
            case 'stopped':
                cleanup();
                updateStatus('stopped');
                break;
                
            case 'error':
                // Ignore cleanup errors when session is ending
                if (data.error && !data.error.includes('Unable to execute HTTP request: null')) {
                    console.error('[Streaming] Server error:', data.error);
                    if (onErrorCallback) {
                        onErrorCallback(new Error(data.error));
                    }
                }
                break;
        }
    }
    
    function startAudioProcessing() {
        try {
            audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
            const source = audioContext.createMediaStreamSource(mediaStream);
            
            // Use ScriptProcessorNode for audio processing
            // Buffer size of 4096 gives ~256ms chunks at 16kHz
            processor = audioContext.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
                if (!isStreaming || isPaused || !ws || ws.readyState !== WebSocket.OPEN) {
                    return;
                }
                
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Convert float32 to int16 PCM
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Send as binary
                ws.send(pcmData.buffer);
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            console.log('[Streaming] Audio processing started');
            
        } catch (error) {
            console.error('[Streaming] Failed to start audio processing:', error);
            onErrorCallback(error);
        }
    }
    
    function cleanup() {
        isStreaming = false;
        
        if (processor) {
            processor.disconnect();
            processor = null;
        }
        
        if (audioContext) {
            audioContext.close().catch(() => {});
            audioContext = null;
        }
        
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        
        if (ws) {
            ws.close();
            ws = null;
        }
    }
    
    function updateStatus(status) {
        console.log('[Streaming] Status:', status);
        if (onStatusChangeCallback) {
            onStatusChangeCallback(status);
        }
    }
    
    // Public API
    return {
        start,
        stop,
        pause: function() { isPaused = true; },
        resume: function() { isPaused = false; },
        isActive,
        getSessionId
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConnectHealthStreaming;
}
