// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.connecthealth.ConnectHealthClient;
import software.amazon.awssdk.services.connecthealth.model.*;

/**
 * One-time utility to create and activate a subscription for a domain.
 * Usage: mvn compile exec:java -Dexec.mainClass="com.example.connecthealth.CreateSubscription"
 */
public class CreateSubscription {
    public static void main(String[] args) {
        String domainId = System.getenv("DOMAIN_ID") != null ? System.getenv("DOMAIN_ID") : "<YOUR_DOMAIN_ID>";
        String region = "us-east-1";

        System.out.println("Creating subscription for domain: " + domainId);

        ConnectHealthClient client = ConnectHealthClient.builder()
                .credentialsProvider(DefaultCredentialsProvider.create())
                .region(Region.of(region))
                .build();

        try {
            // Create subscription
            CreateSubscriptionResponse createResp = client.createSubscription(
                    CreateSubscriptionRequest.builder()
                            .domainId(domainId)
                            .build());

            String subId = createResp.subscriptionId();
            System.out.println("Created subscription: " + subId);
            System.out.println("Status: " + createResp.status());
            System.out.println("ARN: " + createResp.arn());

            // Activate subscription
            System.out.println("Activating subscription...");
            ActivateSubscriptionResponse activateResp = client.activateSubscription(
                    ActivateSubscriptionRequest.builder()
                            .domainId(domainId)
                            .subscriptionId(subId)
                            .build());

            System.out.println("Activated!");
            System.out.println("\nSubscription ID to use: " + subId);

        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            client.close();
        }
    }
}
