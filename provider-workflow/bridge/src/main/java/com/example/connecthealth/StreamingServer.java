// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
package com.example.connecthealth;

import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.servlet.ServletContextHandler;
import org.eclipse.jetty.servlet.ServletHolder;
import org.eclipse.jetty.websocket.server.config.JettyWebSocketServletContainerInitializer;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * WebSocket + HTTP server for ConnectHealth streaming transcription.
 *
 * Endpoints:
 *   GET  /              - health check
 *   GET  /health        - health check
 *   GET  /bridge/active - list active KVS bridges
 *   POST /bridge/start  - start a KVS-to-MedicalScribe bridge for a Connect call
 *   WS   /stream        - browser WebSocket audio source (existing behavior)
 */
public class StreamingServer {

    private static final int PORT = StreamingConfig.PORT;

    public static void main(String[] args) throws Exception {
        Server server = new Server(PORT);

        ServletContextHandler context = new ServletContextHandler(ServletContextHandler.SESSIONS);
        context.setContextPath("/");
        server.setHandler(context);

        // Health endpoints
        context.addServlet(new ServletHolder(new HealthServlet()), "/");
        context.addServlet(new ServletHolder(new HealthServlet()), "/health");

        // KVS bridge endpoint (NEW)
        context.addServlet(new ServletHolder(new BridgeServlet()), "/bridge/start");
        context.addServlet(new ServletHolder(new BridgeServlet()), "/bridge/active");

        // WebSocket endpoint
        JettyWebSocketServletContainerInitializer.configure(context, (servletContext, wsContainer) -> {
            wsContainer.setMaxTextMessageSize(65535);
            wsContainer.setMaxBinaryMessageSize(1024 * 1024);
            wsContainer.addMapping("/stream", WebSocketEndpoint.class);
        });

        System.out.println("==============================================================");
        System.out.println("       ConnectHealth Streaming Server                          ");
        System.out.println("==============================================================");
        System.out.println("  WebSocket: ws://localhost:" + PORT + "/stream");
        System.out.println("  Health:    http://localhost:" + PORT + "/");
        System.out.println("  Bridge:    POST http://localhost:" + PORT + "/bridge/start");
        System.out.println("  Active:    GET  http://localhost:" + PORT + "/bridge/active");
        System.out.println("==============================================================");

        server.start();
        server.join();
    }

    static class HealthServlet extends HttpServlet {
        @Override
        protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
            resp.setStatus(HttpServletResponse.SC_OK);
            resp.setContentType("application/json");
            resp.getWriter().write("{\"status\":\"healthy\"}");
        }
    }
}
