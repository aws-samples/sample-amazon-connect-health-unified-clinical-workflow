// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Reusable wrapper around the ConnectHealth StartMedicalScribeListeningSession API.
 *
 * IMPORTANT - RESPONSIBLE AI NOTICE:
 * This service generates AI-powered clinical documentation for healthcare providers.
 * All AI-generated outputs (transcripts, SOAP notes, medical codes) MUST be reviewed
 * and approved by a licensed healthcare provider before use in patient care.
 *
 * Do not use AI outputs as the sole basis for:
 * - Medical diagnoses
 * - Treatment decisions
 * - Billing/coding without verification
 * - Patient care documentation without physician review
 *
 * Implementing applications must enforce human-in-the-loop workflows and maintain
 * audit trails of all AI-generated content and subsequent human modifications.
 */
package com.example.connecthealth;

import io.reactivex.rxjava3.processors.ReplayProcessor;
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
import java.util.function.Consumer;

/**
 * Reusable wrapper around the ConnectHealth StartMedicalScribeListeningSession API.
 *
 * Both the existing WebSocketEndpoint (browser audio source) and the new
 * bridge servlet (KVS audio source) can instantiate one of these per call.
 *
 * The session:
 *   - Opens a streaming connection to ConnectHealth on start()
 *   - Accepts raw 16kHz/16-bit/mono PCM bytes via pushAudio()
 *   - Logs transcript / SOAP / medical code events as they stream back
 *     (final SOAP and codes are also written to S3 by ConnectHealth itself)
 *   - Cleans up via stop() when the call ends
 */
public class MedicalScribeSession {

    private final String sessionId;
    private final String domainId;
    private final String subscriptionId;
    private final String outputBucket;
    private final Consumer<String> eventListener;

    private ConnectHealthAsyncClient connectHealthClient;
    private ReplayProcessor<MedicalScribeInputStream> audioProcessor;
    private CompletableFuture<Void> streamingFuture;

    private final AtomicBoolean isStreaming = new AtomicBoolean(false);
    private final AtomicBoolean isStopping = new AtomicBoolean(false);

    public MedicalScribeSession(String sessionId, String domainId, String subscriptionId,
                                String outputBucket, Consumer<String> eventListener) {
        this.sessionId = sessionId == null ? UUID.randomUUID().toString() : sessionId;
        this.domainId = domainId;
        this.subscriptionId = subscriptionId;
        this.outputBucket = outputBucket;
        this.eventListener = eventListener;
    }

    public String getSessionId() {
        return sessionId;
    }

    public boolean isStreaming() {
        return isStreaming.get();
    }

    public synchronized void start() {
        if (isStreaming.get()) {
            throw new IllegalStateException("Session already started: " + sessionId);
        }

        System.out.println("[MedicalScribe:" + sessionId + "] Starting session, domain=" + domainId);

        connectHealthClient = ConnectHealthAsyncClient.builder()
                .credentialsProvider(DefaultCredentialsProvider.create())
                .region(Region.of(StreamingConfig.CONNECT_HEALTH_REGION))
                .httpClientBuilder(NettyNioAsyncHttpClient.builder()
                        .maxConcurrency(100)
                        .connectionTimeout(Duration.ofSeconds(60))
                        .readTimeout(Duration.ofMinutes(5))
                        .writeTimeout(Duration.ofSeconds(30))
                        .connectionAcquisitionTimeout(Duration.ofSeconds(30)))
                .build();

        audioProcessor = ReplayProcessor.create(10);

        StartMedicalScribeListeningSessionRequest.Builder reqBuilder =
                StartMedicalScribeListeningSessionRequest.builder()
                        .domainId(domainId)
                        .sessionId(sessionId)
                        .languageCode("en-US")
                        .mediaEncoding("pcm")
                        .mediaSampleRateHertz(16000);

        if (subscriptionId != null && !subscriptionId.isEmpty()) {
            reqBuilder.subscriptionId(subscriptionId);
        }

        StartMedicalScribeListeningSessionResponseHandler handler =
                StartMedicalScribeListeningSessionResponseHandler.builder()
                        .onResponse(response -> {
                            System.out.println("[MedicalScribe:" + sessionId + "] Session started: "
                                    + response.sessionId());
                            notifyListener("{\"type\":\"started\",\"sessionId\":\"" + sessionId + "\"}");
                        })
                        .onEventStream(publisher -> publisher.subscribe(this::handleStreamEvent))
                        .onError(error -> {
                            if (!isStopping.get() && error != null) {
                                String msg = error.getMessage();
                                if (msg != null && !msg.equals("null")
                                        && !msg.contains("Unable to execute HTTP request: null")
                                        && !msg.contains("connection was closed")) {
                                    System.err.println("[MedicalScribe:" + sessionId + "] Error: " + msg);
                                    notifyListener("{\"type\":\"error\",\"message\":\""
                                            + escapeJson(msg) + "\"}");
                                }
                            }
                        })
                        .build();

        // Configuration event with output S3 URI and SOAP template
        audioProcessor.onNext(DefaultConfigurationEvent.builder()
                .postStreamActionSettings(MedicalScribePostStreamActionSettings.builder()
                        .outputS3Uri(outputBucket + "/" + sessionId)
                        .clinicalNoteGenerationSettings(ClinicalNoteGenerationSettings.builder()
                                .noteTemplateSettings(NoteTemplateSettings.builder()
                                        .managedTemplate(ManagedTemplate.builder()
                                                .templateType("PHYSICAL_SOAP")
                                                .build())
                                        .build())
                                .build())
                        .build())
                .build());

        streamingFuture = connectHealthClient.startMedicalScribeListeningSession(
                reqBuilder.build(), audioProcessor, handler);

        isStreaming.set(true);
    }

