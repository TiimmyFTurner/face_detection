# 🎯 FaceTrack — Self-Hosted Real-Time Face Tracking & Zone Monitoring System
### سامانه بومی و مستقل تشخیص چهره، پایش منطقه‌ای و حضور پرسنل در شیفت

A production-ready, self-hosted platform for real-time face detection, recognition, spatial zone monitoring, staff shift tracking, and event logging across local IP camera networks (RTSP). Built with **Python (FastAPI)**, **InsightFace (ArcFace)**, **OpenCV**, and a modern **Glassmorphism Web Dashboard** with full **Dual-Language Localization (Persian `fa` default & English `en`)**, **RTL Layout**, and **Solar Hijri (Jalali) Calendar** support.

---

## 📋 Table of Contents / فهرست مطالب

- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
- [Localization & Persian Support (بومی‌سازی و زبان فارسی)](#-localization--persian-support)
- [Zone Monitoring & Shift Schedules](#-zone-monitoring--shift-schedules)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
  - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
  - [Option B: Local Python Environment](#option-b-local-python-environment)
- [RTSP Stream & Camera Configuration](#-rtsp-stream--camera-configuration)
  - [Common IP Camera RTSP URL Formats](#common-ip-camera-rtsp-url-formats)
  - [Testing RTSP Streams Locally](#testing-rtsp-streams-locally)
- [Configuration Reference (.env)](#-configuration-reference-env)
- [Dashboard Walkthrough](#-dashboard-walkthrough)
- [API Reference](#-api-reference)
- [GPU Acceleration Setup](#-gpu-acceleration-setup)
- [Running Automated Tests](#-running-automated-tests)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Project Structure](#-project-structure)
- [License](#-license)

---

## 🏗️ Overview & Architecture

FaceTrack ingests video streams from IP security cameras, extracts face bounding boxes and 512-dimensional vector embeddings, matches them against a local gallery of enrolled individuals using **Cosine Similarity**, checks designated spatial regions (zones) against active shift timetables, logs detection events and security alerts to a database, and broadcasts live notifications to web clients via WebSockets.

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
│   │  • Zone Spatial Containment Check & Timetable Validator                  │    │
│   │  • Absence & Unauthorized Entry Watchdog Loops                           │    │
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
│                                      │ Events, Zone Alerts & Cropped Snapshots    │
│                 ┌────────────────────┴────────────────────┐                       │
│                 ▼                                         ▼                       │
│   ┌───────────────────────────┐             ┌───────────────────────────┐         │
│   │    SQLite / PostgreSQL    │             │   WebSocket Broadcast     │         │
│   │  (Events, Zones, Cameras) │             │       Server (/ws)        │         │
│   └───────────────────────────┘             └─────────────┬─────────────┘         │
└───────────────────────────────────────────────────────────┼───────────────────────┘
                                                            │ Real-time Alerts
                                                            ▼
                                              ┌───────────────────────────┐
                                              │    Frontend Dashboard     │
                                              │  (HTML5 / CSS / Vanilla)  │
                                              │  • Persian / English UI   │
                                              │  • RTL & Jalali Timestamps│
                                              │  • Live Presence Board    │
                                              └───────────────────────────┘
```

---

## ✨ Key Features

- **Multi-Camera Processing:** Concurrently ingests and analyzes multiple RTSP camera streams in isolated asynchronous worker loops.
- **State-of-the-Art Recognition:** Leverages **InsightFace (ArcFace `buffalo_l` model)** to extract 512-d face feature vectors.
- **Spatial Zone Monitoring:** Draw designated areas directly on camera snapshots and attach staff members.
- **Shift Timetable Schedules:** Define active monitoring hours and active weekdays with automated absence timeout detection.
- **Security & Absence Alerts:** Real-time audio alerts and toast notifications for missing staff, unauthorized entries, and out-of-zone events.
- **Full Dual-Language Localization:** Persian (`fa`) as default with full RTL layout, Vazirmatn typography, Solar Hijri (Jalali) timestamps, and instant English (`en`) switching.
- **Low Overhead & Frame Skipping:** Configurable frame skipping and downscaling to minimize CPU utilization.
- **Resilient Connection Handling:** Automatic RTSP reconnection with exponential backoff if camera streams drop.
- **Anti-Spam Cooldown:** Configurable per-person cooldown timer to prevent duplicate log spamming.
- **Hardware Acceleration:** Out-of-the-box support for CUDA / GPU acceleration via ONNX Runtime, with automatic CPU fallback.

---

## 🌐 Localization & Persian Support (بومی‌سازی و زبان فارسی)

FaceTrack features a built-in internationalization engine (`frontend/js/i18n.js`):

- **Default Language:** Persian (`fa`) with full Right-to-Left (`dir="rtl"`) layout.
- **Typography:** Persian text rendered with Google Font **Vazirmatn** for optimal readability.
- **Solar Hijri (Jalali) Calendar:** Timestamps and event logs formatted natively using `Intl.DateTimeFormat('fa-IR-u-ca-persian')`.
- **Persian Digits & LTR Formats:** Numbers and counts converted to Persian numerals, while RTSP URLs and code fields remain clean LTR.
- **Instant Language Switcher:** Switch between فارسی and English at any time via the sidebar toggle; preferences are persisted across browser sessions.

---

## 🎯 Zone Monitoring & Shift Schedules

Manage critical work areas, counters, and security perimeters:

1. **Visual Area Drawer:** Open any camera and drag rectangular bounding boxes directly over the live snapshot.
2. **Staff Assignment:** Link enrolled identities to specific workstations.
3. **Shift Hours & Active Days:** Set start/end times (e.g. `08:00 - 17:00`) and active working days (Saturday to Friday / Monday to Sunday).
4. **Custom Alert Policies:**
   - 🔔 **Absence Watchdog:** Triggers an alert if assigned staff is missing during active shift hours for more than 60 seconds.
   - 🚨 **Unauthorized Entry:** Alerts if unregistered or unauthorized persons step into restricted areas.
   - ⚠️ **Combined Policy:** Full security surveillance (Absence + Unauthorized entry).
5. **Live Presence Board:** Color-coded status cards:
   - 🟢 **حاضر در محل (On Station):** Staff detected in designated zone.
   - 🔴 **غایب / عدم حضور (Absent / Missing):** Staff not detected during active shift.
   - ⚪ **خارج از شیفت (Off Duty):** Outside configured shift schedule.

---

## 🛠️ Prerequisites

- **Docker & Docker Compose** (Recommended for containerized deployment), OR
- **Python 3.10 to 3.14**
- **Git**
- **C++ Build Tools / GCC** (Required if compiling OpenCV/InsightFace dependencies manually on native Python)
- **NVIDIA GPU Drivers & NVIDIA Container Toolkit** (Optional, for GPU acceleration)

---

## 🚀 Quick Start

### Option A: Docker Compose (Recommended)

1. **Clone Repository:**
   ```bash
   git clone https://github.com/your-username/face_detection.git
   cd face_detection
   ```

2. **Set Up Environment Variables:**
   ```bash
   cp .env.example .env
   ```

3. **Launch Containers:**
   ```bash
   docker-compose up --build -d
   ```

4. **Access Dashboard:**
   Open your browser at: **`http://localhost:8000`**

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

1. **Webcam RTSP Bridge:** Use `ffmpeg` to broadcast your local webcam:
   ```bash
   ffmpeg -f dshow -i video="Integrated Camera" -rtsp_transport tcp -f rtsp rtsp://localhost:8554/live
   ```
2. **Video File Loop via ffmpeg:**
   ```bash
   ffmpeg -re -stream_loop -1 -i test_video.mp4 -c copy -f rtsp rtsp://localhost:8554/mystream
   ```
3. **Built-in Connection Tester:** Click **"⚡ تست اتصال / Test Connection"** in the Camera Management modal to verify responsiveness before saving.

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

---

## 💻 Dashboard Walkthrough

Access the web dashboard by opening `http://localhost:8000` in your web browser.

### 1. Live Dashboard (`/#dashboard` / پیشخوان رویدادها)
- **Real-Time Stream:** Live activity stream and grouped-by-person views.
- **Event Cards:** Cropped face snapshot, recognized name, camera source, area, match percentage bar, and Solar Hijri timestamp.
- **Filter Tabs:** Toggle between All Events, Known, or Unknown faces.
- **Dynamic Stats:** Live counters tracking Total Events Today, Known Faces, Unknown Faces, and Active Cameras.

### 2. Zone Monitoring & Shift Schedules (`/#zones` / پایش منطقه‌ها و شیفت‌ها)
- **Live Presence Board:** Instant overview of all active zones and staff station presence status.
- **Zone Assignments & Shifts:** Overview of cameras and designated areas with quick management access.
- **Security & Absence Logs:** Filterable table of past absence timeouts, unauthorized entries, and out-of-zone violations.

### 3. Camera Management (`/#cameras` / مدیریت دوربین‌ها)
- **Add / Edit Cameras:** Register new cameras with RTSP credentials and custom location tags.
- **Live Stream Viewer:** View low-latency MJPEG live streams or high-res snapshots directly in a modal.
- **Quick Zones Launcher:** Open the interactive visual drawer directly from any camera card.

### 4. Identity Management (`/#persons` / مدیریت هویت‌ها و پرسنل)
- **Enroll Identities:** Upload reference face photos (single or multiple angles/lighting).
- **Photo Gallery:** Manage enrolled individuals and add supplemental training photos.

---

## 📡 API Reference

Interactive OpenAPI / Swagger documentation is available at: **`http://localhost:8000/docs`**

### REST Endpoints Summary

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | Service health status and AI engine readiness |
| `GET` | `/api/cameras` | List all configured cameras |
| `POST` | `/api/cameras` | Register a new camera stream |
| `GET` | `/api/cameras/{id}` | Retrieve camera configuration details |
| `PUT` | `/api/cameras/{id}` | Update camera URL, name, location, or active status |
| `DELETE` | `/api/cameras/{id}` | Remove camera configuration and terminate stream worker |
| `POST` | `/api/cameras/{id}/test` | Test live camera RTSP connection |
| `GET` | `/api/cameras/{id}/stream` | MJPEG live video stream |
| `GET` | `/api/cameras/{id}/snapshot` | Current JPEG snapshot from live stream |
| `GET` | `/api/cameras/{id}/zones` | List spatial zones for a camera |
| `POST` | `/api/cameras/{id}/zones` | Create a new spatial zone with schedule & staff links |
| `GET` | `/api/zones` | List all spatial zones across cameras |
| `DELETE` | `/api/zones/{id}` | Delete a spatial zone |
| `GET` | `/api/zones/status` | Live presence status for all zones & attached staff |
| `GET` | `/api/zones/logs` | Security and absence violation log records |
| `GET` | `/api/persons` | List all registered known individuals |
| `POST` | `/api/persons` | Enroll a person with reference photo upload |
| `DELETE` | `/api/persons/{id}` | Remove registered individual and associated embeddings |
| `POST` | `/api/persons/{id}/photos` | Upload additional reference photos for an individual |
| `GET` | `/api/events` | Query detection event logs with pagination and filters |
| `GET` | `/api/events/stats` | Retrieve daily event metrics summary |
| `GET` | `/api/events/grouped` | Retrieve detection events grouped by person identity |
| `GET` | `/api/snapshots/{filename}` | Serve cropped snapshot images |
| `WS` | `/ws/events` | Real-time WebSocket connection for event alerts & zone notifications |

---

## ⚡ GPU Acceleration Setup

To enable NVIDIA GPU inference using ONNX Runtime CUDA Execution Provider:

### 1. Host Requirements
- NVIDIA GPU with CUDA support (Compute Capability 6.0+)
- Installed NVIDIA Drivers (v535+)
- Installed [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) (for Docker)

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
```bash
pip uninstall -y onnxruntime
pip install onnxruntime-gpu
```

---

## 🧪 Running Automated Tests

Run the test suite using `pytest`:

```bash
# Run all tests
python -m pytest tests/ -v

# Run API integration tests only
python -m pytest tests/test_api.py -v

# Run AI matching unit tests only
python -m pytest tests/test_face_engine.py -v
```

---

## ❓ Troubleshooting & FAQ

### Q1: FaceEngine fails to initialize or model download times out
- **Solution:** InsightFace downloads model weights (`buffalo_l.zip`) automatically on first launch to `~/.insightface/models/`. If auto-download fails due to network restrictions, download `buffalo_l.zip` manually from [InsightFace Releases](https://github.com/deepinsight/insightface/releases) and extract it to:
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
├── Dockerfile                # Multi-stage build
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
│   ├── models.py             # Database ORM models (Camera, Person, Event, CameraZone, ZoneViolationLog)
│   ├── schemas.py            # Pydantic validation schemas
│   ├── face_engine.py        # InsightFace detector & vector matcher
│   ├── stream_processor.py   # Async RTSP ingestion, zone watchdog & WebSocket manager
│   └── routers/
│       ├── __init__.py
│       ├── cameras.py        # Camera API & live stream endpoints
│       ├── zones.py          # Spatial zone management & live status
│       ├── persons.py        # Person & photo enrollment endpoints
│       ├── events.py         # Event logs & metrics endpoints
│       └── snapshots.py      # Image serving endpoint
│
├── frontend/                 # Dashboard Frontend App
│   ├── index.html            # Main HTML layout shell (RTL & Persian default)
│   ├── css/
│   │   └── style.css         # Glassmorphism dark-theme & RTL typography
│   └── js/
│       ├── app.js            # App core, router & WebSocket client
│       ├── i18n.js           # Internationalization engine, dictionaries & Jalali formatter
│       ├── components/
│       │   ├── cameraForm.js # Camera modal component
│       │   ├── eventCard.js  # Live event card & detail modal
│       │   ├── personForm.js # Person upload & photo dropzone modal
│       │   └── zoneModal.js  # Interactive canvas zone drawer & shift modal
│       └── pages/
│           ├── cameras.js    # Camera management page view
│           ├── dashboard.js  # Live monitoring dashboard view
│           ├── persons.js    # Identity enrollment page view
│           └── zonesPage.js  # Live Presence Board, shifts & security logs view
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
