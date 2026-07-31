# ── Stage 1: Base image with CUDA support ─────────────────
# Use NVIDIA CUDA base for GPU acceleration; falls back to CPU if no GPU
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Symlink python
RUN ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

# ── Stage 2: Install Python dependencies ─────────────────
COPY requirements.txt .

# Try onnxruntime-gpu first, fall back to onnxruntime (CPU)
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir onnxruntime-gpu 2>/dev/null || true

# ── Stage 3: Copy application code ───────────────────────
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create data directories
RUN mkdir -p /app/data/snapshots /app/data/reference_photos

# ── Runtime ───────────────────────────────────────────────
EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
