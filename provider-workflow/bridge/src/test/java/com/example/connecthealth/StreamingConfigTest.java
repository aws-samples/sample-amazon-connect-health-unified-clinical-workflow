// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StreamingConfigTest {

    @Test
    void defaultPortIs8081() {
        assertEquals(8081, StreamingConfig.PORT);
    }

    @Test
    void defaultRegionIsUsEast1() {
        assertEquals("us-east-1", StreamingConfig.CONNECT_HEALTH_REGION);
    }

    @Test
    void domainIdDefaultIsEmpty() {
        // Domain ID should be empty by default — must be provided via env var
        assertTrue(StreamingConfig.DOMAIN_ID.isEmpty(),
            "DOMAIN_ID should default to empty string");
    }

    @Test
    void subscriptionIdDefaultIsEmpty() {
        assertTrue(StreamingConfig.SUBSCRIPTION_ID.isEmpty(),
            "SUBSCRIPTION_ID should default to empty string");
    }
}
