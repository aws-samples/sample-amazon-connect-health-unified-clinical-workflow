// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import com.amazonaws.auth.DefaultAWSCredentialsProviderChain;
import com.amazonaws.client.builder.AwsClientBuilder;
import com.amazonaws.kinesisvideo.parser.ebml.InputStreamParserByteSource;
import com.amazonaws.kinesisvideo.parser.ebml.MkvTypeInfos;
import com.amazonaws.kinesisvideo.parser.mkv.Frame;
import com.amazonaws.kinesisvideo.parser.mkv.MkvDataElement;
import com.amazonaws.kinesisvideo.parser.mkv.MkvElement;
import com.amazonaws.kinesisvideo.parser.mkv.MkvValue;
import com.amazonaws.kinesisvideo.parser.mkv.StreamingMkvReader;
import com.amazonaws.kinesisvideo.parser.utilities.FragmentMetadataVisitor;
import com.amazonaws.kinesisvideo.parser.utilities.MkvTrackMetadata;
import com.amazonaws.regions.Regions;
import com.amazonaws.services.kinesisvideo.AmazonKinesisVideo;
import com.amazonaws.services.kinesisvideo.AmazonKinesisVideoClientBuilder;
import com.amazonaws.services.kinesisvideo.AmazonKinesisVideoMedia;
import com.amazonaws.services.kinesisvideo.AmazonKinesisVideoMediaClientBuilder;
import com.amazonaws.services.kinesisvideo.model.APIName;
import com.amazonaws.services.kinesisvideo.model.GetDataEndpointRequest;
import com.amazonaws.services.kinesisvideo.model.GetMediaRequest;
import com.amazonaws.services.kinesisvideo.model.GetMediaResult;
import com.amazonaws.services.kinesisvideo.model.StartSelector;
import com.amazonaws.services.kinesisvideo.model.StartSelectorType;

import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Consumes audio from a Connect-managed Kinesis Video Stream,
 * extracts AUDIO_FROM_CUSTOMER PCM frames (8kHz, 16-bit, mono),
 * upsamples to 16kHz, and pushes the resulting bytes to a callback.
 *
 * Lifecycle:
 *   - start() spawns a background thread that connects to KVS and begins consumption
 *   - The bridge stops automatically when:
 *     1. KVSContactTagProcessor detects ContactId change (call ended), OR
 *     2. The hard timeout (default 30 minutes) elapses, OR
 *     3. stop() is called externally
 *   - Errors are logged; the bridge shuts down gracefully without crashing the caller.
 *
 * Usage:
 *   KVSBridge bridge = new KVSBridge(streamArn, fragmentNumber, contactId,
 *                                     audioBytes -> myAudioConsumer.accept(audioBytes));
 *   bridge.start();
 *   // ... later ...
 *   bridge.stop();
 */
public class KVSBridge {

    private static final String TARGET_TRACK = "AUDIO_FROM_CUSTOMER";
    private static final long DEFAULT_TIMEOUT_MS = 30 * 60 * 1000L; // 30 minutes

    private final String streamArn;
    private final String startFragmentNum;
    private final String contactId;
    private final Consumer<byte[]> audioConsumer;
    private final long timeoutMs;
    private final Regions region;

    private final AtomicBoolean running = new AtomicBoolean(false);
    private CompletableFuture<Void> consumerFuture;

    public KVSBridge(String streamArn, String startFragmentNum, String contactId,
                     Consumer<byte[]> audioConsumer) {
        this(streamArn, startFragmentNum, contactId, audioConsumer, DEFAULT_TIMEOUT_MS, Regions.US_EAST_1);
    }

    public KVSBridge(String streamArn, String startFragmentNum, String contactId,
                     Consumer<byte[]> audioConsumer, long timeoutMs, Regions region) {
        this.streamArn = streamArn;
        this.startFragmentNum = startFragmentNum;
        this.contactId = contactId;
        this.audioConsumer = audioConsumer;
        this.timeoutMs = timeoutMs;
        this.region = region;
    }

    public CompletableFuture<Void> start() {
        if (!running.compareAndSet(false, true)) {
            throw new IllegalStateException("Bridge already running for " + contactId);
        }
        consumerFuture = CompletableFuture.runAsync(this::run,
                Executors.newSingleThreadExecutor(r -> {
                    Thread t = new Thread(r, "kvs-bridge-" + contactId);
                    t.setDaemon(true);
                    return t;
                }));
        return consumerFuture;
    }

    public void stop() {
        running.set(false);
    }

    public boolean isRunning() {
        return running.get();
    }

