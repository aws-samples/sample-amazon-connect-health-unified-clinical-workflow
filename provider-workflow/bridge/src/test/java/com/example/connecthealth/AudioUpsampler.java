// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Upsamples 8kHz 16-bit PCM (little-endian, mono) to 16kHz 16-bit PCM
 * using linear interpolation.
 *
 * Each input sample produces 2 output samples:
 *   1. The midpoint between the previous sample and the current sample
 *   2. The current sample itself
 *
 * For the very first sample (no previous), the midpoint uses the current sample
 * (effectively duplicating it).
 */
public class AudioUpsampler {

    /**
     * Upsample 8kHz PCM bytes to 16kHz PCM bytes.
     * Output buffer is exactly 2x the input length.
     */
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

    /**
     * Convenience overload for ByteBuffer input.
     * Reads remaining bytes from the buffer.
     */
    public static byte[] upsample8kTo16k(ByteBuffer input8k) {
        byte[] bytes = new byte[input8k.remaining()];
        input8k.get(bytes);
        return upsample8kTo16k(bytes);
    }

    /**
     * Quick sanity-check main method.
     * Generates a 1-second 8kHz sine wave (440Hz tone) and upsamples it.
     */
    public static void main(String[] args) {
        // 8000 samples * 2 bytes = 16000 bytes for 1 second of 8kHz audio
        byte[] sineWave8k = new byte[8000 * 2];
        ByteBuffer buf = ByteBuffer.wrap(sineWave8k).order(ByteOrder.LITTLE_ENDIAN);
        for (int i = 0; i < 8000; i++) {
            short sample = (short) (Math.sin(2 * Math.PI * 440 * i / 8000.0) * 16000);
            buf.putShort(sample);
        }

        byte[] sineWave16k = upsample8kTo16k(sineWave8k);

        System.out.println("Input: " + sineWave8k.length + " bytes (8kHz, 1 second)");
        System.out.println("Output: " + sineWave16k.length + " bytes (16kHz, 1 second)");
        System.out.println("Ratio: " + (sineWave16k.length / sineWave8k.length) + "x (expected: 2x)");
        System.out.println("Output sample count: " + (sineWave16k.length / 2) + " (expected: 16000)");

        if (sineWave16k.length == sineWave8k.length * 2) {
            System.out.println("\nAudioUpsampler works correctly.");
        } else {
            System.out.println("\nERROR: output size is wrong.");
        }
    }
}
