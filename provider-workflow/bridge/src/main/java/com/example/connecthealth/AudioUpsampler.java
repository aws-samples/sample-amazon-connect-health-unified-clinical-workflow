// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Upsamples 8kHz 16-bit PCM (little-endian, mono) to 16kHz 16-bit PCM
 * using linear interpolation.
 *
 * Connect emits 8kHz/16-bit PCM. ConnectHealth streaming requires 16kHz/16-bit PCM.
 * Each input sample produces 2 output samples (midpoint + current).
 */
public class AudioUpsampler {

    public static byte[] upsample8kTo16k(byte[] input8k) {
        if (input8k.length == 0) return new byte[0];
        if (input8k.length % 2 != 0) {
            throw new IllegalArgumentException(
                "Input length must be even (16-bit PCM samples). Got: " + input8k.length);
        }

        int sampleCount = input8k.length / 2;
        byte[] output = new byte[input8k.length * 2];

        ByteBuffer in = ByteBuffer.wrap(input8k).order(ByteOrder.LITTLE_ENDIAN);
        ByteBuffer out = ByteBuffer.wrap(output).order(ByteOrder.LITTLE_ENDIAN);

        short prev = in.getShort();
        // First output: duplicate the first sample (no real previous to interpolate from)
        out.putShort(prev);
        out.putShort(prev);

        for (int i = 1; i < sampleCount; i++) {
            short curr = in.getShort();
            short mid = (short) ((prev + curr) / 2);
            out.putShort(mid);
            out.putShort(curr);
            prev = curr;
        }

        return output;
    }

    public static byte[] upsample8kTo16k(ByteBuffer input8k) {
        byte[] bytes = new byte[input8k.remaining()];
        input8k.get(bytes);
        return upsample8kTo16k(bytes);
    }
}
