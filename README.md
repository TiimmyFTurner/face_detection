# 🎯 FaceTrack — Self-Hosted Real-Time Face Tracking & Zone Monitoring System
### سامانه بومی و مستقل تشخیص چهره، پایش منطقه‌ای و حضور پرسنل در شیفت

A production-ready, self-hosted platform for real-time face detection, recognition, spatial zone monitoring, staff shift tracking, and event logging across local IP camera networks (RTSP). Built with **Python (FastAPI)**, **InsightFace (ArcFace)**, **OpenCV**, and a modern **Glassmorphism Web Dashboard** with full **Dual-Language Localization (Persian `fa` default & English `en`)**, **RTL Layout**, and **Solar Hijri (Jalali) Calendar** support.

---

## 📋 Table of Contents / فهرست مطالب

- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
- [Localization & Persian Support (بومی‌سازی و زبان فارسی)](#-localization--persian-support)
- [Live Duty & Shift Roster Monitoring (پایش زنده پرسنل در شیفت)](#-live-duty--shift-roster-monitoring)
- [Zone Monitoring & Security Schedules](#-zone-monitoring--security-schedules)
- [Identity & Comprehensive Person Analytics](#-identity--comprehensive-person-analytics)
- [System Settings & Performance Optimization (تنظیمات سیستم و بهینه‌سازی بار)](#-system-settings--performance-optimization)
- [InsightFace Models & Embedding Re-indexing (مدل‌های هوش مصنوعی و بازسازی بردارها)](#-insightface-models--embedding-re-indexing)
- [Automated Storage Retention & Cleanup (مدیریت فضای دیسک و پاکسازی خودکار)](#-automated-storage-retention--cleanup)
- [User Management & Access Control (کاربران و دسترسی‌ها)](#-user-management--access-control)
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
│   │  • Real-Time Absence & Unauthorized Entry Watchdog Loops                 │    │
│   │  • Absence Time Windows (Intervals) & Incident Count Tracking            │    │
│   │  • Camera Offline State Isolation (Never Counted as Absence)             │    │
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
                                              │  • Live Duty Roster Board │
                                              │  • Person Analytics Modal │
                                              └───────────────────────────┘
```

---

## ✨ Key Features

- **Multi-Camera Processing:** Concurrently ingests and analyzes multiple RTSP camera streams in isolated asynchronous worker loops.
- **State-of-the-Art Recognition:** Leverages **InsightFace (ArcFace `buffalo_l` or lightweight `buffalo_s`)** to extract 512-d face feature vectors.
- **Dynamic Runtime Settings & Performance Tuning:** Live adjustment of downscaling (25%–100%), frame skipping (1–10), station zone ROI cropping, preview FPS, and retention policies directly from the web UI (`⚙️`) with instant `.env` persistence.
- **Cross-Model Embedding Re-indexing:** Built-in CLI script (`python -m scripts.reindex_embeddings`) and REST endpoint (`POST /api/persons/reindex-embeddings`) to automatically recompute stored vector representations when switching AI models.
- **Automated Storage Retention & Cleanup:** Background hourly worker automatically purges expired snapshot images and database event logs according to configured retention policies, with live disk usage breakdown.
- **Live Duty & Shift Attendance Tracking:** Real-time roster of personnel currently on duty with live station presence, current absence duration, and compliance percentages.
- **Absence Time Windows & Incident Counts:**
  - Tracks detailed absence intervals (e.g. `10:30 - 11:15 (45m)`) categorized into *late arrival*, *intermediate gaps*, and *current missing status*.
  - Counts total absence incidents during the shift (`X بار غیبت در این شیفت`) and displays a roster-wide KPI.
  - Interactive expandable time windows drawer in both Grid and List views with auto-refresh state preservation.
- **Camera Offline Safeguard:** Decouples camera disconnects from absence times; offline camera periods are displayed with a distinct yellow status (`دوربین قطع است`) and are strictly excluded from absence durations and counts.
- **Clean Camera Deletion Cascades:** Removing a camera automatically cleans up associated zones and alerts, unlinks camera IDs on historical detection logs, and clears in-memory state to prevent phantom alerts.
- **Spatial Zone Monitoring:** Draw designated areas directly on camera snapshots and attach staff members.
- **Shift Timetable Schedules:** Define active monitoring hours and active weekdays with automated absence timeout detection.
- **Identity & Comprehensive Person Analytics:** Deep audit modal with 6 specialized tabs (Overview, Shifts, 24-Hour Timeline, 14-Day Attendance Log, Cameras, and Recent Sightings).
- **User Management & RBAC:** Secure JWT authentication, password hashing, and role-based permissions (`admin`, `operator`, `viewer`).
- **Direct Unknown Face Enrollment & Multi-Photo Picker:** Tap "Enroll Person" directly from any unidentified detection event to register the individual immediately. The enrollment dialog pre-loads the event snapshot as primary photo and provides an interactive **Unknown Logs Photo Picker** to select multiple detection angles/sightings from recent sequences or all cameras, automatically updating past detection logs to known status.
- **Full Dual-Language Localization:** Persian (`fa`) as default with full RTL layout, Vazirmatn typography, Solar Hijri (Jalali) timestamps, and instant English (`en`) switching.
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

## ⏱️ Live Duty & Shift Roster Monitoring (پایش زنده پرسنل در شیفت)

FaceTrack provides a dedicated real-time shift operations command center (`/#duty`):

1. **Roster Status Cards & Visual Indication:**
   - 🟢 **حاضر در محل (On Station):** Staff actively detected in their designated camera zone within the last 60 seconds.
   - 🔴 **غایب از منطقه (Absent from Zone):** Staff absent during scheduled working hours, displaying active elapsed absence in minutes.
   - 🟡 **دوربین قطع است (Camera Disconnected):** Camera signal lost or offline; clearly separated so staff are not unfairly penalized.
   - ⚪ **خارج از شیفت (Off Duty):** Outside active timetable hours.

2. **Absence Time Windows (بازه‌های زمانی عدم حضور):**
   - Automatically detects and categorizes non-contiguous absence intervals:
     - **تاخیر در ورود (Late Arrival):** Delay between shift start time and first confirmed sighting.
     - **خروج از منطقه (Detection Gap):** Periods during the shift exceeding 3 minutes where the person was absent from the station.
     - **غیبت جاری (Current Missing):** Trailing absence from the last confirmed sighting up to `هم‌اکنون` (Now).
   - Interactive toggle drawer (`🕒 مشاهده بازه‌ها`) shows exact start time $\rightarrow$ end time and duration badge (`۳۵m`).
   - Drawer toggle state is preserved across background 10-second auto-refresh cycles.

3. **Shift Absence Incident Count (تعداد دفعات خروج):**
   - Tracks how many times an individual vacated their post during the current shift (`X بار غیبت در این شیفت`).
   - Roster-wide KPI card summarizes total shift absence incidents across the facility.

4. **Camera Disconnected Safeguard:**
   - Camera downtime duration is **never** added to absence durations or absence counts (`زمان قطعی جزو غیبت محاسبه نمی‌شود`).

5. **Grid & List Views:** Instant switching between high-density cards and compact table rows with persisted preferences.

---

## 🎯 Zone Monitoring & Security Schedules

Manage critical work areas, counters, and security perimeters (`/#zones`):

1. **Visual Area Drawer:** Drag rectangular polygons directly over high-res camera snapshots.
2. **Staff Assignment:** Link enrolled identities to specific workstations.
3. **Shift Hours & Active Days:** Set start/end times (e.g. `08:00 - 17:00`) and active working days (Saturday to Friday / Monday to Sunday).
4. **Custom Alert Policies:**
   - 🔔 **Absence Watchdog:** Triggers audio alerts and toast notifications if assigned staff is missing during active shift hours.
   - 🚨 **Unauthorized Entry:** Alerts if unregistered or unauthorized persons step into restricted areas.
   - ⚠️ **Combined Policy:** Full security surveillance (Absence + Unauthorized entry).

---

## 📊 Identity & Comprehensive Person Analytics

Click on any person card to launch the **Person Analytics Modal** (`PersonAnalyticsModal`), providing an enterprise audit trail:

- **1. پیشخوان و خلاصه (Overview):** Identity card, assigned shift badge, active status, today/week/month absence breakdown, punctuality statistics (on-time arrivals, late arrivals, early departures), and most frequented camera.
- **2. انضباط و شیفت‌ها (Shifts & Compliance):** Shift timetable cards, today's detailed absence time windows panel, in-shift vs. out-of-shift detection counts, and overall compliance score.
- **3. الگوهای ۲۴ ساعته (24-Hour Timeline):** 24-hour hourly detection histogram with automatic peak traffic hour highlight.
- **4. سوابق حضور ۱۴ روزه (14-Day Attendance Log):** Historical tabular log with first arrival, last departure, presence span, punctuality status badges, and absence incident counts with window tooltips.
- **5. توزیع دوربین‌ها (Cameras):** Percentage distribution across all facility camera feeds.
- **6. آخرین ترددها (Recent Sightings):** Gallery of cropped high-res face snapshots with confidence scores and timestamps.
- **7. خروجی چاپی (Print Summary):** Clean, print-optimized report for administrative and HR records.

---

## ⚙️ System Settings & Performance Optimization (تنظیمات سیستم و بهینه‌سازی بار)

FaceTrack features a dedicated runtime configuration modal accessible from the header navigation bar (`⚙️ تنظیمات سیستم` / `SettingsModal`). Settings can be changed on the fly without server downtime and are automatically persisted to `.env`:

### 1. AI Downscaling (کاهش مقیاس فریم برای هوش مصنوعی)
- **Range Slider (۲۵٪ تا ۱۰۰٪) & Quick Presets:**
  - `۱۰۰٪` (کیفیت اصلی / بدون کاهش): حداکثر جزئیات چهره در فواصل دور | بالاترین مصرف پردازنده
  - `۷۵٪` (وضوح بالا): مناسب برای دوربین‌های 1080p و بالاتر با جزئیات شفاف
  - `۵۰٪` (متعادل - پیش‌فرض پیشنهادی): ۴ برابر کاهش پیکسل‌ها با حفظ دقت بالا | ایده‌آل برای اکثر سناریوها
  - `۲۵٪` (حداکثر سرعت): ۱۶ برابر کاهش حجم پردازش | مناسب برای سخت‌افزارهای ضعیف و فواصل نزدیک
- **Tradeoff Advice Pill:** نمایش زنده راهنمای نسبت دقت به سرعت متناسب با درصد انتخابی.

### 2. نرخ پرش فریم (Frame Skip Rate)
- **Pill Presets (۱، ۳، ۵، ۱۰):**
  - مقدار `۵` (پیش‌فرض): یعنی از هر ۵ فریم استریم، ۱ فریم توسط هوش مصنوعی آنالیز می‌شود (کاهش ۸۰ درصدی بار پردازنده).
  - در صورت نیاز به ردیابی بسیار سریع سوژه‌ها می‌توان مقدار را روی `۱` یا `۳` قرار داد.

### 3. برش هوشمند محدوده منطقه‌ها (Station Zone ROI Cropping)
- **Toggle Switch (`ROI_CROP_ENABLED`):**
  - در حالت فعال، فریم ویدیویی ابتدا فقط به ابعاد مستطیل ایستگاه‌های فعال برش داده شده و سپس به مدل هوش مصنوعی ارسال می‌شود.
  - این قابلیت موجب **کاهش ۷۰٪ تا ۸۵٪ پیکسل‌های پردازشی** در هر فریم شده و مصرف CPU/GPU را به شدت پایین می‌آورد.

### 4. تنظیمات پیشرفته استریم و منابع (Advanced Stream Settings)
- **📺 نرخ فریم پیش‌نمایش زنده (`LIVE_PREVIEW_FPS`):** محدودسازی نرخ انکود تصاویر JPEG در پیشخوان (پیش‌فرض: ۱ فریم در ثانیه) برای جلوگیری از اشغال بی‌مورد پهنای باند و پردازنده.
- **🔄 دوره پایش چرخشی (`DUTY_CYCLE_WINDOW`):** تنظیم طول چرخه پایش نوبتی دوربین‌ها (پیش‌فرض: ۳۰ ثانیه).
- **⚡ مدت پایش فعال (`DUTY_BURST_DURATION`):** پنجره زمانی فعال بودن تشخیص چهره در هر چرخه (پیش‌فرض: ۲ ثانیه).
- **🔌 حداکثر زمان اتصال مجدد (`MAX_RECONNECT_BACKOFF`):** کنترل سقف وقفه تلاش مجدد اتصال به دوربین‌های قطع‌شده.

---

## 🧠 InsightFace Models & Embedding Re-indexing (مدل‌های هوش مصنوعی و بازسازی بردارها)

FaceTrack از دو بسته مدل InsightFace پشتیبانی می‌کند:

| مدل / ویژگی | `buffalo_l` (مدل اصلی - پیش‌فرض) | `buffalo_s` (مدل سبک و سریع) |
| :--- | :--- | :--- |
| **مدل تشخیص چهره (Detector)** | `det_10g.onnx` (SCRFD 10G) | `det_500m.onnx` (SCRFD 500M) |
| **مدل استخراج ویژگی (Recognition)** | **ArcFace ResNet-50** (`w600k_r50.onnx`) | **ArcFace MobileFaceNet** (`w600k_mbf.onnx`) |
| **طول بردار ویژگی (Embedding)** | ۵۱۲ عدد اعشاری (512-d float) | ۵۱۲ عدد اعشاری (512-d float) |
| **سرعت و مصرف منابع** | نیاز به CPU قوی یا GPU | **۵ تا ۱۰ برابر سریع‌تر** / مصرف بسیار کم CPU و RAM |
| **کاربرد ایده‌آل** | محیط‌های بزرگ، فواصل دور، دوربین‌های متعدد با سرور قدرتمند | مینی‌کامپیوترها، لپ‌تاپ‌ها و سیستم‌های اداری بدون کارت گرافیک |

> [!IMPORTANT]
> **نکته بسیار مهم در تغییر مدل:**
> بردارهای ۵۱۲ بعدی استخراج‌شده توسط مدل ResNet-50 (`buffalo_l`) در فضای برداری متفاوتی نسبت به MobileFaceNet (`buffalo_s`) قرار دارند. در نتیجه، بردار یک چهره که با `buffalo_l` ثبت شده با فریم زنده‌ای که با `buffalo_s` گرفته شود همخوانی نخواهد داشت (شباهت کسینوسی نزدیک صفر خواهد بود).

### بازسازی و استخراج مجدد بردارها (Re-indexing Embeddings):
عکس‌های مرجع پرسنل همواره با کیفیت اصلی در مسیر `data/reference_photos/` ذخیره هستند. هر زمان مدل را در `.env` تغییر دادید (`INSIGHTFACE_MODEL=buffalo_s` یا `buffalo_l`)، کافی است یکی از دو روش زیر را برای به‌روزرسانی بردارهای دیتابیس اجرا کنید:

1. **از طریق دستور خط فرمان (CLI):**
   ```powershell
   .\venv\Scripts\python.exe -m scripts.reindex_embeddings
   ```
2. **از طریق API بدون نیاز به ریستارت سرور:**
   ```http
   POST /api/persons/reindex-embeddings
   ```
   این فراخوانی تمامی عکس‌های ذخیره‌شده را مجدداً با مدل فعال پردازش کرده، بردارهای دیتابیس را به‌روزرسانی می‌کند و کش پردازش استریم زنده را بلافاصله تازه می‌سازد.

---

## 🗄️ Automated Storage Retention & Cleanup (مدیریت فضای دیسک و پاکسازی خودکار)

FaceTrack مجهز به سامانه جامع مدیریت دیسک و نگهداری فایل‌ها است:

1. **سیاست نگهداری تصاویر اسنپ‌شات (`SNAPSHOT_RETENTION_DAYS`):**
   - تعیین مدت نگهداری عکس‌های ذخیره‌شده از چهره‌ها (۱ روز، ۱ هفته، ۱ ماه، ۳ ماه یا بدون انقضا).
   - تصاویر قدیمی‌تر از مهلت مقرر به طور خودکار از روی دیسک پاک می‌شوند، در حالی که سوابق متنی رویدادها در دیتابیس حفظ می‌گردد.
2. **سیاست نگهداری لاگ‌های دیتابیس (`EVENT_LOG_RETENTION_DAYS`):**
   - تعیین سقف زمانی سوابق رویدادها در پایگاه داده (۷ روز، ۳۰ روز، ۹۰ روز، ۶ ماه، ۱ سال یا بدون انقضا).
3. **کارگر پس‌زمینه خودکار (Hourly Retention Worker):**
   - کارگر `RetentionWorker` به طور ساعتی در پس‌زمینه اجرا شده و فایل‌ها و رکوردهای منقضی‌شده را پاکسازی می‌نماید.
4. **داشبورد زنده آمار ذخیره‌سازی و پاکسازی درجا:**
   - نمایش لحظه‌ای تعداد فایل‌های اسنپ‌شات، حجم اشغال‌شده به مگابایت/گیگابایت و تعداد کل رکوردهای رویداد.
   - دکمه‌های پاکسازی فوری (`پاکسازی اکنون / Clean Now`) در پنجره تنظیمات برای آزادسازی سریع فضای دیسک در هر لحظه.

---

## 👥 User Management & Access Control (کاربران و دسترسی‌ها)

Manage administrative users and role-based permissions (`/#users`):

- **JWT Authentication:** Secure token-based API authentication with encrypted passwords (`bcrypt`).
- **Role-Based Access Control (RBAC):**
  - 👑 **مدیر سیستم (Admin):** Full privileges (camera configuration, zone creation, user management, identity enrollment).
  - 🛡️ **اپراتور (Operator):** Operational monitoring, event review, and live duty tracking.
  - 👁️ **بیننده (Viewer):** Read-only access to live streams and dashboards.
- **Self-Service Password Changes:** Change passwords securely from the header modal with real-time feedback.

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
INSIGHTFACE_MODEL=buffalo_l   # buffalo_l (High Accuracy) or buffalo_s (Fast CPU)
LOG_UNKNOWN_FACES=True        # If False, ignore and do not log unidentified faces

# ── Stream Processing & Performance Tuning ───────────────
FRAME_SKIP=5                  # Process 1 frame every N frames
DOWNSCALE_FACTOR=0.5          # Scale down video resolution (0.25, 0.5, 0.75, 1.0)
ROI_CROP_ENABLED=True         # Crop exclusively to station zone areas before AI analysis
LIVE_PREVIEW_FPS=1.0          # Throttle live preview encode rate (FPS)
DUTY_CYCLE_WINDOW=30.0        # Staggered camera detection duty cycle period (seconds)
DUTY_BURST_DURATION=2.0       # Active detection burst window per cycle (seconds)
COOLDOWN_SECONDS=60           # Seconds before re-logging the same identity on same camera
MAX_RECONNECT_BACKOFF=30      # Max backoff delay (seconds) on dropped RTSP streams

# ── Storage & Automated Retention ─────────────────────────
SNAPSHOT_DIR=./data/snapshots
REFERENCE_PHOTO_DIR=./data/reference_photos
SNAPSHOT_RETENTION_DAYS=30    # Days to keep snapshot images on disk (0 = keep forever)
EVENT_LOG_RETENTION_DAYS=0    # Days to keep event records in DB (0 = keep forever)
SAVE_SNAPSHOTS=True           # If False, log events without writing image files to disk

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

### 2. Live Duty Roster (`/#duty` / پایش زنده پرسنل در شیفت)
- **Active Shift Command Center:** Real-time visibility into who is currently scheduled to work and their current station presence.
- **Top KPI Deck:** Total on duty, present on station, absent from zone, camera offline count, sum of shift absence duration, and average compliance rate.
- **Absence Time Windows Drawer:** Expandable drawer displaying non-contiguous absence intervals (late arrival, detection gaps, current missing) with exact timestamps and durations.
- **Absence Count Tracking:** Distinct tracking of shift absence incidents (`X بار غیبت در این شیفت`).
- **Camera Offline Isolation:** Disconnected camera status shown in yellow (`دوربین قطع است`), cleanly excluded from absence counts.
- **Grid & List Views:** Instant toggle between visual card grid and compact administrative table list.

### 3. Zone Monitoring & Shift Schedules (`/#zones` / پایش منطقه‌ها و شیفت‌ها)
- **Live Presence Board:** Overview of all configured zones across cameras and staff station presence status.
- **Zone Assignments & Shifts:** Configure designated work areas, active weekdays, and schedule hours.
- **Security & Absence Logs:** Filterable table of past absence timeouts, unauthorized entries, and out-of-zone violations.

### 4. Camera Management (`/#cameras` / مدیریت دوربین‌ها)
- **Add / Edit Cameras:** Register new cameras with RTSP credentials, port, and custom location tags.
- **Live Stream Viewer:** View low-latency MJPEG live streams or high-res snapshots directly in a modal.
- **Interactive Zone Drawer:** Draw and adjust spatial zones directly on camera snapshots.

### 5. Identity Management & Analytics (`/#persons` / مدیریت هویت‌ها و پرسنل)
- **Enroll Identities:** Upload single or multiple reference photos per individual.
- **Photo Gallery:** Manage enrolled staff, update roles, and review biometric embeddings.
- **Comprehensive Analytics Modal:** Click any staff member to view full 6-tab analytics audit (Overview, Shifts & Absence Windows, 24-Hour Timeline, 14-Day Attendance Log, Cameras, and Recent Sightings).

### 6. Users & Access Control (`/#users` / کاربران و دسترسی‌ها)
- **Role-Based Accounts:** Administer user accounts with granular permissions (`admin`, `operator`, `viewer`).
- **Security Controls:** Password updates, credential resets, and session management.

### 7. System Settings & Storage Management (`⚙️ تنظیمات سیستم` / پنجره تنظیمات)
- **AI Performance Controls:** Slider for Downscaling (25% to 100%), Frame Skip presets (1 to 10), and Station Zone ROI Cropping toggle.
- **Live Preview & Duty Cycle Tuning:** Configure live preview encode FPS, staggered camera duty bursts, and max reconnect backoff delay.
- **Disk & Database Retention:** Set automated expiry days for snapshot files and event log records.
- **On-Demand Storage Cleanup:** Real-time counters showing file count, disk space consumed (MB/GB), and database records with one-click cleanup triggers.

---

## 📡 API Reference

Interactive OpenAPI / Swagger documentation is available at: **`http://localhost:8000/docs`**

### REST Endpoints Summary

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/auth/login` | Authenticate user and receive JWT access token |
| `GET` | `/api/auth/me` | Retrieve profile of the currently authenticated user |
| `POST` | `/api/auth/change-password` | Update current user password |
| `GET` | `/api/users` | List all system user accounts *(Admin only)* |
| `POST` | `/api/users` | Create a new user account *(Admin only)* |
| `PUT` | `/api/users/{id}` | Update user information or role *(Admin only)* |
| `DELETE` | `/api/users/{id}` | Delete a user account *(Admin only)* |
| `GET` | `/api/health` | Service health status and AI engine readiness |
| `GET` | `/api/settings` | Retrieve runtime system configuration, retention, and performance settings |
| `PATCH` | `/api/settings` | **Update runtime configuration on the fly** & persist to `.env` |
| `GET` | `/api/settings/storage-stats` | **Live disk storage stats** (snapshot files, MB used, DB event count) |
| `POST` | `/api/settings/cleanup-snapshots` | On-demand cleanup of snapshot image files older than N days |
| `POST` | `/api/settings/cleanup-logs` | On-demand cleanup of database event records older than N days |
| `GET` | `/api/cameras` | List all configured cameras |
| `POST` | `/api/cameras` | Register a new camera stream |
| `GET` | `/api/cameras/{id}` | Retrieve camera configuration details |
| `PUT` | `/api/cameras/{id}` | Update camera URL, name, location, or active status |
| `DELETE` | `/api/cameras/{id}` | Remove camera, cascade clean its zones/alerts, and terminate stream worker |
| `POST` | `/api/cameras/{id}/test` | Test live camera RTSP connection |
| `GET` | `/api/cameras/{id}/stream` | MJPEG live video stream |
| `GET` | `/api/cameras/{id}/snapshot` | Current JPEG snapshot from live stream |
| `GET` | `/api/cameras/{id}/zones` | List spatial zones for a camera |
| `POST` | `/api/cameras/{id}/zones` | Create a new spatial zone with schedule & staff links |
| `GET` | `/api/zones` | List all spatial zones across cameras |
| `DELETE` | `/api/zones/{id}` | Delete a spatial zone |
| `GET` | `/api/zones/status` | Live presence status for all zones & attached staff |
| `GET` | `/api/zones/duty-roster` | **Live shift roster** with absence time windows, counts & camera status |
| `GET` | `/api/zones/logs` | Security and absence violation log records |
| `GET` | `/api/persons` | List all registered known individuals |
| `POST` | `/api/persons` | Enroll a person with uploaded photos (`photos`) and/or event snapshots (`event_ids`) |
| `DELETE` | `/api/persons/{id}` | Remove registered individual and associated embeddings |
| `POST` | `/api/persons/{id}/photos` | Upload additional reference photos or attach event snapshots (`event_ids`) |
| `POST` | `/api/persons/reindex-embeddings` | **Recompute all embeddings** from photos using active InsightFace model |
| `GET` | `/api/persons/{id}/analytics` | **Comprehensive person analytics**, punctuality & 14-day history |
| `GET` | `/api/events` | Query detection event logs with pagination and filters (`camera_id`, `is_known`, `has_snapshot`, time) |
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

# Run event photo enrollment & unknown log picker tests
python -m pytest tests/test_enroll_from_event.py -v

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
- **Lower Resolution:** Set `DOWNSCALE_FACTOR=0.4` or `0.3` (or use the slider in `⚙️ تنظیمات سیستم`).
- **Enable Station ROI Cropping:** Turn on `ROI_CROP_ENABLED=True` to only process pixels within defined station zones.
- **Model Choice:** Switch model from `buffalo_l` to `buffalo_s` in `.env`.

### Q4: Switched to `buffalo_s` (or `buffalo_l`) and faces are no longer recognized?
- **Root Cause:** Embeddings from `buffalo_l` (ResNet-50) and `buffalo_s` (MobileFaceNet) are incompatible latent spaces. Cosine similarity between them drops to near zero.
- **Solution:** Re-index your stored reference photos using the active model:
  ```powershell
  .\venv\Scripts\python.exe -m scripts.reindex_embeddings
  ```
  Or trigger it via REST API without server restart: `POST /api/persons/reindex-embeddings`.

### Q5: How does automated snapshot disk and database retention work?
- Configure `SNAPSHOT_RETENTION_DAYS=30` and `EVENT_LOG_RETENTION_DAYS=90` in `.env` (or via `⚙️ تنظیمات سیستم`).
- The built-in `RetentionWorker` runs automatically every hour in the background to delete expired snapshot files and event rows.
- You can also trigger immediate cleanup anytime from the Settings modal (`پاکسازی اکنون`) or via API (`POST /api/settings/cleanup-snapshots`).

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
├── SERVICE_GUIDE.html        # Production service deployment & operations guide
│
├── backend/                  # FastAPI Application Core
│   ├── __init__.py
│   ├── main.py               # Application entry point, lifespan & no-cache middleware
│   ├── config.py             # Pydantic environment configuration
│   ├── database.py           # Async SQLAlchemy database initialization & cascades
│   ├── models.py             # Database ORM models (Camera, Person, Event, CameraZone, User)
│   ├── schemas.py            # Pydantic validation schemas
│   ├── face_engine.py        # InsightFace detector & vector matcher
│   ├── snapshot_cleanup.py   # Disk usage analysis, hourly retention worker & .env updater
│   ├── stream_processor.py   # Async RTSP ingestion, zone watchdog & WebSocket manager
│   └── routers/
│       ├── __init__.py
│       ├── auth.py           # JWT login, token verification & password change
│       ├── users.py          # User management & RBAC endpoints
│       ├── cameras.py        # Camera API & live stream endpoints
│       ├── zones.py          # Spatial zones, duty roster & absence windows
│       ├── persons.py        # Person enrollment, analytics & embedding re-indexing
│       ├── events.py         # Event logs & metrics endpoints
│       ├── system.py         # System settings, runtime config & storage cleanup
│       └── snapshots.py      # Image serving endpoint
│
├── frontend/                 # Dashboard Frontend App
│   ├── index.html            # Main HTML layout shell (RTL & Persian default)
│   ├── css/
│   │   └── style.css         # Glassmorphism dark-theme & RTL typography
│   └── js/
│       ├── app.js            # App core, router & WebSocket client
│       ├── auth.js           # JWT authentication manager & permission checks
│       ├── i18n.js           # Internationalization engine, dictionaries & Jalali formatter
│       ├── components/
│       │   ├── cameraForm.js # Camera modal component
│       │   ├── eventCard.js  # Live event card & detail modal
│       │   ├── personForm.js # Person enrollment & unknown logs photo picker modal
│       │   ├── personAnalyticsModal.js # 6-tab comprehensive person analytics modal
│       │   ├── settingsModal.js # Dynamic runtime settings & storage cleanup modal
│       │   └── zoneModal.js  # Interactive canvas zone drawer & shift modal
│       └── pages/
│           ├── cameras.js    # Camera management page view
│           ├── dashboard.js  # Live monitoring dashboard view
│           ├── dutyPage.js   # Live shift roster, absence windows & KPI command center
│           ├── persons.js    # Identity enrollment page view
│           ├── usersPage.js  # User administration & role management view
│           └── zonesPage.js  # Live Presence Board, shifts & security logs view
│
├── scripts/                  # Management & Maintenance Scripts
│   └── reindex_embeddings.py # CLI script to recompute face embeddings across AI models
│
├── data/                     # Persistent Data Directory (Excluded from git)
│   ├── snapshots/            # Event cropped snapshot JPEGs
│   └── reference_photos/     # Enrolled person photos
│
└── tests/                    # Test Suite
    ├── __init__.py
    ├── test_api.py           # API integration test suite
    ├── test_enroll_from_event.py # Enrollment from detection snapshots & multi-photo tests
    ├── test_face_engine.py   # AI face matcher unit tests
    └── test_snapshot_cleanup.py # Storage retention & system settings tests
```

---

## 📜 License

This project is open-source and released under the **MIT License**. Free for personal, commercial, and enterprise usage.
