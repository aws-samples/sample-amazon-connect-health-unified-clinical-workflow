// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

/**
 * HTTP endpoint to start a KVS-to-MedicalScribe bridge for a Connect call.
 *
 * Triggered by a Lambda invoked from the Contact Flow after Start Media Streaming.
 *
 * POST /bridge/start
 * Body: {
 *   "contactId":      "0204e2c2-...",
 *   "streamArn":      "arn:aws:kinesisvideo:...",
 *   "fragmentNumber": "91343852333181...",
 *   "domainId":       "dom-r7hxvtclpmb13...",
 *   "patientId":      "0725e4075c0a604..."   (optional, for logging)
 * }
 *
 * Response: {"status":"started","sessionId":"<contactId>"}
 *
 * GET /bridge/active  -> list of currently running bridges
 */
public class BridgeServlet extends HttpServlet {

    private static final Gson GSON = new Gson();

    /** contactId -> active session/bridge pair so we can stop them later */
    static final Map<String, ActiveBridge> ACTIVE = new ConcurrentHashMap<>();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setStatus(HttpServletResponse.SC_OK);
        resp.setContentType("application/json");
        StringBuilder sb = new StringBuilder("{\"active\":[");
        boolean first = true;
        for (Map.Entry<String, ActiveBridge> e : ACTIVE.entrySet()) {
            if (!first) sb.append(",");
            sb.append("\"").append(e.getKey()).append("\"");
            first = false;
        }
        sb.append("]}");
        resp.getWriter().write(sb.toString());
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        resp.setContentType("application/json");
        try {
            StringBuilder body = new StringBuilder();
            try (BufferedReader r = req.getReader()) {
                String line;
                while ((line = r.readLine()) != null) body.append(line);
            }
            JsonObject json = GSON.fromJson(body.toString(), JsonObject.class);

            String contactId = required(json, "contactId");
            String streamArn = required(json, "streamArn");
            String fragmentNumber = required(json, "fragmentNumber");
            String domainId = json.has("domainId") && !json.get("domainId").isJsonNull()
                    ? json.get("domainId").getAsString() : StreamingConfig.DOMAIN_ID;
            String patientId = json.has("patientId") && !json.get("patientId").isJsonNull()
                    ? json.get("patientId").getAsString() : "(none)";

            if (ACTIVE.containsKey(contactId)) {
                resp.setStatus(HttpServletResponse.SC_CONFLICT);
                resp.getWriter().write("{\"error\":\"bridge already running\",\"contactId\":\""
                        + contactId + "\"}");
                return;
            }

            System.out.println("[BridgeServlet] Starting bridge for contact=" + contactId
                    + ", patient=" + patientId);

            // 1. Build the MedicalScribe session (sessionId == contactId for traceability)
            MedicalScribeSession session = new MedicalScribeSession(
                    contactId,
                    domainId,
                    StreamingConfig.SUBSCRIPTION_ID,
                    StreamingConfig.OUTPUT_BUCKET,
                    msg -> System.out.println("[Session:" + contactId + "] " + msg));

            session.start();

            // 2. Build the KVS bridge that pumps audio into the session
            KVSBridge bridge = new KVSBridge(
                    streamArn,
                    fragmentNumber,
                    contactId,
                    session::pushAudio); // each chunk: 8kHz->16kHz already done inside the bridge

            ActiveBridge active = new ActiveBridge(session, bridge);
            ACTIVE.put(contactId, active);

            // 3. Start the bridge consumer; auto-clean ACTIVE when it finishes
            bridge.start().whenComplete((v, t) -> {
                System.out.println("[BridgeServlet] Bridge thread done for " + contactId
                        + (t != null ? ", error: " + t.getMessage() : ""));
                try { session.stop(); } catch (Exception ignored) {}
                ACTIVE.remove(contactId);
            });

            resp.setStatus(HttpServletResponse.SC_ACCEPTED);
            resp.getWriter().write("{\"status\":\"started\",\"sessionId\":\""
                    + contactId + "\"}");
        } catch (IllegalArgumentException iae) {
            resp.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            resp.getWriter().write("{\"error\":\"" + iae.getMessage() + "\"}");
        } catch (Exception e) {
            System.err.println("[BridgeServlet] Internal error: " + e.getMessage());
            e.printStackTrace();
            resp.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            resp.getWriter().write("{\"error\":\"" + e.getMessage() + "\"}");
        }
    }

    private static String required(JsonObject json, String key) {
        if (!json.has(key) || json.get(key).isJsonNull()) {
            throw new IllegalArgumentException("Missing required field: " + key);
        }
        return json.get(key).getAsString();
    }

    /** Tracks an active bridge so we can stop it later. */
    static class ActiveBridge {
        final MedicalScribeSession session;
        final KVSBridge bridge;

        ActiveBridge(MedicalScribeSession session, KVSBridge bridge) {
            this.session = session;
            this.bridge = bridge;
        }
    }
}
