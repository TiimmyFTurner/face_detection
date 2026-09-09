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
import concurrent.futures
import logging

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from typing import Union

from backend.auth import require_permission
from backend.database import get_db
from backend.models import Camera
from backend.schemas import CameraCreate, CameraBatchCreate, CameraUpdate, CameraResponse, CameraTestResult
from backend.stream_processor import stream_processor

test_executor = concurrent.futures.ThreadPoolExecutor(max_workers=8, thread_name_prefix="cam-test")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


@router.get("", response_model=list[CameraResponse])
async def list_cameras(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:view")),
):
    """List all configured cameras with real-time streaming status."""
    result = await db.execute(select(Camera).order_by(Camera.created_at.desc()))
    cameras = result.scalars().all()
    response = []
    for c in cameras:
        cr = CameraResponse.model_validate(c)
        cr.is_online = stream_processor.is_camera_online(c.id) if c.is_active else False
        response.append(cr)
    return response


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(
    data: CameraCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:create")),
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


@router.post("/batch", response_model=list[CameraResponse], status_code=status.HTTP_201_CREATED)
async def create_cameras_batch(
    data: Union[CameraBatchCreate, list[CameraCreate]],
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:create")),
):
    """Add multiple individual cameras in batch. Each camera is stored and operated independently."""
    camera_items = data.cameras if isinstance(data, CameraBatchCreate) else data
    if not camera_items:
        raise HTTPException(status_code=400, detail="No cameras provided")

    created_cameras = []
    for item in camera_items:
        cam = Camera(
            name=item.name,
            rtsp_url=item.rtsp_url,
            location=item.location,
            is_active=item.is_active,
        )
        db.add(cam)
        created_cameras.append(cam)

    await db.commit()

    response = []
    for cam in created_cameras:
        await db.refresh(cam)
        # Each individual camera gets its own independent stream task
        if cam.is_active:
            await stream_processor.start_camera(cam.id, cam.name, cam.rtsp_url)
        cr = CameraResponse.model_validate(cam)
        cr.is_online = stream_processor.is_camera_online(cam.id) if cam.is_active else False
        response.append(cr)
        logger.info("Batch individual camera created: id=%d name='%s'", cam.id, cam.name)

    return response


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:view")),
):
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
    _user=Depends(require_permission("cameras:edit")),
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
async def delete_camera(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:delete")),
):
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
async def test_camera(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:test")),
):
    """Test an RTSP connection and return a thumbnail if successful."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    return await _test_rtsp_connection(camera.rtsp_url)


@router.post("/test-url", response_model=CameraTestResult)
async def test_camera_url(
    data: CameraCreate,
    _user=Depends(require_permission("cameras:test")),
):
    """Test an RTSP URL without saving the camera."""
    return await _test_rtsp_connection(data.rtsp_url)


def _open_and_read_test(rtsp_url: str):
    cap = cv2.VideoCapture()
    try:
        if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)

        opened = cap.open(rtsp_url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
        ]) if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC") else cap.open(rtsp_url)

        if not opened or not cap.isOpened():
            return False, None, "Cannot connect to RTSP stream (timeout or unreachable)."

        ret, frame = cap.read()
        if not ret or frame is None:
            return False, None, "Connected but failed to read frame."

        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        thumbnail_b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")
        return True, thumbnail_b64, "Connection successful."
    except Exception as e:
        return False, None, f"Connection error: {str(e)}"
    finally:
        try:
            cap.release()
        except Exception:
            pass


async def _test_rtsp_connection(rtsp_url: str) -> CameraTestResult:
    """Test an RTSP connection and capture a thumbnail without blocking event loop or other streams."""
    loop = asyncio.get_running_loop()
    success, thumb, msg = await loop.run_in_executor(test_executor, _open_and_read_test, rtsp_url)
    return CameraTestResult(
        success=success,
        message=msg,
        thumbnail_base64=thumb,
    )


def _generate_offline_frame(camera_name: str, message: str = "Camera Offline / Reconnecting...") -> bytes:
    """Generate a clean dark placeholder frame with status for offline cameras."""
    img = np.full((360, 640, 3), (26, 17, 15), dtype=np.uint8)  # Slate dark bg (BGR: #0f111a)
    cv2.rectangle(img, (15, 15), (625, 345), (45, 33, 24), 2)
    cv2.putText(img, "[ CAMERA OFFLINE ]", (185, 125), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 200, 255), 2, cv2.LINE_AA)
    safe_name = str(camera_name)[:28]
    cv2.putText(img, safe_name, (180, 175), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (240, 240, 240), 2, cv2.LINE_AA)
    safe_msg = str(message)[:38]
    cv2.putText(img, safe_msg, (120, 225), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (160, 160, 160), 1, cv2.LINE_AA)
    cv2.putText(img, "Waiting for stream connection...", (185, 265), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 116, 139), 1, cv2.LINE_AA)
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return buf.tobytes()


@router.get("/{camera_id}/snapshot")
async def get_camera_snapshot(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:view")),
):
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

    # Return clean placeholder frame instead of 503 so browser img tag does not break
    offline_frame = _generate_offline_frame(camera.name, test_res.message or "Camera offline")
    return Response(
        content=offline_frame,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@router.get("/{camera_id}/stream")
async def get_camera_stream(
    camera_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_permission("cameras:view")),
):
    """Stream live camera frames as MJPEG video."""
    camera = await db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    async def frame_generator():
        last_online = False
        offline_frame_bytes = None
        while True:
            jpeg_bytes = stream_processor.get_latest_frame(camera_id)
            if jpeg_bytes:
                last_online = True
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg_bytes + b"\r\n"
                )
                await asyncio.sleep(0.1)  # ~10 FPS
            else:
                # Camera is offline / reconnecting: yield standby placeholder frame
                if offline_frame_bytes is None or last_online:
                    offline_frame_bytes = _generate_offline_frame(camera.name, "Camera Offline / Reconnecting...")
                    last_online = False
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + offline_frame_bytes + b"\r\n"
                )
                await asyncio.sleep(1.0)  # 1 FPS standby

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
