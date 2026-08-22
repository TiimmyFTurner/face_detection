"""
Pydantic v2 schemas for API request/response validation.
"""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


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
    alert_mode: str
    assigned_person_ids: list[int] = []
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


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
    alert_type: str = "normal"  # "normal", "out_of_zone", "unauthorized_entry"

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
