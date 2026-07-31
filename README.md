# 🎯 FaceTrack — Real-Time Face Detection & Logging System

A self-hosted, real-time face detection and recognition platform for local IP cameras.
Built with FastAPI (Python) + InsightFace (ArcFace) + a modern web dashboard.

![Python](https://img.shields.io/badge/Python-3.10+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-green)
![InsightFace](https://img.shields.io/badge/InsightFace-ArcFace-purple)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Features

- **Multi-Camera RTSP Streaming** — Connect to unlimited IP cameras simultaneously
- **AI Face Detection** — InsightFace (ArcFace) with 512-d embedding extraction
- **Real-Time Recognition** — Cosine similarity matching with configurable threshold
- **Live Dashboard** — WebSocket-powered event stream with glassmorphism UI
- **Identity Management** — Enroll known persons with multi-photo uploads
- **Camera Management** — Add, edit, test, and remove cameras from the UI
- **Automatic Reconnection** — Exponential backoff on RTSP stream drops
- **GPU Acceleration** — CUDA support with CPU fallback
- **Docker Ready** — Single `docker-compose up` deployment

## 🚀 Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and configure
cp .env.example .env

# Start the system
docker-compose up --build

# Open dashboard
open http://localhost:8000
```

### Option 2: Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Copy environment config
cp .env.example .env

# Start the server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## 📁 Project Structure

```
face_detection/
├── backend/
│   ├── main.py              # FastAPI app entry point
│   ├── config.py             # Environment configuration
│   ├── database.py           # Async SQLAlchemy setup
│   ├── models.py             # ORM models (Camera, Person, Event)
│   ├── schemas.py            # Pydantic request/response schemas
│   ├── face_engine.py        # InsightFace AI engine wrapper
│   ├── stream_processor.py   # RTSP stream ingestion worker
│   └── routers/
│       ├── cameras.py        # Camera CRUD API
│       ├── persons.py        # Person enrollment API
│       ├── events.py         # Event log API
│       └── snapshots.py      # Snapshot image server
├── frontend/
│   ├── index.html            # Dashboard shell
│   ├── css/style.css         # Design system
│   └── js/                   # SPA router, pages, components
├── data/
│   ├── snapshots/            # Cropped face images
│   └── reference_photos/     # Enrolled person photos
├── tests/
│   ├── test_api.py           # API integration tests
│   └── test_face_engine.py   # Face matching unit tests
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── .env.example
```

## 🔧 Configuration

All settings are configured via environment variables (`.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `MATCH_THRESHOLD` | `0.5` | Cosine similarity threshold for face matching |
| `FRAME_SKIP` | `5` | Process every Nth frame |
| `DOWNSCALE_FACTOR` | `0.5` | Frame downscale ratio for detection |
| `COOLDOWN_SECONDS` | `60` | Min seconds between re-logging same person |
| `INSIGHTFACE_MODEL` | `buffalo_l` | InsightFace model pack name |

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/cameras` | List all cameras |
| POST | `/api/cameras` | Add a new camera |
| PUT | `/api/cameras/{id}` | Update camera config |
| DELETE | `/api/cameras/{id}` | Remove camera |
| POST | `/api/cameras/{id}/test` | Test RTSP connection |
| GET | `/api/persons` | List known persons |
| POST | `/api/persons` | Create person + upload photos |
| DELETE | `/api/persons/{id}` | Delete person |
| GET | `/api/events` | List events (with filters) |
| GET | `/api/events/stats` | Dashboard statistics |
| GET | `/api/snapshots/{file}` | Serve snapshot image |
| WS | `/ws/events` | Real-time event stream |

## 🧪 Testing

```bash
python -m pytest tests/ -v
```

## 🖥️ GPU Setup

For NVIDIA GPU acceleration:

1. Install [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)
2. Uncomment the `deploy` section in `docker-compose.yml`
3. Install `onnxruntime-gpu` instead of `onnxruntime`

## 📄 License

MIT License — free for personal and commercial use.
