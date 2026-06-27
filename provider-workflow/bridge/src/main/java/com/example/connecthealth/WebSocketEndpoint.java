// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import io.reactivex.rxjava3.processors.ReplayProcessor;
import org.eclipse.jetty.websocket.api.Session;
import org.eclipse.jetty.websocket.api.WebSocketAdapter;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.core.SdkBytes;
import software.amazon.awssdk.http.nio.netty.NettyNioAsyncHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.connecthealth.ConnectHealthAsyncClient;
import software.amazon.awssdk.services.connecthealth.model.*;
import software.amazon.awssdk.services.connecthealth.model.medicalscribeinputstream.*;

import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * WebSocket endpoint that bridges browser audio to ConnectHealth streaming API.
 */
public class WebSocketEndpoint extends WebSocketAdapter {
    
    // Configuration — see StreamingConfig.java
    private static final String STREAMING_ENDPOINT = StreamingConfig.STREAMING_ENDPOINT;
    private static final String CONNECT_HEALTH_REGION = StreamingConfig.CONNECT_HEALTH_REGION;
    private static final String OUTPUT_BUCKET = StreamingConfig.OUTPUT_BUCKET;
    
    // Domain and Subscription IDs for consolidated streaming + medical coding API
    private static final String DOMAIN_ID = StreamingConfig.DOMAIN_ID;
    private static final String SUBSCRIPTION_ID = StreamingConfig.SUBSCRIPTION_ID;
    
    private final Gson gson = new Gson();
    private ConnectHealthAsyncClient connectHealthClient;
    private ReplayProcessor<MedicalScribeInputStream> audioProcessor;
    private CompletableFuture<Void> streamingFuture;
    private String sessionId;
    private final AtomicBoolean isStreaming = new AtomicBoolean(false);
    private final AtomicBoolean isStopping = new AtomicBoolean(false);
    
    @Override
    public void onWebSocketConnect(Session session) {
        super.onWebSocketConnect(session);
        System.out.println("[WS] Client connected: " + session.getRemoteAddress());
    }
    
    @Override
    public void onWebSocketText(String message) {
        try {
            JsonObject json = gson.fromJson(message, JsonObject.class);
            String type = json.get("type").getAsString();
            
            switch (type) {
                case "start":
                    handleStart(json);
                    break;
                case "stop":
                    handleStop();
                    break;
                default:
                    sendError("Unknown message type: " + type);
            }
        } catch (Exception e) {
            System.err.println("[WS] Error processing message: " + e.getMessage());
            sendError(e.getMessage());
        }
    }
    
    @Override
    public void onWebSocketBinary(byte[] payload, int offset, int len) {
        if (!isStreaming.get() || audioProcessor == null || isStopping.get()) {
            return;
        }
        
        try {
            // Extract audio bytes
            byte[] audioData = new byte[len];
            System.arraycopy(payload, offset, audioData, 0, len);
            
            // Send to ConnectHealth
            audioProcessor.onNext(DefaultAudioEvent.builder()
                .audioChunk(SdkBytes.fromByteArray(audioData))
                .build());
                
        } catch (Exception e) {
            // Only log if not stopping
            if (!isStopping.get()) {
                System.err.println("[WS] Error processing audio: " + e.getMessage());
            }
        }
    }
    
    @Override
    public void onWebSocketClose(int statusCode, String reason) {
        System.out.println("[WS] Client disconnected: " + statusCode + " - " + reason);
        cleanup();
    }
    
    @Override
    public void onWebSocketError(Throwable cause) {
        System.err.println("[WS] WebSocket error: " + cause.getMessage());
        cleanup();
    }
    
