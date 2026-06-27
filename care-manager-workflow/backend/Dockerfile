# Care Manager backend — Flask proxy to Bedrock Agent.
# Multi-stage build: small final image (~150MB).

FROM python:3.11-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.11-slim

# Non-root user for least privilege
RUN groupadd --system app && useradd --system --gid app --create-home app

# Copy Python deps from builder layer
COPY --from=builder /root/.local /home/app/.local
ENV PATH=/home/app/.local/bin:$PATH

WORKDIR /app
COPY --chown=app:app server.py /app/server.py

USER app

# ECS sets these; defaults here match the env-var contract in server.py
ENV AWS_REGION=us-east-1 \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=5001 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request, sys; \
        sys.exit(0 if urllib.request.urlopen('http://localhost:5001/healthz', timeout=3).status == 200 else 1)"

# 2 gunicorn workers — Bedrock InvokeAgent is I/O-bound (streaming)
CMD ["gunicorn", "--bind", "0.0.0.0:5001", \
     "--workers", "2", "--threads", "8", \
     "--timeout", "120", \
     "--access-logfile", "-", "--error-logfile", "-", \
     "server:app"]
