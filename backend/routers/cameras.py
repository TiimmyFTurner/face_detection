"""
Camera management API router.

Endpoints:
  GET    /api/cameras         — List all cameras
  POST   /api/cameras         — Add a new camera
  GET    /api/cameras/{id}    — Get camera details
  PUT    /api/cameras/{id}    — Update camera configuration
  DELETE /api/cameras/{id}    — Remove a camera
  POST   /api/cameras/{id}/test — Test RTSP connection
"""

import asyncio
import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.models import Camera
from backend.schemas import CameraCreate, CameraUpdate, CameraResponse, CameraTestResult
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraResponse])
async def list_cameras(db: AsyncSession = Depends(get_db)):
    """List all configured cameras."""
    result = await db.execute(select(Camera).order_by(Camera.created_at.desc()))
    cameras = result.scalars().all()
    return cameras


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(
    data: CameraCreate,
    db: AsyncSession = Depends(get_db),
):
    """Add a new camera and optionally start its stream."""
    camera = Camera(
        name=data.name,
        rtsp_url=data.rtsp_url,
        location=data.location,
        is_active=data.is_active,
    )
    db.add(camera)
    await db.commit()
    await db.refresh(camera)

    # Start stream if active
    if camera.is_active:
        await stream_processor.start_camera(camera.id, camera.name, camera.rtsp_url)

    logger.info("Camera created: id=%d name='%s'", camera.id, camera.name)
    return camera


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(camera_id: int, db: AsyncSession = Depends(get_db)):
    """Get details for a specific camera."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return camera


@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: int,
    data: CameraUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update camera configuration. Restarts stream if URL or active state changes."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    url_changed = False
    active_changed = False

    if data.name is not None:
        camera.name = data.name
    if data.rtsp_url is not None and data.rtsp_url != camera.rtsp_url:
        camera.rtsp_url = data.rtsp_url
        url_changed = True
    if data.location is not None:
        camera.location = data.location
    if data.is_active is not None and data.is_active != camera.is_active:
        camera.is_active = data.is_active
        active_changed = True

    await db.commit()
    await db.refresh(camera)

    # Restart or stop stream as needed
    if url_changed or active_changed:
        if camera.is_active:
            await stream_processor.start_camera(camera.id, camera.name, camera.rtsp_url)
        else:
            await stream_processor.stop_camera(camera.id)

    return camera


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_camera(camera_id: int, db: AsyncSession = Depends(get_db)):
    """Remove a camera and stop its stream."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Stop stream first
    await stream_processor.stop_camera(camera_id)

    await db.delete(camera)
    await db.commit()
    logger.info("Camera deleted: id=%d", camera_id)


@router.post("/{camera_id}/test", response_model=CameraTestResult)
async def test_camera(camera_id: int, db: AsyncSession = Depends(get_db)):
    """Test an RTSP connection and return a thumbnail if successful."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    return await _test_rtsp_connection(camera.rtsp_url)


@router.post("/test-url", response_model=CameraTestResult)
async def test_camera_url(data: CameraCreate):
    """Test an RTSP URL without saving the camera."""
    return await _test_rtsp_connection(data.rtsp_url)


async def _test_rtsp_connection(rtsp_url: str) -> CameraTestResult:
    """Test an RTSP connection and capture a thumbnail."""
    try:
        loop = asyncio.get_event_loop()
        cap = await loop.run_in_executor(None, lambda: cv2.VideoCapture(rtsp_url))

        if not cap.isOpened():
            return CameraTestResult(success=False, message="Cannot connect to RTSP stream.")

        ret, frame = await loop.run_in_executor(None, cap.read)
        await loop.run_in_executor(None, cap.release)

        if not ret or frame is None:
            return CameraTestResult(success=False, message="Connected but failed to read frame.")

        # Encode thumbnail as base64 JPEG
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        thumbnail_b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")

        return CameraTestResult(
            success=True,
            message="Connection successful.",
            thumbnail_base64=thumbnail_b64,
        )

    except Exception as e:
        return CameraTestResult(success=False, message=f"Connection error: {str(e)}")


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(camera_id: int, db: AsyncSession = Depends(get_db)):
    """Return a single JPEG snapshot of the camera's current view."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Try getting frame from running stream processor
    jpeg_bytes = stream_processor.get_latest_frame(camera_id)
    if jpeg_bytes:
        return Response(
            content=jpeg_bytes,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    # Fallback: grab frame directly on demand
    test_res = await _test_rtsp_connection(camera.rtsp_url)
    if test_res.success and test_res.thumbnail_base64:
        raw_bytes = base64.b64decode(test_res.thumbnail_base64)
        return Response(
            content=raw_bytes,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    raise HTTPException(status_code=503, detail=f"Camera feed unavailable: {test_res.message}")


@router.get("/{camera_id}/stream")
async def get_camera_stream(camera_id: int, db: AsyncSession = Depends(get_db)):
    """Stream live camera frames as MJPEG video."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    async def frame_generator():
        while True:
            jpeg_bytes = stream_processor.get_latest_frame(camera_id)
            if not jpeg_bytes:
                test_res = await _test_rtsp_connection(camera.rtsp_url)
                if test_res.success and test_res.thumbnail_base64:
                    jpeg_bytes = base64.b64decode(test_res.thumbnail_base64)

            if jpeg_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
                )
            await asyncio.sleep(0.1)  # ~10 FPS

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