    private void handleStart(JsonObject json) {
        if (isStreaming.get()) {
            sendError("Already streaming");
            return;
        }
        
        sessionId = json.has("sessionId") ? 
            json.get("sessionId").getAsString() : UUID.randomUUID().toString();
        
        System.out.println("[WS] Starting ConnectHealth session: " + sessionId);
        
        try {
            // Create ConnectHealth client with longer timeouts
            // Let the SDK resolve endpoints automatically (handles host prefix injection for streaming/runtime)
            connectHealthClient = ConnectHealthAsyncClient.builder()
                .credentialsProvider(DefaultCredentialsProvider.create())
                .region(Region.of(CONNECT_HEALTH_REGION))
                .httpClientBuilder(NettyNioAsyncHttpClient.builder()
                    .maxConcurrency(100)
                    .connectionTimeout(Duration.ofSeconds(60))
                    .readTimeout(Duration.ofMinutes(5))
                    .writeTimeout(Duration.ofSeconds(30))
                    .connectionAcquisitionTimeout(Duration.ofSeconds(30)))
                .build();
            
            // Create audio processor with buffer
            audioProcessor = ReplayProcessor.create(10);
            
            // Build request with domainId for GA API
            var requestBuilder = StartMedicalScribeListeningSessionRequest.builder()
                    .domainId(DOMAIN_ID)
                    .sessionId(sessionId)
                    .languageCode("en-US")
                    .mediaEncoding("pcm")
                    .mediaSampleRateHertz(16000);
            
            // Only set subscriptionId if configured (not needed for all endpoints)
            if (SUBSCRIPTION_ID != null && !SUBSCRIPTION_ID.isEmpty()) {
                requestBuilder.subscriptionId(SUBSCRIPTION_ID);
            }
            
            StartMedicalScribeListeningSessionRequest request = requestBuilder.build();
            
            // Response handler
            StartMedicalScribeListeningSessionResponseHandler handler = 
                StartMedicalScribeListeningSessionResponseHandler.builder()
                    .onResponse(response -> {
                        System.out.println("[ConnectHealth] Session started: " + response.sessionId());
                        sendMessage("started", sessionId, null, false);
                    })
                    .onEventStream(publisher -> {
                        publisher.subscribe(event -> handleStreamEvent(event));
                    })
                    .onError(error -> {
                        // Only report errors if not in stopping state and error is meaningful
                        if (!isStopping.get() && error != null) {
                            String errorMsg = error.getMessage();
                            // Filter out expected errors during shutdown
                            if (errorMsg != null && 
                                !errorMsg.equals("null") && 
                                !errorMsg.contains("Unable to execute HTTP request: null") &&
                                !errorMsg.contains("connection was closed")) {
                                System.err.println("[ConnectHealth] Error: " + errorMsg);
                                sendError(errorMsg);
                            } else if (errorMsg != null && !errorMsg.equals("null")) {
                                // Log but don't send to client - expected during cleanup
                                System.out.println("[ConnectHealth] Connection closed (expected during stop)");
                            }
                        }
                    })
                    .build();
            
            // Send configuration event with output S3 URI and note template settings
            audioProcessor.onNext(DefaultConfigurationEvent.builder()
                .postStreamActionSettings(
                    MedicalScribePostStreamActionSettings.builder()
                        .outputS3Uri(OUTPUT_BUCKET + "/" + sessionId)
                        .clinicalNoteGenerationSettings(
                            ClinicalNoteGenerationSettings.builder()
                                .noteTemplateSettings(
                                    NoteTemplateSettings.builder()
                                        .managedTemplate(
                                            ManagedTemplate.builder()
                                                .templateType("PHYSICAL_SOAP")
                                                .build())
                                        .build())
                                .build())
                        .build())
                .build());
            
            // Start streaming
            streamingFuture = connectHealthClient.startMedicalScribeListeningSession(
                request, audioProcessor, handler);
            
            isStreaming.set(true);
            
        } catch (Exception e) {
            System.err.println("[WS] Failed to start ConnectHealth session: " + e.getMessage());
            sendError("Failed to start: " + e.getMessage());
            cleanup();
        }
    }
    
    private void handleStop() {
        if (!isStreaming.get() || isStopping.get()) {
            return;
        }
        
        // Set stopping flag to suppress expected errors
        isStopping.set(true);
        
        System.out.println("[WS] Stopping ConnectHealth session: " + sessionId);
        
        try {
            // Send end of session
            if (audioProcessor != null) {
                audioProcessor.onNext(DefaultSessionControlEvent.builder()
                    .type(MedicalScribeSessionControlEventType.END_OF_SESSION)
                    .build());
                
                // Give it a moment to send the end event
                Thread.sleep(100);
                
                audioProcessor.onComplete();
            }
            
            // Wait briefly for the stream to complete gracefully
            if (streamingFuture != null) {
                try {
                    streamingFuture.get(java.util.concurrent.TimeUnit.SECONDS.toMillis(2), 
                        java.util.concurrent.TimeUnit.MILLISECONDS);
                } catch (Exception e) {
                    // Expected - stream may already be closed
                }
            }
            
            sendMessage("stopped", sessionId, null, false);
            
        } catch (Exception e) {
            System.err.println("[WS] Error stopping session: " + e.getMessage());
        } finally {
            cleanup();
        }
    }
    
    private void handleStreamEvent(MedicalScribeOutputStream event) {
        if (event instanceof MedicalScribeTranscriptEvent) {
            MedicalScribeTranscriptEvent te = (MedicalScribeTranscriptEvent) event;
            if (te.transcriptSegment() != null) {
                var segment = te.transcriptSegment();
                String text = segment.content();
                boolean isFinal = segment.isPartial() != null && !segment.isPartial();
                
                if (text != null && !text.isEmpty()) {
                    sendMessage("transcript", sessionId, text, isFinal);
                }
            }
        }
    }
    
    private void sendMessage(String type, String sessionId, String text, boolean isFinal) {
        if (!isConnected()) return;
        
        try {
            JsonObject response = new JsonObject();
            response.addProperty("type", type);
            if (sessionId != null) response.addProperty("sessionId", sessionId);
            if (text != null) response.addProperty("text", text);
            response.addProperty("final", isFinal);
            
            getRemote().sendString(gson.toJson(response));
        } catch (Exception e) {
            System.err.println("[WS] Failed to send message: " + e.getMessage());
        }
    }
    
    private void sendError(String error) {
        if (!isConnected() || isStopping.get()) return;
        
        try {
            JsonObject response = new JsonObject();
            response.addProperty("type", "error");
            response.addProperty("error", error);
            
            getRemote().sendString(gson.toJson(response));
        } catch (Exception e) {
            System.err.println("[WS] Failed to send error: " + e.getMessage());
        }
    }
    
    private void cleanup() {
        isStreaming.set(false);
        
        if (connectHealthClient != null) {
            try {
                connectHealthClient.close();
            } catch (Exception e) {
                // Ignore cleanup errors
            }
            connectHealthClient = null;
        }
        
        audioProcessor = null;
        streamingFuture = null;
        
        // Reset stopping flag after cleanup
        isStopping.set(false);
    }
}
