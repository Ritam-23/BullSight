# syntax=docker/dockerfile:1
# ---- BullSight API (FastAPI) ----
FROM python:3.13-slim AS base

# Faster, quieter Python in containers.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System libs: libgomp1 is required by scikit-learn/scipy (OpenMP) at runtime.
# curl is used by the container HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

# App code (data/ is excluded via .dockerignore — it's a runtime volume).
COPY . .

# Run as a non-root user, and pre-create the data dir it writes to (SQLite, avatars,
# cached listings, session secret) so a mounted volume can be chowned to it.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/data \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# The bundled main.py binds 127.0.0.1; in a container we must bind 0.0.0.0.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1
