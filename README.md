# 🎯 FaceTrack — Self-Hosted Real-Time Face Tracking & Zone Monitoring System
### سامانه بومی و مستقل تشخیص چهره، پایش منطقه‌ای و حضور پرسنل در شیفت

A production-ready, self-hosted platform for real-time face detection, recognition, spatial zone monitoring, staff shift tracking, and event logging across local IP camera networks (RTSP). Built with **Python (FastAPI)**, **InsightFace (ArcFace)**, **OpenCV**, and a modern **Glassmorphism Web Dashboard** with full **Dual-Language Localization (Persian `fa` default & English `en`)**, **RTL Layout**, and **Solar Hijri (Jalali) Calendar** support.

---

## 📋 Table of Contents / فهرست مطالب

- [Overview & Architecture](#-overview--architecture)
- [Key Features](#-key-features)
- [Localization & Persian Support (بومی‌سازی و زبان فارسی)](#-localization--persian-support)
- [Live Duty, Break Rules & TV Hall Display (پایش زنده، قوانین استراحت و نمایشگر سالن)](#-live-duty--shift-roster-monitoring)
- [Supervisor Executive Cockpit (پنل اختصاصی سرپرستان)](#-supervisor-executive-cockpit)
- [Zone Monitoring, Shift Templates & Rotational Schedules](#-zone-monitoring--security-schedules)
- [Identity & Comprehensive Person Analytics](#-identity--comprehensive-person-analytics)
- [System Settings & Performance Optimization (تنظیمات سیستم و بهینه‌سازی بار)](#-system-settings--performance-optimization)
- [InsightFace Models & Embedding Re-indexing (مدل‌های هوش مصنوعی و بازسازی بردارها)](#-insightface-models--embedding-re-indexing)
- [Automated Storage Retention & Monthly Archiving (پاکسازی خودکار و بایگانی ماهانه)](#-automated-storage-retention--cleanup)
- [User Management, Sections & Custom RBAC (کاربران، بخش‌ها و دسترسی‌ها)](#-user-management--access-control)
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
│   │  • Frame Skipping, Downscaling & Station Zone ROI Cropping               │    │
│   │  • Staggered Duty-Cycle Detection & Timetable / Rotation Validator       │    │
│   │  • Real-Time Absence & Unauthorized Entry Watchdog Loops                 │    │
│   │  • Legal Break Deduction & Pre/Post-Break Absence Accumulation           │    │
│   │  • Scoped Camera Offline Isolation (Never Counted as Absence)            │    │
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
│   │ SQLite/PostgreSQL+Archives│             │   WebSocket Broadcast     │         │
│   │ (Transparent Monthly Query)             │    Server (/ws/events)    │         │
│   └───────────────────────────┘             └─────────────┬─────────────┘         │
└───────────────────────────────────────────────────────────┼───────────────────────┘
                                                            │ Real-time Alerts
                                                            ▼
                                              ┌───────────────────────────┐
                                              │    Frontend Dashboard     │
                                              │  (HTML5 / CSS / Vanilla)  │
                                              │  • Persian/English & RTL  │
                                              │  • Live Duty & TV Display │
                                              │  • Supervisor Cockpit     │
                                              │  • 30-Day Person Analytics│
                                              └───────────────────────────┘
```

---

## ✨ Key Features

- **Multi-Camera Processing & Batch Import:** Concurrently ingests and analyzes multiple RTSP camera streams in isolated asynchronous worker loops, with batch camera registration (`POST /api/cameras/batch`).
- **State-of-the-Art Recognition:** Leverages **InsightFace (ArcFace `buffalo_s` lightweight default or `buffalo_l` high-accuracy)** to extract 512-d face feature vectors.
- **Dynamic Runtime Settings & Performance Tuning:** Live adjustment of downscaling (25%–100%), frame skipping (1–10), station zone ROI cropping, preview FPS, archive path, and retention policies directly from the web UI (`⚙️`) with instant `.env` persistence.
- **Cross-Model Embedding Re-indexing:** Built-in CLI script (`python -m scripts.reindex_embeddings`) and REST endpoint (`POST /api/persons/reindex-embeddings`) to automatically recompute stored vector representations when switching AI models.
- **Automated Storage Retention & Monthly Archiving:** Automatic monthly database and snapshot partitioning (`archive_manager.py`) with configurable `ARCHIVE_DIR`, transparent cross-archive querying for analytics/rosters, and hourly retention cleanup across both active and archived storage.
- **Live Duty Roster & Smart Break Continuity:** Real-time roster with live station presence, arrival grace period tracking (shown only before first arrival), scheduled break deduction, and **pre-break + post-break absence accumulation** whenever an employee is absent before a legal rest period and remains absent afterward.
- **Factory Hall TV Display (`/tv.html`):** High-contrast black-background TV board for production floors featuring a top warning banner, live Jalali clock, KPI ribbon, **Grid/List view toggle (`V`)**, audible alerts (`S`), fullscreen (`F`), and instant Persian/English toggle (`L`).
- **Supervisor Executive Cockpit:** Mobile-responsive, privacy-first portal (`supervisorCockpit.js`) strictly scoped to assigned personnel and sections with zero raw snapshots, live shift telemetry, daily leave management, shift substitutions with conflict checks, and text-only alert timelines.
- **Shift Templates, Rotational Shifts & Break Presets:** Create reusable weekly or rotational shift templates (e.g., 2D-2N-1Off / 2D-2N-2Off via interactive builder), define named break presets, and assign custom per-person shifts while preserving cross-section workstation assignments across updates.
- **Absence Time Windows & Incident Counts:**
  - Tracks detailed absence intervals (e.g. `10:30 - 11:15 (45m)`) categorized into *late arrival*, *intermediate gaps*, and *current missing status*.
  - Counts total absence incidents during the shift (`X بار غیبت در این شیفت`) and displays a roster-wide KPI.
  - Interactive expandable time windows drawer in both Grid and List views with auto-refresh state preservation.
- **Excel (.xlsx) & CSV Shift, Supervisor & Analytics Reporting:**
  - Export duty roster, supervisor daily attendance reports, 30-day person analytics, and event logs directly from the UI or REST API.
  - Generates styled Persian Excel (`.xlsx`) spreadsheets with native RTL layout, KPI summaries, absence window breakdowns, and color-coded status indicators.
  - CSV files encoded with UTF-8 BOM (`utf-8-sig`) ensuring clean Persian/Farsi display across Microsoft Excel, LibreOffice, and Google Sheets.
- **Scoped Camera Offline Safeguard:** Decouples camera disconnects from absence durations/counts (`دوربین قطع است`) and isolates camera disconnection alerts from personnel identity logs and unassigned supervisor feeds.
- **Clean Camera Deletion Cascades:** Removing a camera automatically cleans up associated zones and alerts, unlinks camera IDs on historical detection logs, and clears in-memory state to prevent phantom alerts.
- **Spatial Zone Monitoring:** Draw designated areas directly on camera snapshots and attach staff members.
- **Identity Editing & 30-Day Person Analytics:** Edit person profiles/sections (`PUT /api/persons/{id}`), and open the analytics modal (`Overview`, `Shifts & Absence Windows`, `24-Hour Timeline`, `30-Day Attendance Log` querying archived months, `Cameras`, `Recent Sightings`, plus Print & Excel export).
- **Custom RBAC Roles & Departmental Sections:** Manage dynamic permissions (`/api/roles`), departmental sections (`/api/sections`), and scoped accounts (`admin`, `supervisor`, `operator`, `viewer`).
- **Direct Unknown Face Enrollment & Multi-Photo Picker:** Tap "Enroll Person" directly from any unidentified detection event to register immediately using multi-angle snapshots from unknown logs.
- **Full Dual-Language Localization & Hardware Acceleration:** Persian (`fa`) RTL default with Vazirmatn font and Solar Hijri timestamps, instant English (`en`) switching, and CUDA/GPU inference via ONNX Runtime with CPU fallback.

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
   - 🟢 **حاضر در محل (On Station):** Staff actively detected in their designated camera zone (or within station absence timeout), displaying last sighting age and arrival grace status (`در مهلت ورود`) strictly before first arrival.
   - 🔴 **غایب از منطقه (Absent from Zone):** Staff absent during scheduled working hours, displaying net active absence in hours/minutes.
   - ☕ **زمان استراحت (On Break):** Scheduled break/rest windows automatically pause absence penalties and suppress watchdog alerts.
   - 🟡 **دوربین قطع است (Camera Disconnected):** Camera signal lost or offline; clearly separated so staff are not unfairly penalized.
   - ⚪ **خارج از شیفت / مرخصی (Off Duty / On Leave):** Outside active timetable hours or approved daily leave.

2. **Legal Rest Time & Continuous Absence Continuity (`calculate_net_absence_with_breaks`):**
   - Scheduled rest intervals (e.g., `12:00 - 13:00`) are deducted from raw missing durations across the Duty Roster, Person Analytics, and Watchdog alerts.
   - **Pre-Rest + Post-Rest Accumulation:** If a worker is absent before a scheduled break begins (> 2 minutes prior to `break_start`) and remains absent or returns late after `break_end`, both absence periods are combined into **one continuous absence episode** (`mins_before + mins_after`), keeping the original departure timestamp before break as `start_time`.
   - Conversely, workers present right up to the start of the break begin accumulating absence only from `break_end`.

3. **Absence Time Windows (بازه‌های زمانی عدم حضور):**
   - Automatically detects and categorizes non-contiguous absence intervals:
     - **تاخیر در ورود (Late Arrival):** Delay between shift start time and first confirmed sighting.
     - **خروج از منطقه (Detection Gap):** Periods during the shift exceeding threshold where the person was absent from the station.
     - **غیبت جاری (Current Missing):** Trailing absence from the last confirmed sighting up to `هم‌اکنون` (Now).
   - Interactive toggle drawer (`🕒 مشاهده بازه‌ها`) shows exact start time $\rightarrow$ end time and duration badge (`۳۵m`).
   - Drawer toggle state is preserved across background 10-second auto-refresh cycles.

4. **Shift Absence Incident Count & Camera Offline Safeguard:**
   - Tracks absence incident counts (`X بار غیبت در این شیفت`) and displays a roster-wide KPI summary.
   - Camera downtime is **never** counted toward absence durations or counts (`زمان قطعی جزو غیبت محاسبه نمی‌شود`).

5. **Grid & List Views + TV Hall Display (`/tv.html`):**
   - Instant switching between high-density cards and compact table rows on both `/#duty` and the dedicated **TV Hall Display** (`/tv.html`).
   - TV Mode provides a high-contrast pure black canvas designed for floor monitors with a large top warning marquee, live Shamsi clock/date, Grid/List toggle (`V`), audible alarm toggle (`S`), language switcher (`L`), and fullscreen mode (`F`).

---

## 🧭 Supervisor Executive Cockpit

Dedicated mobile-responsive workspace (`frontend/js/components/supervisorCockpit.js`) tailored for department supervisors:

- **Strict Privacy & Scope Isolation:** Scoped solely to assigned personnel and sections (`/api/sections`), rendering zero raw face snapshots (using deterministic color-coded avatars and text-only timelines). Camera disconnect alerts are filtered strictly to assigned cameras.
- **Executive Command Strip & Interactive KPI Pods:** Live Shamsi clock, telemetry radar, click-to-filter KPI cards, search (`/` shortcut), urgency/compliance/absence sorting, and Grid/List view toggle.
- **Daily Leave & Shift Substitution Management:**
  - Grant daily leaves (`supervisorLeaveModal.js`) to excuse absence compliance penalties cleanly.
  - Assign temporary shift substitutes (`supervisorSubstitutionModal.js`) with automated conflict detection (`POST /api/substitutions/check-conflict`).
- **Shift Customization & Excel Attendance Reports:** Assign shift templates, rotational cycles, breaks, and workstations per person (`personShiftModal.js`), and export dedicated RTL Excel attendance reports (`GET /api/zones/supervisor/attendance-report/export`).

---

## 🎯 Zone Monitoring & Security Schedules

Manage critical work areas, shift templates, and security perimeters (`/#zones`):

1. **Visual Area Drawer:** Drag rectangular polygons directly over high-res camera snapshots.
2. **Staff Assignment & Cross-Section Preservation:** Link enrolled identities to workstations. Cross-section workstation assignments are safely preserved when individual sections or shifts are updated.
3. **Shift Templates & Rotational Shifts:** Create reusable fixed weekly or rotational shift patterns (e.g., 2 days / 2 nights / 1 off) via `shiftTemplateModal.js` (`/api/shift-templates`) and customize shifts per employee (`personShiftModal.js`).
4. **Scheduled Break Presets:** Define reusable legal rest/meal presets (`breakPresets.js`, `/api/break-presets`) and apply them to shifts and stations.
5. **Custom Alert Policies:**
   - 🔔 **Absence Watchdog:** Triggers audio alerts and notifications if assigned staff is missing during active work hours (outside scheduled breaks).
   - 🚨 **Unauthorized Entry:** Alerts if unregistered or unauthorized persons step into restricted areas.
   - ⚠️ **Combined Policy:** Full security surveillance (Absence + Unauthorized entry).

---

## 📊 Identity & Comprehensive Person Analytics

Click on any person card to launch the **Person Analytics Modal** (`PersonAnalyticsModal`), providing an enterprise audit trail:

- **1. پیشخوان و خلاصه (Overview):** Identity card, assigned shift badge, active status, today/week/month absence breakdown, punctuality statistics (on-time arrivals, late arrivals, early departures), and most frequented camera.
- **2. انضباط و شیفت‌ها (Shifts & Compliance):** Shift timetable cards, today's detailed absence time windows panel, in-shift vs. out-of-shift detection counts, and overall compliance score.
- **3. الگوهای ۲۴ ساعته (24-Hour Timeline):** 24-hour hourly detection histogram with automatic peak traffic hour highlight.
- **4. سوابق حضور ۳۰ روزه (30-Day Attendance Log):** Historical tabular log (automatically querying monthly archive DBs as needed) with time window selector, first arrival, last departure, presence span, absence windows modal, and Excel export.
- **5. توزیع دوربین‌ها (Cameras):** Percentage distribution across all facility camera feeds.
- **6. آخرین ترددها (Recent Sightings):** Gallery of cropped high-res face snapshots with confidence scores and timestamps.
- **7. خروجی چاپی و اکسل (Print & Excel Export):** Print-optimized summary and RTL Excel export (`/api/persons/{id}/analytics/export`).

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

## 🗄️ Automated Storage Retention & Cleanup (مدیریت فضای دیسک، پاکسازی و بایگانی ماهانه)

FaceTrack مجهز به سامانه جامع مدیریت دیسک، بایگانی ماهانه و نگهداری فایل‌ها است:

1. **سیاست نگهداری تصاویر اسنپ‌شات (`SNAPSHOT_RETENTION_DAYS`):**
   - تعیین مدت نگهداری عکس‌های ذخیره‌شده از چهره‌ها (۱ روز، ۱ هفته، ۱ ماه، ۳ ماه یا بدون انقضا) هم در پایگاه اصلی و هم در پارتیشن‌های بایگانی.
2. **سیاست نگهداری لاگ‌های دیتابیس (`EVENT_LOG_RETENTION_DAYS`):**
   - تعیین سقف زمانی سوابق رویدادها در پایگاه داده (۷ روز، ۳۰ روز، ۹۰ روز، ۶ ماه، ۱ سال یا بدون انقضا).
3. **بایگانی ماهانه دیتابیس و اسنپ‌شات‌ها (`archive_manager.py` / `ARCHIVE_DIR`):**
   - جداسازی خودکار یا دستی لاگ‌ها و تصاویر ماه‌های قبل به دیتابیس‌ها و پوشه‌های ماهانه در مسیر قابل تنظیم `ARCHIVE_DIR` (`AUTO_ARCHIVE_MONTHLY=True` و `ARCHIVE_PURGE_ACTIVE=True`).
   - کوئری شفاف (Transparent Multi-DB Querying) در تحلیل رفتار پرسنل، جدول حضور ۳۰ روزه و مانیتورینگ شیفت، بدون از دست رفتن اطلاعات تاریخی.
4. **کارگر پس‌زمینه خودکار (Hourly Retention Worker):**
   - کارگر `RetentionWorker` به طور ساعتی در پس‌زمینه اجرا شده و فایل‌ها و رکوردهای منقضی‌شده (از جمله در آرشیوهای ماهانه) را پاکسازی می‌نماید.
5. **داشبورد زنده آمار ذخیره‌سازی و پاکسازی درجا:**
   - نمایش لحظه‌ای تعداد فایل‌های اسنپ‌شات، حجم اشغال‌شده و مدیریت آرشیوها با دکمه‌های پاکسازی و بایگانی فوری در پنجره تنظیمات.

---

## 👥 User Management & Access Control (کاربران، بخش‌ها و دسترسی‌ها)

Manage administrative users, organizational sections, and granular role-based permissions (`/#users`):

- **JWT Authentication:** Secure token-based API authentication with encrypted passwords (`bcrypt`).
- **Role-Based Access Control (RBAC & Custom Roles):**
  - 👑 **مدیر سیستم (Admin):** Full privileges (camera configuration, zone creation, user/role management, sections, identity enrollment).
  - 🧭 **سرپرست (Supervisor):** Dedicated executive cockpit scoped strictly to assigned sections, staff, and cameras, with leave/substitution management and zero raw snapshots.
  - 🛡️ **اپراتور (Operator):** Operational monitoring, event review, and live duty tracking.
  - 👁️ **بیننده (Viewer):** Read-only access to live streams and dashboards.
  - ⚙️ **نقش‌های سفارشی (`/api/roles`):** Define custom roles from the permissions registry.
- **Departmental Sections (`/api/sections`):** Organize staff into factory/office sections and restrict supervisor access by section.
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
INSIGHTFACE_MODEL=buffalo_s   # buffalo_s (Fast CPU default) or buffalo_l (High Accuracy)
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

# ── Storage, Retention & Monthly Archiving ────────────────
SNAPSHOT_DIR=./data/snapshots
REFERENCE_PHOTO_DIR=./data/reference_photos
SNAPSHOT_RETENTION_DAYS=30    # Days to keep snapshot images on disk (0 = keep forever)
EVENT_LOG_RETENTION_DAYS=0    # Days to keep event records in DB (0 = keep forever)
SAVE_SNAPSHOTS=True           # If False, log events without writing image files to disk
ARCHIVE_DIR=./data/archives   # Directory for monthly standalone DB & snapshot partitions
AUTO_ARCHIVE_MONTHLY=True     # Automatically archive previous month on 1st of month
ARCHIVE_PURGE_ACTIVE=True     # Remove archived events from active DB to keep it fast

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

### 2. Live Duty Roster & TV Hall Display (`/#duty` & `/tv.html`)
- **Active Shift Command Center:** Real-time visibility into scheduled staff, station presence, scheduled breaks, arrival grace (`در مهلت ورود` only before first arrival), and continuous pre/post-break absence calculation.
- **Factory Hall TV Display (`/tv.html`):** Standalone high-contrast black TV screen with a prominent top alert strip, live Shamsi clock, Grid/List toggle (`V`), alert audio toggle (`S`), language switcher (`L`), and fullscreen mode (`F`).
- **Top KPI Deck:** Total on duty, present on station, absent from zone, on break, camera offline count, sum of shift absence duration, and average compliance rate.
- **Absence Time Windows Drawer:** Expandable drawer displaying non-contiguous absence intervals (late arrival, detection gaps, current missing) with exact timestamps and durations.
- **Camera Offline Isolation:** Disconnected camera status shown in yellow (`دوربین قطع است`), cleanly excluded from absence counts.
- **Grid & List Views:** Instant toggle between visual card grid and compact administrative table list.

### 3. Supervisor Cockpit (`supervisorCockpit.js`)
- **Privacy-First Scoped Dashboard:** Strictly scoped to assigned personnel/sections with text-only activity timelines, deterministic gradient avatars, and zero raw snapshots.
- **Daily Actions:** Manage employee leaves, assign shift substitutions with conflict checks, customize individual shift templates/breaks, and export dedicated Excel attendance reports.

### 4. Zone Monitoring & Shift Templates (`/#zones` / پایش منطقه‌ها و شیفت‌ها)
- **Live Presence Board:** Overview of all configured zones across cameras and staff station presence status.
- **Shift Templates & Rotational Builder:** Create fixed or rotational schedules (e.g., 2D-2N-1Off / 2D-2N-2Off) and reusable break presets while preserving cross-section workstation assignments.
- **Security & Absence Logs:** Filterable table of past absence timeouts, unauthorized entries, and scoped camera events.

### 5. Camera Management (`/#cameras` / مدیریت دوربین‌ها)
- **Add / Batch Import / Edit Cameras:** Register single or batch RTSP cameras with credentials, port, and location tags.
- **Live Stream Viewer & Interactive Zone Drawer:** View MJPEG live streams/snapshots and draw spatial zones directly on camera snapshots.

### 6. Identity Management & Analytics (`/#persons` / مدیریت هویت‌ها و پرسنل)
- **Enroll & Edit Identities:** Upload reference photos, enroll from unknown event logs, edit person info/sections, or customize shifts directly.
- **Comprehensive 30-Day Analytics Modal:** Click any staff member to view full analytics audit (Overview, Shifts & Absence Windows, 24-Hour Timeline, 30-Day Cross-Archive Attendance Log, Cameras, Recent Sightings, plus Print & Excel export).

### 7. Users, Sections & Custom RBAC (`/#users` / کاربران و دسترسی‌ها)
- **Role & Section Administration:** Manage user accounts, departmental sections, custom RBAC roles, and password resets.

### 8. System Settings, Storage & Monthly Archiving (`⚙️ تنظیمات سیستم`)
- **AI Performance Controls:** Slider for Downscaling (25% to 100%), Frame Skip presets (1 to 10), and Station Zone ROI Cropping toggle.
- **Live Preview & Duty Cycle Tuning:** Configure live preview encode FPS, staggered camera duty bursts, and max reconnect backoff delay.
- **Disk, Retention & Monthly Archives:** Configure snapshot/DB retention days, custom `ARCHIVE_DIR`, view active + archive storage stats, and trigger immediate cleanup or monthly archiving.

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
| `PUT` | `/api/users/{id}` | Update user information, role, or section assignments *(Admin only)* |
| `DELETE` | `/api/users/{id}` | Delete a user account *(Admin only)* |
| `GET` | `/api/roles` | List RBAC roles and inspect permission registry (`GET /api/roles/permissions-registry`) |
| `POST/PUT/DELETE` | `/api/roles` | Create, edit, or remove custom RBAC roles |
| `GET/POST/PUT/DELETE` | `/api/sections` | Manage departmental sections (`/api/sections/{id}`) |
| `GET` | `/api/health` | Service health status and AI engine readiness |
| `GET` | `/api/settings` | Retrieve runtime system configuration, retention, archive path, and performance settings |
| `PATCH` | `/api/settings` | **Update runtime configuration on the fly** & persist to `.env` |
| `GET` | `/api/settings/storage-stats` | **Live disk storage stats** (snapshot files, MB used, DB event count) |
| `POST` | `/api/settings/cleanup-snapshots` | On-demand cleanup of snapshot image files older than N days (including archives) |
| `POST` | `/api/settings/cleanup-logs` | On-demand cleanup of database event records older than N days |
| `GET` | `/api/settings/archives` | List monthly database & snapshot archives |
| `POST` | `/api/settings/archives/run` | Trigger monthly archiving manually |
| `GET` | `/api/cameras` | List configured cameras |
| `POST` | `/api/cameras` | Register a single camera or batch import (`POST /api/cameras/batch`) |
| `PUT/DELETE` | `/api/cameras/{id}` | Update camera configuration or remove camera with cascade cleanup |
| `POST` | `/api/cameras/{id}/test` | Test live camera RTSP connection (`POST /api/cameras/test-url` before saving) |
| `GET` | `/api/cameras/{id}/stream` | MJPEG live video stream & snapshot (`GET /api/cameras/{id}/snapshot`) |
| `GET/POST` | `/api/cameras/{id}/zones` | List or create spatial zones (`GET/PUT/DELETE /api/zones/{id}`) |
| `GET` | `/api/zones/status` | Live presence status for all zones & attached staff |
| `GET` | `/api/zones/duty-roster` | **Live shift roster** with continuous pre/post-break absence windows & counts |
| `GET` | `/api/zones/duty-roster/export` | **Export Duty Roster & shift compliance** as formatted Excel (`.xlsx`) or CSV |
| `GET` | `/api/zones/supervisor/attendance-report` | Scoped supervisor attendance report & Excel export (`/api/zones/supervisor/attendance-report/export`) |
| `GET` | `/api/zones/logs` | Security and absence violation log records |
| `GET/POST/PUT/DELETE` | `/api/shift-templates` | Manage reusable fixed and rotational shift templates (`/api/shift-templates/{id}`) |
| `GET/POST/PUT/DELETE` | `/api/break-presets` | Manage scheduled legal break/rest presets (`/api/break-presets/{id}`) |
| `GET/POST/DELETE` | `/api/substitutions` | Manage shift substitutions & check conflicts (`POST /api/substitutions/check-conflict`) |
| `GET/POST/PUT/DELETE` | `/api/persons` | List, enroll, edit (`PUT`), or remove known individuals |
| `POST` | `/api/persons/{id}/photos` | Upload additional reference photos or attach event snapshots |
| `GET/PUT` | `/api/persons/{id}/shift` | Retrieve or customize individual shift, breaks & cross-section workstations |
| `GET/POST/DELETE` | `/api/persons/{id}/leaves` | Manage individual daily leaves (`/api/persons/{id}/leaves/{leave_id}`) |
| `POST` | `/api/persons/reindex-embeddings` | **Recompute all embeddings** from photos using active InsightFace model |
| `GET` | `/api/persons/{id}/analytics` | **Comprehensive person analytics**, 30-day multi-archive history & Excel export (`/export`) |
| `GET` | `/api/events` | Query detection event logs with pagination and filters (`camera_id`, `is_known`, `has_snapshot`, time) |
| `GET` | `/api/events/export` | **Export detection event logs** as formatted Excel (`.xlsx`) or CSV with filters |
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
# Run all tests (using local temp dir on Windows)
python -m pytest tests/ --basetemp=./tmp_test -v

# Run duty roster & legal break accumulation tests
python -m pytest tests/test_duty_roster.py tests/test_break_pre_absence.py tests/test_break_presets.py -v

# Run rotational shifts, substitutions & supervisor cockpit tests
python -m pytest tests/test_rotational_shifts.py tests/test_shift_substitutions.py tests/test_supervisor_privacy_and_leaves.py tests/test_sections_and_scopes.py -v

# Run archiving, reporting & storage retention tests
python -m pytest tests/test_archive_manager.py tests/test_archive_api.py tests/test_archive_person_analytics.py tests/test_archive_retention.py tests/test_reports_export.py tests/test_snapshot_cleanup.py -v

# Run API & AI matching unit tests
python -m pytest tests/test_api.py tests/test_face_engine.py tests/test_enroll_from_event.py -v
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
│   ├── database.py           # Async SQLAlchemy database initialization & migrations
│   ├── models.py             # ORM models (Camera, Person, Event, CameraZone, ShiftTemplate, ShiftSubstitution, User, Role, Section, Leave)
│   ├── schemas.py            # Pydantic validation schemas
│   ├── auth.py               # Password hashing, JWT tokens & RBAC scope helpers
│   ├── face_engine.py        # InsightFace detector & vector matcher
│   ├── shift_utils.py        # Shift windows, rotational schedules & legal break continuity calculations
│   ├── reporting.py          # RTL Persian Excel (.xlsx) & UTF-8 CSV exporters
│   ├── archive_manager.py    # Monthly DB/snapshot archiving & transparent multi-DB querying
│   ├── snapshot_cleanup.py   # Disk usage analysis, hourly retention worker & .env updater
│   ├── stream_processor.py   # Async RTSP ingestion, ROI cropping, watchdog & WebSocket manager
│   └── routers/
│       ├── __init__.py
│       ├── auth.py           # JWT login, token verification & password change
│       ├── break_presets.py  # Scheduled break/rest presets API
│       ├── cameras.py        # Camera API, batch import & live stream endpoints
│       ├── events.py         # Event logs, export & metrics endpoints
│       ├── persons.py        # Person enrollment, editing, shifts, leaves, analytics & re-indexing
│       ├── roles.py          # Dynamic RBAC role & permission registry endpoints
│       ├── sections.py       # Departmental sections API
│       ├── snapshots.py      # Image serving endpoint (active & archived)
│       ├── substitutions.py  # Shift substitutions & conflict detection endpoints
│       ├── system.py         # System settings, runtime config, cleanup & archive endpoints
│       ├── users.py          # User administration & scoped assignment endpoints
│       └── zones.py          # Spatial zones, shift templates, duty roster & supervisor reports
│
├── frontend/                 # Dashboard Frontend App
│   ├── index.html            # Main HTML layout shell (RTL & Persian default)
│   ├── tv.html               # Standalone Factory Hall TV Display (high contrast Grid/List)
│   ├── css/
│   │   ├── style.css         # Glassmorphism dark-theme & RTL typography
│   │   └── tv.css            # High-contrast black canvas styles for Hall TV mode
│   └── js/
│       ├── app.js            # App core, router & WebSocket client
│       ├── auth.js           # JWT authentication manager & permission checks
│       ├── i18n.js           # Internationalization engine, dictionaries & Jalali formatter
│       ├── tv.js             # TV board controller, sound alerts, shortcuts & Grid/List toggle
│       ├── components/
│       │   ├── breakPresets.js           # Scheduled break preset selector & editor
│       │   ├── cameraForm.js             # Camera modal component
│       │   ├── eventCard.js              # Live event card & detail modal
│       │   ├── personAnalyticsModal.js   # Comprehensive 30-day person analytics modal
│       │   ├── personForm.js             # Person enrollment, editing & photo picker modal
│       │   ├── personShiftModal.js       # Per-person shift, break & workstation modal
│       │   ├── settingsModal.js          # Runtime settings, archiving & cleanup modal
│       │   ├── shiftTemplateModal.js     # Shift template & rotational schedule builder modal
│       │   ├── supervisorAnalyticsModal.js # Text-only individual activity modal for supervisors
│       │   ├── supervisorCockpit.js      # Scoped executive cockpit for supervisors
│       │   ├── supervisorLeaveModal.js   # Supervisor daily leave management modal
│       │   ├── supervisorReportModal.js  # Supervisor attendance report viewer & exporter
│       │   ├── supervisorSubstitutionModal.js # Shift substitution & conflict check modal
│       │   └── zoneModal.js              # Interactive canvas zone drawer & shift modal
│       └── pages/
│           ├── cameras.js    # Camera management page view
│           ├── dashboard.js  # Live monitoring dashboard view
│           ├── dutyPage.js   # Live shift roster, absence windows & KPI command center
│           ├── persons.js    # Identity enrollment & edit page view
│           ├── usersPage.js  # User, roles & sections administration view
│           └── zonesPage.js  # Live Presence Board, shift templates & security logs view
│
├── scripts/                  # Management & Maintenance Scripts
│   └── reindex_embeddings.py # CLI script to recompute face embeddings across AI models
│
├── data/                     # Persistent Data Directory (Excluded from git)
│   ├── snapshots/            # Event cropped snapshot JPEGs
│   ├── reference_photos/     # Enrolled person photos
│   └── archives/             # Monthly partitioned DB & snapshot archives
│
└── tests/                    # Comprehensive Pytest Suite
    ├── __init__.py
    ├── test_api.py                           # API integration test suite
    ├── test_archive_api.py                   # Archive settings API tests
    ├── test_archive_manager.py               # Monthly archive partitioning & querying tests
    ├── test_archive_person_analytics.py      # Cross-archive person analytics tests
    ├── test_archive_retention.py             # Archive retention cleanup tests
    ├── test_break_pre_absence.py             # Pre-break & post-break absence continuity tests
    ├── test_break_presets.py                 # Break presets CRUD & application tests
    ├── test_camera_disconnect_isolation.py   # Camera disconnect alert & offline isolation tests
    ├── test_duty_roster.py                   # Live duty roster, break deduction & accumulation tests
    ├── test_enroll_from_event.py             # Enrollment from detection snapshots & multi-photo tests
    ├── test_face_engine.py                   # AI face matcher unit tests
    ├── test_person_analytics.py              # 30-day attendance log & person analytics tests
    ├── test_reports_export.py                # Excel (.xlsx) & CSV report generation tests
    ├── test_rotational_shifts.py             # Rotational shift pattern computation tests
    ├── test_sections_and_scopes.py           # Departmental sections & supervisor scoping tests
    ├── test_shift_substitutions.py           # Shift substitution & conflict check tests
    ├── test_shift_templates_assigned.py      # Shift templates & cross-section preservation tests
    ├── test_snapshot_cleanup.py              # Storage retention & system settings tests
    ├── test_supervisor_privacy_and_leaves.py # Supervisor snapshot privacy & daily leave tests
    └── test_supervisor_report.py             # Supervisor attendance report export tests
```

---

## 📜 License

This project is open-source and released under the **MIT License**. Free for personal, commercial, and enterprise usage.
