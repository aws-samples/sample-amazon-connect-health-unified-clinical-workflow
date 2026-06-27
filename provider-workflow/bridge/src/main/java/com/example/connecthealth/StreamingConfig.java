// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

/**
 * Streaming service configuration.
 * All configurable values live here. Override via environment variables for deployment.
 */
public final class StreamingConfig {

    private StreamingConfig() {} // utility class

    // =========================================================================
    // Streaming API (ConnectHealth GA)
    // =========================================================================
    public static final String STREAMING_ENDPOINT = env(
        "STREAMING_ENDPOINT", "https://streaming.health-agent.us-east-1.api.aws");
    public static final String CONNECT_HEALTH_REGION = env(
        "CONNECT_HEALTH_REGION", "us-east-1");

    // =========================================================================
    // S3 Output
    // =========================================================================
    public static final String OUTPUT_BUCKET = env(
        "OUTPUT_BUCKET", "");  // e.g., s3://my-bucket

    // =========================================================================
    // Domain & Subscription (consolidated streaming + medical coding)
    // =========================================================================
    public static final String DOMAIN_ID = env(
        "DOMAIN_ID", "");  // e.g., dom-abc123def456
    public static final String SUBSCRIPTION_ID = env(
        "SUBSCRIPTION_ID", "");  // e.g., sub-xyz789

    // =========================================================================
    // Server
    // =========================================================================
    public static final int PORT = Integer.parseInt(env("PORT", "8081"));

    // =========================================================================
    // Helper
    // =========================================================================
    private static String env(String key, String defaultValue) {
        return System.getenv().getOrDefault(key, defaultValue);
    }
}
