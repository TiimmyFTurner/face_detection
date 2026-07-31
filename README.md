# 🎯 FaceTrack — Self-Hosted Real-Time Face Tracking & Logging System

A production-ready, self-hosted microservice platform for real-time face detection, recognition, and event logging across local IP camera networks (RTSP). Built with **Python (FastAPI)**, **InsightFace (ArcFace)**, **OpenCV**, and a responsive **Glassmorphism Web Dashboard**.

---

## 📋 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
  - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
  - [Option B: Local Python Environment](#option-b-local-python-environment)
- [RTSP Stream & Camera Configuration](#-rtsp-stream--camera-configuration)
  - [Common IP Camera RTSP URL Formats](#common-ip-camera-rtsp-url-formats)
  - [Testing RTSP Streams Locally](#testing-rtsp-streams-locally)
- [Configuration Reference (.env)](#-configuration-reference-env)
- [Performance & AI Optimization](#-performance--ai-optimization)
- [Dashboard Walkthrough](#-dashboard-walkthrough)
- [API Reference](#-api-reference)
- [GPU Acceleration Setup](#-gpu-acceleration-setup)
- [Running Automated Tests](#-running-automated-tests)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Project Structure](#-project-structure)
- [License](#-license)

---

## 🏗️ Overview & Architecture

FaceTrack ingests video streams from IP security cameras, extracts face bounding boxes and 512-dimensional vector embeddings, matches them against a local gallery of enrolled individuals using **Cosine Similarity**, logs detection events to a database, and broadcasts live alerts to web clients via WebSockets.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 IP Security Cameras                     │
                  │   [Camera 1]         [Camera 2]         [Camera N]      │
                  └──────┬──────────────────┬──────────────────┬────────────┘
                         │ RTSP             │ RTSP             │ RTSP
                         ▼                  ▼                  ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           FASTAPI BACKEND SERVICE                                 │
│                                                                                   │
│   ┌──────────────────────────────────────────────────────────────────────────┐    │
│   │                         Stream Processor Worker                          │    │
│   │  • Frame Skipping & Downscaling (CPU optimization)                       │    │
│   │  • Auto-reconnect with exponential backoff on stream drops               │    │
│   └──────────────────────────────────┬───────────────────────────────────────┘    │
│                                      │ Frame Data                                 │
│                                      ▼                                            │
│   ┌──────────────────────────────────────────────────────────────────────────┐    │
│   │                     InsightFace AI Engine (ArcFace)                      │    │
│   │  • SCRFD Face Detection                                                  │    │
│   │  • 512-d Vector Embedding Generator                                      │    │
│   │  • Cosine Similarity Matcher (Threshold: 0.5)                            │    │
│   └──────────────────────────────────┬───────────────────────────────────────┘    │
│                                      │ Events & Cropped Face Snapshots            │
│                 ┌────────────────────┴────────────────────┐                       │
│                 ▼                                         ▼                       │
│   ┌───────────────────────────┐             ┌───────────────────────────┐         │
│   │    SQLite / PostgreSQL    │             │   WebSocket Broadcast     │         │
│   │   (Events, Cameras, DB)   │             │       Server (/ws)        │         │
│   └───────────────────────────┘             └─────────────┬─────────────┘         │
└───────────────────────────────────────────────────────────┼───────────────────────┘
                                                            │ Real-time Alerts
                                                            ▼
                                              ┌───────────────────────────┐
                                              │    Frontend Dashboard     │
                                              │  (HTML5 / CSS / Vanilla)  │
                                              └───────────────────────────┘
```

---

## ✨ Key Features

- **Multi-Camera Processing:** Concurrently ingests and analyzes multiple RTSP camera streams in isolated asynchronous worker loops.
- **State-of-the-Art Recognition:** Leverages **InsightFace (ArcFace `buffalo_l` model)** to extract 512-d face feature vectors.
- **Robust Matching Logic:** Performs vector cosine similarity comparison against known person profiles.
- **Low Overhead & Frame Skipping:** Configurable frame skipping (e.g. 1 out of 5 frames) and downscaling to minimize CPU utilization.
- **Resilient Connection Handling:** Automatic RTSP reconnection with exponential backoff if camera streams drop.
- **Anti-Spam Cooldown:** Configurable per-person cooldown timer (e.g., 60 seconds) to prevent duplicate log spamming.
- **Real-Time Web Dashboard:** Built-in SPA interface with live metrics, WebSocket push updates, camera status testing, and person photo gallery management.
- **Hardware Acceleration:** Out-of-the-box support for CUDA / GPU acceleration via ONNX Runtime, with automatic CPU fallback.

---

## 🛠️ Prerequisites

Before setting up FaceTrack, ensure you have the following installed on your host system:

- **Docker & Docker Compose** (Recommended for containerized deployment), OR
- **Python 3.10 to 3.12**
- **Git**
- **C++ Build Tools / GCC** (Required if compiling OpenCV/InsightFace dependencies manually on native Python)
- **NVIDIA GPU Drivers & NVIDIA Container Toolkit** (Optional, for GPU acceleration)

---

## 🚀 Quick Start

### Option A: Docker Compose (Recommended)

1. **Clone the Repository & Navigate to Directory:**
   ```bash
   git clone https://github.com/your-username/face_detection.git
   cd face_detection
   ```

2. **Set Up Environment Variables:**
   ```bash
   cp .env.example .env
   ```

3. **Launch system containers:**
   ```bash
   docker-compose up --build -d
   ```

4. **Access the Dashboard:**
   Open your browser and navigate to: **`http://localhost:8000`**

5. **View Container Logs:**
   ```bash
   docker-compose logs -f app
   ```

---

### Option B: Local Python Environment

#### On Windows (PowerShell):

```powershell
# 1. Clone repository
git clone https://github.com/your-username/face_detection.git
cd face_detection

# 2. Create virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# 3. Upgrade pip and install dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt

# 4. Create local environment file
Copy-Item .env.example .env

# 5. Create storage directories
New-Item -ItemType Directory -Force -Path "data/snapshots", "data/reference_photos"

# 6. Launch FastAPI backend server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```
``` 
#in short way
cd your-path\face_detection
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000
```
#### On Linux / macOS (Bash):

```bash
# 1. Clone repository
git clone https://github.com/your-username/face_detection.git
cd face_detection

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 4. Create local environment file
cp .env.example .env

# 5. Create storage directories
mkdir -p data/snapshots data/reference_photos

# 6. Launch server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📹 RTSP Stream & Camera Configuration

### Common IP Camera RTSP URL Formats

When registering IP cameras in the Dashboard or via API (`POST /api/cameras`), use standard RTSP URLs:

| Manufacturer / Stream Type | Standard RTSP URL Pattern |
|----------------------------|---------------------------|
| **Generic RTSP** | `rtsp://<username>:<password>@<ip_address>:<port>/stream` |
| **Hikvision Main Stream** | `rtsp://admin:pass123@192.168.1.64:554/Streaming/Channels/101` |
| **Hikvision Sub Stream** (lower resolution) | `rtsp://admin:pass123@192.168.1.64:554/Streaming/Channels/102` |
| **Dahua / Lorex** | `rtsp://admin:pass123@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0` |
| **Reolink** | `rtsp://admin:pass123@192.168.1.50:554/h264Preview_01_main` |
| **Axis** | `rtsp://root:pass123@192.168.1.90/axis-media/media.amp` |
| **TP-Link Tapo** | `rtsp://admin:pass123@192.168.1.120:554/stream1` |

### Testing RTSP Streams Locally

If you don't have a live physical IP camera, you can test using:
1. **Webcam RTSP Bridge:** Use VLC or `ffmpeg` to broadcast your local webcam as an RTSP stream:
   ```bash
   ffmpeg -f dshow -i video="Integrated Camera" -rtsp_transport tcp -f rtsp rtsp://localhost:8554/live
   ```
2. **Video File Loop via ffmpeg:**
   ```bash
   ffmpeg -re -stream_loop -1 -i test_video.mp4 -c copy -f rtsp rtsp://localhost:8554/mystream
   ```
3. **Built-in Connection Tester:** Use the **"⚡ Test Connection"** button inside the Camera Management page on the dashboard to test responsiveness and capture a thumbnail prior to saving.

---

## ⚙️ Configuration Reference (.env)

Configuration is managed via environment variables defined in `.env`:

```env
# ── Database Configuration ────────────────────────────────
DATABASE_URL=sqlite+aiosqlite:///./data/face_tracking.db

# ── Face Recognition & AI Settings ──────────────────────
MATCH_THRESHOLD=0.5
INSIGHTFACE_MODEL=buffalo_l

# ── Performance Tuning ────────────────────────────────────
FRAME_SKIP=5
DOWNSCALE_FACTOR=0.5
COOLDOWN_SECONDS=60
MAX_RECONNECT_BACKOFF=30

# ── Local File Paths ──────────────────────────────────────
SNAPSHOT_DIR=./data/snapshots
REFERENCE_PHOTO_DIR=./data/reference_photos

# ── HTTP Server Settings ─────────────────────────────────
HOST=0.0.0.0
PORT=8000
```

### Parameter Details

- `MATCH_THRESHOLD` (float, default: `0.5`): Cosine similarity score threshold (0.0 to 1.0) required to consider a face a "Match". Higher values (e.g. `0.6`) require stricter similarity, reducing false positives.
- `FRAME_SKIP` (int, default: `5`): Process 1 out of every `N` frames. At 30 FPS, `FRAME_SKIP=5` runs AI inference ~6 times per second per stream, cutting CPU load by 80%.
- `DOWNSCALE_FACTOR` (float, default: `0.5`): Scale factor applied to frames before inference. `0.5` scales a 1080p frame down to 540p for fast detection, while snapshots are cropped from the original full-resolution frame.
- `COOLDOWN_SECONDS` (int, default: `60`): Cooldown window in seconds before logging the exact same person again on the same camera.
- `INSIGHTFACE_MODEL` (string, default: `buffalo_l`): Model pack name (`buffalo_l` offers peak accuracy; `buffalo_s` or `buffalo_sc` are lightweight options).

---

## 💻 Dashboard Walkthrough

Access the web dashboard by opening `http://localhost:8000` in your web browser.

### 1. Live Event Stream (`/#dashboard`)
- **Real-Time WebSocket Feed:** Displays incoming events in real time.
- **Event Cards:** Shows captured snapshot image, recognized person's name (or "Unknown" badge), camera location, timestamp, and visual confidence bar.
- **Filter Tabs:** Toggle between **All Events**, **Known**, or **Unknown**.
- **Summary Metrics:** Dynamic counters tracking Total Events, Known Faces, Unknown Faces, and Active Cameras.

### 2. Identity Management (`/#persons`)
- **Enroll Persons:** Click **"＋ Add Person"**, enter full name and role, and upload 1 or more clear reference photos.
- **Multi-Photo Enrolment:** Uploading multiple photos per person (different lighting/angles) enhances detection accuracy.
- **Photo Gallery:** View registered identities and add supplemental reference photos at any time.

### 3. Camera Management (`/#cameras`)
- **Add / Edit Cameras:** Register new cameras with RTSP credentials, custom location tags, and active state switches.
- **Stream Diagnostics:** Click **"⚡ Test"** on any camera to verify RTSP stream connectivity and generate a live snapshot thumbnail.

---

## 📡 API Reference

Interactive OpenAPI / Swagger documentation is available at: **`http://localhost:8000/docs`**

### Key REST Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | Service health status and AI engine readiness |
| `GET` | `/api/cameras` | List all configured cameras |
| `POST` | `/api/cameras` | Register a new camera stream |
| `GET` | `/api/cameras/{id}` | Retrieve camera configuration details |
| `PUT` | `/api/cameras/{id}` | Update camera URL, name, or active status |
| `DELETE` | `/api/cameras/{id}` | Remove camera configuration and terminate stream worker |
| `POST` | `/api/cameras/{id}/test` | Test live camera RTSP stream |
| `GET` | `/api/persons` | List all registered known individuals |
| `POST` | `/api/persons` | Enroll a person with reference photo upload (`multipart/form-data`) |
| `DELETE` | `/api/persons/{id}` | Remove registered individual and associated embeddings |
| `POST` | `/api/persons/{id}/photos` | Upload additional reference photos for an individual |
| `GET` | `/api/events` | Query detection event logs with pagination and filters (`camera_id`, `is_known`, `person_name`, `start_time`, `end_time`) |
| `GET` | `/api/events/stats` | Retrieve daily event metrics summary |
| `GET` | `/api/snapshots/{filename}` | Serve cropped snapshot images |
| `WS` | `/ws/events` | Real-time WebSocket connection for pushed event alerts |

---

## ⚡ GPU Acceleration Setup

To enable NVIDIA GPU inference using ONNX Runtime CUDA Execution Provider:

### 1. Host Requirements
- NVIDIA GPU with CUDA support
- Installed NVIDIA Drivers (v535+)
- Installed [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) (if using Docker)

### 2. Enable in Docker Compose
Uncomment the GPU reservations block in `docker-compose.yml`:

```yaml
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### 3. Native Python Setup
Install `onnxruntime-gpu`:
```bash
pip uninstall -y onnxruntime
pip install onnxruntime-gpu
```

Upon startup, `FaceEngine` automatically attempts to register `CUDAExecutionProvider` and falls back to `CPUExecutionProvider` if GPU initialization fails.

---

## 🧪 Running Automated Tests

Run the test suite using `pytest`:

```bash
# Run all tests verbosely
python -m pytest tests/ -v

# Run API integration tests only
python -m pytest tests/test_api.py -v

# Run AI matching unit tests only
python -m pytest tests/test_face_engine.py -v
```

---

## ❓ Troubleshooting & FAQ

### Q1: FaceEngine fails to initialize or model download times out
- **Solution:** InsightFace downloads model weights (`buffalo_l.zip`) automatically on first launch to `~/.insightface/models/`. If auto-download fails due to network restriction, download `buffalo_l.zip` manually from [InsightFace Releases](https://github.com/deepinsight/insightface/releases) and extract it to:
  - Linux/Mac: `~/.insightface/models/buffalo_l/`
  - Windows: `C:\Users\<Username>\.insightface\models\buffalo_l\`

### Q2: RTSP stream drops or fails to connect
- **Check URL Format:** Verify credentials, IP address, port, and stream channel URL in VLC player (`Media -> Open Network Stream`).
- **Network Access:** Ensure the host running FaceTrack has network access to the camera's subnet.
- **Sub-stream usage:** Use the camera's secondary/sub-stream RTSP URL (e.g. 640x480 or 720p) for lower network bandwidth consumption.

### Q3: High CPU usage
- **Increase Frame Skipping:** Set `FRAME_SKIP=10` in `.env` to process every 10th frame.
- **Lower Resolution:** Set `DOWNSCALE_FACTOR=0.4` or `0.3`.
- **Model Choice:** Switch model from `buffalo_l` to `buffalo_s` in `.env`.

---

## 📂 Project Structure

```
face_detection/
├── docker-compose.yml        # Docker service orchestration
├── Dockerfile                # Multi-stage CUDA-ready build
├── requirements.txt          # Python dependencies
├── .env.example              # Environment variables template
├── .gitignore                # Git ignore rules
├── README.md                 # Project documentation
│
├── backend/                  # FastAPI Application Core
│   ├── __init__.py
│   ├── main.py               # Application entry point & lifespan
│   ├── config.py             # Pydantic environment configuration
│   ├── database.py           # Async SQLAlchemy database initialization
│   ├── models.py             # Database ORM models (Camera, Person, Event, Embedding)
│   ├── schemas.py            # Pydantic validation schemas
│   ├── face_engine.py        # InsightFace detector & vector matcher
│   ├── stream_processor.py   # Async RTSP ingestion & WebSocket manager
│   └── routers/
│       ├── __init__.py
│       ├── cameras.py        # Camera API endpoints
│       ├── persons.py        # Person management API endpoints
│       ├── events.py         # Event logs API endpoints
│       └── snapshots.py      # Image serving endpoint
│
├── frontend/                 # Dashboard Frontend App
│   ├── index.html            # Main HTML layout shell
│   ├── css/
│   │   └── style.css         # Glassmorphism dark-theme styling
│   └── js/
│       ├── app.js            # App core, router & WebSocket client
│       ├── components/
│       │   ├── cameraForm.js # Camera modal component
│       │   ├── eventCard.js  # Live event card component
│       │   └── personForm.js # Person upload modal component
│       └── pages/
│           ├── cameras.js    # Camera management page view
│           ├── dashboard.js  # Live monitoring dashboard view
│           └── persons.js    # Identity enrollment page view
│
├── data/                     # Persistent Data Directory (Excluded from git)
│   ├── snapshots/            # Event cropped snapshot JPEGs
│   └── reference_photos/     # Enrolled person photos
│
└── tests/                    # Test Suite
    ├── __init__.py
    ├── test_api.py           # API integration test suite
    └── test_face_engine.py   # AI face matcher unit tests
```

---

## 📜 License

This project is open-source and released under the **MIT License**. Free for personal, commercial, and enterprise usage.