    private void run() {
        long startTime = System.currentTimeMillis();
        int audioFrameCount = 0;
        long totalAudioBytes = 0;

        try {
            String streamName = extractStreamName(streamArn);
            System.out.println("[KVSBridge:" + contactId + "] Starting. Stream=" + streamName
                    + ", fragment=" + startFragmentNum);

            // 1. Get data endpoint
            AmazonKinesisVideo kvsClient = AmazonKinesisVideoClientBuilder.standard()
                    .withRegion(region).build();
            String dataEndpoint = kvsClient.getDataEndpoint(new GetDataEndpointRequest()
                    .withAPIName(APIName.GET_MEDIA)
                    .withStreamName(streamName)).getDataEndpoint();

            // 2. Build media client
            AmazonKinesisVideoMedia mediaClient = AmazonKinesisVideoMediaClientBuilder.standard()
                    .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(
                            dataEndpoint, region.getName()))
                    .withCredentials(new DefaultAWSCredentialsProviderChain()).build();

            // 3. GetMedia starting at the fragment number
            StartSelector startSelector = new StartSelector()
                    .withStartSelectorType(StartSelectorType.FRAGMENT_NUMBER)
                    .withAfterFragmentNumber(startFragmentNum);
            GetMediaResult result = mediaClient.getMedia(new GetMediaRequest()
                    .withStreamName(streamName).withStartSelector(startSelector));

            System.out.println("[KVSBridge:" + contactId + "] GetMedia HTTP "
                    + result.getSdkHttpMetadata().getHttpStatusCode());

            InputStream payload = result.getPayload();
            StreamingMkvReader reader = StreamingMkvReader.createDefault(
                    new InputStreamParserByteSource(payload));

            KVSContactTagProcessor tagProcessor = new KVSContactTagProcessor(contactId);
            FragmentMetadataVisitor fragmentVisitor = FragmentMetadataVisitor.create(
                    Optional.of(tagProcessor));

            // 4. Main consumption loop
            while (running.get() && reader.mightHaveNext()) {
                if (tagProcessor.shouldStopProcessing()) {
                    System.out.println("[KVSBridge:" + contactId + "] Tag change detected. Stopping.");
                    break;
                }
                if ((System.currentTimeMillis() - startTime) > timeoutMs) {
                    System.out.println("[KVSBridge:" + contactId + "] Hard timeout reached. Stopping.");
                    break;
                }

                Optional<MkvElement> elementOpt = reader.nextIfAvailable();
                if (!elementOpt.isPresent()) continue;

                MkvElement element = elementOpt.get();
                element.accept(fragmentVisitor);

                if (MkvTypeInfos.SIMPLEBLOCK.equals(element.getElementMetaData().getTypeInfo())) {
                    MkvDataElement dataElement = (MkvDataElement) element;
                    @SuppressWarnings("unchecked")
                    Frame frame = ((MkvValue<Frame>) dataElement.getValueCopy()).getVal();

                    long trackNumber = frame.getTrackNumber();
                    MkvTrackMetadata metadata = fragmentVisitor.getMkvTrackMetadata(trackNumber);
                    String trackName = metadata != null ? metadata.getTrackName() : null;

                    if (TARGET_TRACK.equals(trackName) || "Track_audio/L16".equals(trackName)) {
                        ByteBuffer audioBuffer = frame.getFrameData();
                        byte[] pcm8k = new byte[audioBuffer.remaining()];
                        audioBuffer.get(pcm8k);

                        // Upsample 8kHz -> 16kHz
                        byte[] pcm16k = AudioUpsampler.upsample8kTo16k(pcm8k);

                        // Push to consumer
                        try {
                            audioConsumer.accept(pcm16k);
                        } catch (Exception e) {
                            System.err.println("[KVSBridge:" + contactId
                                    + "] audioConsumer threw: " + e.getMessage());
                            // continue; one bad frame shouldn't kill the whole bridge
                        }

                        audioFrameCount++;
                        totalAudioBytes += pcm16k.length;
                        if (audioFrameCount % 200 == 0) {
                            System.out.println("[KVSBridge:" + contactId + "] frames="
                                    + audioFrameCount + " bytes16k=" + totalAudioBytes);
                        }
                    }
                }
            }

            System.out.println("[KVSBridge:" + contactId + "] DONE. frames=" + audioFrameCount
                    + ", bytes16k=" + totalAudioBytes
                    + ", elapsed=" + (System.currentTimeMillis() - startTime) + "ms");
        } catch (Exception e) {
            System.err.println("[KVSBridge:" + contactId + "] Error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            running.set(false);
        }
    }

    private static String extractStreamName(String arn) {
        String afterStream = arn.substring(arn.indexOf("stream/") + 7);
        if (afterStream.contains("/")) {
            return afterStream.substring(0, afterStream.indexOf("/"));
        }
        return afterStream;
    }
}
