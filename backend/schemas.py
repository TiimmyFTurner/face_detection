"""
Pydantic v2 schemas for API request/response validation.
"""

import json
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field, field_validator


# ═══════════════════════════════════════════════════════════
# Camera Schemas
# ═══════════════════════════════════════════════════════════

class CameraCreate(BaseModel):
    """Schema for creating a new camera."""
    name: str = Field(..., min_length=1, max_length=255, examples=["Front Door"])
    rtsp_url: str = Field(..., min_length=1, examples=["rtsp://admin:pass@192.168.1.100:554/stream"])
    location: str = Field(default="", max_length=255, examples=["Main Entrance"])
    is_active: bool = Field(default=True)


class CameraUpdate(BaseModel):
    """Schema for updating a camera (all fields optional)."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    rtsp_url: Optional[str] = Field(None, min_length=1)
    location: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None


class CameraResponse(BaseModel):
    """Schema for camera API responses."""
    id: int
    name: str
    rtsp_url: str
    location: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CameraTestResult(BaseModel):
    """Result of testing an RTSP camera connection."""
    success: bool
    message: str
    thumbnail_base64: Optional[str] = None


# ═══════════════════════════════════════════════════════════
# Person Schemas
# ═══════════════════════════════════════════════════════════

class PersonCreate(BaseModel):
    """Schema for creating a new person (photos uploaded separately as multipart)."""
    name: str = Field(..., min_length=1, max_length=255, examples=["John Doe"])
    role: str = Field(default="", max_length=255, examples=["Employee"])


class PersonUpdate(BaseModel):
    """Schema for updating a person."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    role: Optional[str] = Field(None, max_length=255)


class PersonResponse(BaseModel):
    """Schema for person API responses."""
    id: int
    name: str
    role: str
    embedding_count: int = 0
    reference_photos: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════
# Camera Zone (Important Area) Schemas
# ═══════════════════════════════════════════════════════════

class CameraZoneCreate(BaseModel):
    """Schema for creating a camera important area."""
    name: str = Field(..., min_length=1, max_length=255, examples=["Work Desk"])
    x: float = Field(..., ge=0.0, le=100.0, description="Top-left X (%)")
    y: float = Field(..., ge=0.0, le=100.0, description="Top-left Y (%)")
    width: float = Field(..., gt=0.0, le=100.0, description="Width (%)")
    height: float = Field(..., gt=0.0, le=100.0, description="Height (%)")
    alert_mode: str = Field(default="absence", description="'absence', 'presence', or 'unauthorized'")
    assigned_person_ids: list[int] = Field(default_factory=list)
    start_time: str = Field(default="00:00", description="Shift start time HH:MM")
    end_time: str = Field(default="23:59", description="Shift end time HH:MM")
    active_days: list[str] = Field(default_factory=lambda: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    is_active: bool = Field(default=True)


class CameraZoneUpdate(BaseModel):
    """Schema for updating a camera zone."""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    x: Optional[float] = Field(None, ge=0.0, le=100.0)
    y: Optional[float] = Field(None, ge=0.0, le=100.0)
    width: Optional[float] = Field(None, gt=0.0, le=100.0)
    height: Optional[float] = Field(None, gt=0.0, le=100.0)
    alert_mode: Optional[str] = None
    assigned_person_ids: Optional[list[int]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    active_days: Optional[list[str]] = None
    is_active: Optional[bool] = None


class CameraZoneResponse(BaseModel):
    """Schema for camera zone response."""
    id: int
    camera_id: int
    name: str
    x: float
    y: float
    width: float
    height: float
    alert_mode: str = "absence"
    assigned_person_ids: list[int] = []
    start_time: str = "00:00"
    end_time: str = "23:59"
    active_days: list[str] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    is_active: bool = True
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("assigned_person_ids", mode="before")
    @classmethod
    def parse_assigned_persons(cls, v: Any) -> list[int]:
        if v is None:
            return []
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [int(x) for x in parsed if str(x).isdigit()]
            except Exception:
                return []
        if isinstance(v, list):
            return [int(x) for x in v if str(x).isdigit()]
        return []

    @field_validator("active_days", mode="before")
    @classmethod
    def parse_active_days(cls, v: Any) -> list[str]:
        default_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        if v is None:
            return default_days
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list) and len(parsed) > 0:
                    return [str(d) for d in parsed]
            except Exception:
                return default_days
        if isinstance(v, list) and len(v) > 0:
            return [str(d) for d in v]
        return default_days

    @field_validator("start_time", mode="before")
    @classmethod
    def parse_start_time(cls, v: Any) -> str:
        return str(v) if v else "00:00"

    @field_validator("end_time", mode="before")
    @classmethod
    def parse_end_time(cls, v: Any) -> str:
        return str(v) if v else "23:59"

    @field_validator("alert_mode", mode="before")
    @classmethod
    def parse_alert_mode(cls, v: Any) -> str:
        return str(v) if v else "absence"

    @field_validator("is_active", mode="before")
    @classmethod
    def parse_is_active(cls, v: Any) -> bool:
        return True if v is None else bool(v)

    model_config = {"from_attributes": True}


class ZonePersonStatus(BaseModel):
    """Real-time presence state for an assigned individual."""
    person_id: int
    person_name: str
    status: str  # "present", "absent", "off_duty"
    last_seen_seconds_ago: Optional[float] = None
    last_seen_str: str = ""
    minutes_absent: Optional[int] = None


class ZoneStatusResponse(BaseModel):
    """Real-time status report for a zone."""
    zone_id: int
    zone_name: str
    camera_id: int
    camera_name: str
    is_in_schedule: bool
    timetable_text: str
    alert_mode: str
    assigned_persons: list[ZonePersonStatus] = []


# ═══════════════════════════════════════════════════════════
# Event Schemas
# ═══════════════════════════════════════════════════════════

class EventResponse(BaseModel):
    """Schema for event API responses."""
    id: int
    timestamp: datetime
    camera_id: Optional[int] = None
    camera_name: str = ""
    person_id: Optional[int] = None
    person_name: str
    confidence_score: float
    snapshot_path: str
    snapshot_url: str = ""
    is_known: bool
    zone_id: Optional[int] = None
    zone_name: str = ""
    alert_type: str = "normal"  # "normal", "out_of_zone", "unauthorized_entry", "absence_timeout"
    duration_seconds: Optional[int] = None
    duration_str: Optional[str] = None

    model_config = {"from_attributes": True}


class EventListResponse(BaseModel):
    """Paginated event listing response."""
    events: list[EventResponse]
    total: int
    limit: int
    offset: int


class EventStats(BaseModel):
    """Summary statistics for events."""
    total_today: int = 0
    known_today: int = 0
    unknown_today: int = 0
    active_cameras: int = 0


# ═══════════════════════════════════════════════════════════
# WebSocket Event Schema
# ═══════════════════════════════════════════════════════════

class WSEvent(BaseModel):
    """Real-time event pushed via WebSocket."""
    type: str = "new_event"
    event: EventResponse


# ═══════════════════════════════════════════════════════════
# System Settings Schemas
# ═══════════════════════════════════════════════════════════

class SystemSettingsResponse(BaseModel):
    """Current runtime settings of the system."""
    save_snapshots: bool
    match_threshold: float
    cooldown_seconds: int
    frame_skip: int
    downscale_factor: float


class SystemSettingsUpdate(BaseModel):
    """Update runtime settings of the system."""
    save_snapshots: Optional[bool] = None
    match_threshold: Optional[float] = None
    cooldown_seconds: Optional[int] = None
    frame_skip: Optional[int] = None
    downscale_factor: Optional[float] = None
