# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
FROM public.ecr.aws/docker/library/python:3.11-slim

WORKDIR /app

# Install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/server.py .
COPY backend/config.py .
COPY backend/auth.py .
COPY backend/demo_mode.py .
COPY backend/live_transcript.py .
COPY backend/demo_cache/ ./demo_cache/

# Copy frontend (served by Flask as static files from ../frontend)
COPY frontend/ /frontend/

# Copy Care Intelligence (Act 2) — served from /care-intelligence/
COPY care-intelligence/ /care-intelligence/

# Expose port
EXPOSE 5000

# Make all files readable, then run as non-root user
RUN chmod -R a+r /app/ /frontend/
RUN adduser --disabled-password --gecos '' appuser
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/health')" || exit 1

# Run the server
CMD ["python", "server.py"]
