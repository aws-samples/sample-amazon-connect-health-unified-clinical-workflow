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

/**
 * Extracts AUDIO_FROM_CUSTOMER PCM frames from a KVS stream.
 *
 * Usage: java KVSConnectionTest <streamArn> <fragmentNumber> <contactId>
 */
public class KVSConnectionTest {

    private static final String TARGET_TRACK = "AUDIO_FROM_CUSTOMER";

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.err.println("Usage: KVSConnectionTest <streamArn> <fragmentNumber> <contactId>");
            System.exit(1);
        }

        String streamArn = args[0];
        String startFragmentNum = args[1];
        String contactId = args[2];
        Regions region = Regions.US_EAST_1;

        String streamName = streamArn.substring(streamArn.indexOf("stream/") + 7);
        if (streamName.contains("/")) {
            streamName = streamName.substring(0, streamName.indexOf("/"));
        }

        System.out.println("[Test] Stream: " + streamName);
        System.out.println("[Test] Start fragment: " + startFragmentNum);
        System.out.println("[Test] ContactId: " + contactId);
        System.out.println("[Test] Looking for track: " + TARGET_TRACK);

        AmazonKinesisVideo kvsClient = AmazonKinesisVideoClientBuilder.standard()
                .withRegion(region).build();

        String dataEndpoint = kvsClient.getDataEndpoint(new GetDataEndpointRequest()
                .withAPIName(APIName.GET_MEDIA).withStreamName(streamName)).getDataEndpoint();

        AmazonKinesisVideoMedia mediaClient = AmazonKinesisVideoMediaClientBuilder.standard()
                .withEndpointConfiguration(new AwsClientBuilder.EndpointConfiguration(dataEndpoint, region.getName()))
                .withCredentials(new DefaultAWSCredentialsProviderChain()).build();

        StartSelector startSelector = new StartSelector()
                .withStartSelectorType(StartSelectorType.FRAGMENT_NUMBER)
                .withAfterFragmentNumber(startFragmentNum);

        GetMediaResult result = mediaClient.getMedia(new GetMediaRequest()
                .withStreamName(streamName).withStartSelector(startSelector));

        System.out.println("[Test] GetMedia HTTP " + result.getSdkHttpMetadata().getHttpStatusCode());

        InputStream payload = result.getPayload();
        StreamingMkvReader reader = StreamingMkvReader.createDefault(
                new InputStreamParserByteSource(payload));

        KVSContactTagProcessor tagProcessor = new KVSContactTagProcessor(contactId);
        FragmentMetadataVisitor fragmentVisitor = FragmentMetadataVisitor.create(
                Optional.of(tagProcessor));

        long totalAudioBytes = 0;
        int audioFrameCount = 0;
        int totalElementsScanned = 0;
        long startTime = System.currentTimeMillis();
        long timeoutMs = 30_000;

        while (reader.mightHaveNext() && (System.currentTimeMillis() - startTime) < timeoutMs) {
            if (tagProcessor.shouldStopProcessing()) {
                System.out.println("[Test] Tag processor signaled stop — call ended.");
                break;
            }

            Optional<MkvElement> elementOpt = reader.nextIfAvailable();
            if (!elementOpt.isPresent()) continue;

            MkvElement element = elementOpt.get();
            element.accept(fragmentVisitor);
            totalElementsScanned++;

            if (MkvTypeInfos.SIMPLEBLOCK.equals(element.getElementMetaData().getTypeInfo())) {
                MkvDataElement dataElement = (MkvDataElement) element;
                @SuppressWarnings("unchecked")
                Frame frame = ((MkvValue<Frame>) dataElement.getValueCopy()).getVal();

                long trackNumber = frame.getTrackNumber();
                MkvTrackMetadata metadata = fragmentVisitor.getMkvTrackMetadata(trackNumber);
                String trackName = metadata != null ? metadata.getTrackName() : null;

                if (TARGET_TRACK.equals(trackName)
                        || "Track_audio/L16".equals(trackName)) {
                    ByteBuffer audioBuffer = frame.getFrameData();
                    int byteCount = audioBuffer.remaining();
                    totalAudioBytes += byteCount;
                    audioFrameCount++;

                    if (audioFrameCount % 50 == 0) {
                        System.out.println("[Test] Audio frames: " + audioFrameCount
                                + ", total audio bytes: " + totalAudioBytes);
                    }
                }
            }
        }

        System.out.println("\n========== RESULTS ==========");
        System.out.println("MKV elements scanned: " + totalElementsScanned);
        System.out.println("Audio frames extracted: " + audioFrameCount);
        System.out.println("Total audio bytes: " + totalAudioBytes);
        if (audioFrameCount > 0) {
            System.out.println("Avg bytes per frame: " + (totalAudioBytes / audioFrameCount));
            System.out.println("\nAudio extraction works. Ready for Step 4 (upsampling).");
        } else {
            System.out.println("\nNo audio frames found. Check track name filter.");
        }
    }
}
