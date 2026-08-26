"""
SQLAlchemy ORM models for the Face Tracking & Logging System.

Models:
  - Camera: IP camera configuration
  - Person: Known individual identity
  - PersonEmbedding: 512-d face vector for a person's reference photo
  - Event: Detection/recognition log entry
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, JSON
)
from sqlalchemy.orm import relationship

from backend.database import Base


def _utcnow() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc)


class Camera(Base):
    """IP camera configuration and state."""

    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    rtsp_url = Column(Text, nullable=False)
    location = Column(String(255), default="")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # Relationships
    events = relationship("Event", back_populates="camera", cascade="all, delete-orphan")
    zones = relationship("CameraZone", back_populates="camera", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<Camera id={self.id} name='{self.name}' active={self.is_active}>"


class CameraZone(Base):
    """An important designated area (ROI) defined on a camera."""

    __tablename__ = "camera_zones"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)  # e.g. "Work Desk", "Main Counter"
    x = Column(Float, nullable=False)           # % (0-100) left
    y = Column(Float, nullable=False)           # % (0-100) top
    width = Column(Float, nullable=False)       # % (0-100) width
    height = Column(Float, nullable=False)      # % (0-100) height
    alert_mode = Column(String(50), default="absence")  # "absence", "presence", "unauthorized", "both"
    assigned_person_ids = Column(JSON, default=list)    # List of Person IDs
    start_time = Column(String(10), default="00:00")    # HH:MM format
    end_time = Column(String(10), default="23:59")      # HH:MM format
    active_days = Column(JSON, default=lambda: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # Relationships
    camera = relationship("Camera", back_populates="zones")

    def __repr__(self) -> str:
        return f"<CameraZone id={self.id} camera_id={self.camera_id} name='{self.name}'>"


class Person(Base):
    """A known individual enrolled in the system."""

    __tablename__ = "persons"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    role = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), default=_utcnow)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow)

    # Relationships
    embeddings = relationship(
        "PersonEmbedding", back_populates="person", cascade="all, delete-orphan"
    )
    events = relationship("Event", back_populates="person")

    def __repr__(self) -> str:
        return f"<Person id={self.id} name='{self.name}'>"


class PersonEmbedding(Base):
    """
    A single 512-dimensional face embedding computed from a reference photo.
    Multiple embeddings per person improves matching accuracy across angles/lighting.
    """

    __tablename__ = "person_embeddings"

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)
    embedding = Column(JSON, nullable=False)  # List of 512 floats
    reference_photo_path = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow)

    # Relationships
    person = relationship("Person", back_populates="embeddings")

    def __repr__(self) -> str:
        return f"<PersonEmbedding id={self.id} person_id={self.person_id}>"


class Event(Base):
    """A face detection/recognition event logged from a camera stream."""

    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime(timezone=True), default=_utcnow, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="SET NULL"), nullable=True)
    person_name = Column(String(255), default="Unknown")
    confidence_score = Column(Float, default=0.0)
    snapshot_path = Column(Text, nullable=False)
    is_known = Column(Boolean, default=False, index=True)
    zone_id = Column(Integer, nullable=True)
    zone_name = Column(String(255), default="")
    alert_type = Column(String(50), default="normal")  # "normal", "out_of_zone", "unauthorized_entry", "absence_timeout"
    duration_seconds = Column(Integer, nullable=True, default=None)

    # Relationships
    camera = relationship("Camera", back_populates="events")
    person = relationship("Person", back_populates="events")

    def __repr__(self) -> str:
        return (
            f"<Event id={self.id} person='{self.person_name}' "
            f"confidence={self.confidence_score:.2f} known={self.is_known} alert={self.alert_type}>"
        )