    public void pushAudio(byte[] pcmBytes16k) {
        if (!isStreaming.get() || isStopping.get() || audioProcessor == null) return;
        try {
            audioProcessor.onNext(DefaultAudioEvent.builder()
                    .audioChunk(SdkBytes.fromByteArray(pcmBytes16k))
                    .build());
        } catch (Exception e) {
            if (!isStopping.get()) {
                System.err.println("[MedicalScribe:" + sessionId + "] pushAudio error: "
                        + e.getMessage());
            }
        }
    }

    public synchronized void stop() {
        if (!isStreaming.get() || isStopping.get()) return;
        isStopping.set(true);

        System.out.println("[MedicalScribe:" + sessionId + "] Stopping session");
        try {
            if (audioProcessor != null) {
                audioProcessor.onNext(DefaultSessionControlEvent.builder()
                        .type(MedicalScribeSessionControlEventType.END_OF_SESSION).build());
                Thread.sleep(100);
                audioProcessor.onComplete();
            }
            if (streamingFuture != null) {
                try {
                    streamingFuture.get(2, java.util.concurrent.TimeUnit.SECONDS);
                } catch (Exception ignored) {}
            }
            notifyListener("{\"type\":\"stopped\",\"sessionId\":\"" + sessionId + "\"}");
        } catch (Exception e) {
            System.err.println("[MedicalScribe:" + sessionId + "] Stop error: " + e.getMessage());
        } finally {
            isStreaming.set(false);
            if (connectHealthClient != null) {
                try { connectHealthClient.close(); } catch (Exception ignored) {}
            }
        }
    }

    /**
     * Handle streamed events from ConnectHealth - transcripts, SOAP, codes.
     * Final SOAP/codes are also written to S3 by ConnectHealth itself.
     */
    private void handleStreamEvent(MedicalScribeOutputStream event) {
        try {
            if (event instanceof MedicalScribeTranscriptEvent) {
                MedicalScribeTranscriptEvent te = (MedicalScribeTranscriptEvent) event;
                if (te.transcriptSegment() != null) {
                    var segment = te.transcriptSegment();
                    String text = segment.content();
                    boolean isFinal = segment.isPartial() != null && !segment.isPartial();
                    if (text != null && !text.isEmpty()) {
                        notifyListener("{\"type\":\"transcript\",\"sessionId\":\""
                                + sessionId + "\",\"text\":\"" + escapeJson(text)
                                + "\",\"final\":" + isFinal + "}");
                    }
                }
            }
        } catch (Exception e) {
            // ignore - don't kill the stream because of a malformed event
        }
    }

    private void notifyListener(String json) {
        if (eventListener != null) {
            try { eventListener.accept(json); } catch (Exception ignored) {}
        }
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }
}
