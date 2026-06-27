# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
# Build stage - using ECR Public to avoid Docker Hub rate limits
# nosemgrep: dockerfile-source-not-pinned
FROM public.ecr.aws/docker/library/maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app

# Copy pom.xml first for dependency caching
COPY pom.xml .
RUN mvn dependency:go-offline -q

# Copy source code and build
COPY src ./src
RUN mvn package -q

# Runtime stage
# nosemgrep: dockerfile-source-not-pinned
FROM public.ecr.aws/docker/library/eclipse-temurin:17-jre-alpine

WORKDIR /app

# Copy the fat JAR from builder
COPY --from=builder /app/target/connect-health-streaming-service-1.0-SNAPSHOT.jar app.jar

# Expose WebSocket port
EXPOSE 8081

# Run as non-root user
RUN adduser -D appuser
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8081/ || exit 1

# Run the application
# nosemgrep: prefer-json-notation — already using JSON array notation
ENTRYPOINT ["java", "-jar", "app.jar"]
