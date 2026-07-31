"""
Person (identity) management API router.

Endpoints:
  GET    /api/persons              — List all known persons
  POST   /api/persons              — Create a person with reference photos
  GET    /api/persons/{id}         — Get person details
  PUT    /api/persons/{id}         — Update person name/role
  DELETE /api/persons/{id}         — Delete person and all embeddings
  POST   /api/persons/{id}/photos  — Add more reference photos
"""

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.face_engine import face_engine
from backend.models import Person, PersonEmbedding
from backend.schemas import PersonResponse, PersonUpdate
from backend.stream_processor import stream_processor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/persons", tags=["persons"])


def _build_person_response(person: Person, embeddings: list[PersonEmbedding]) -> dict:
    """Build a PersonResponse dict from ORM objects."""
    return {
        "id": person.id,
        "name": person.name,
        "role": person.role,
        "embedding_count": len(embeddings),
        "reference_photos": [
            f"/api/snapshots/ref_{Path(e.reference_photo_path).name}"
            for e in embeddings
        ],
        "created_at": person.created_at,
    }


@router.get("", response_model=list[PersonResponse])
async def list_persons(db: AsyncSession = Depends(get_db)):
    """List all known persons with their embedding counts."""
    result = await db.execute(select(Person).order_by(Person.name))
    persons = result.scalars().all()

    responses = []
    for person in persons:
        emb_result = await db.execute(
            select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
        )
        embeddings = emb_result.scalars().all()
        responses.append(_build_person_response(person, embeddings))

    return responses


@router.post("", response_model=PersonResponse, status_code=status.HTTP_201_CREATED)
async def create_person(
    name: str = Form(...),
    role: str = Form(default=""),
    photos: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new known person by uploading one or more reference photos.
    Each photo is processed to extract a 512-d face embedding.
    """
    if not photos:
        raise HTTPException(
            status_code=400,
            detail="At least one reference photo is required.",
        )

    # Create person record
    person = Person(name=name, role=role)
    db.add(person)
    await db.commit()
    await db.refresh(person)

    # Process each reference photo
    embeddings_created: list[PersonEmbedding] = []

    for photo in photos:
        image_bytes = await photo.read()

        # Extract face embedding
        embedding = face_engine.extract_embedding_from_photo(image_bytes)

        if embedding is None:
            logger.warning(
                "No face detected in photo '%s' for person '%s'. Skipping.",
                photo.filename,
                name,
            )
            continue

        # Save reference photo to disk
        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)

        with open(ref_path, "wb") as f:
            f.write(image_bytes)

        # Store embedding in database
        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        embeddings_created.append(person_emb)

    if not embeddings_created:
        # Rollback: delete the person if no valid embeddings were created
        await db.delete(person)
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="No faces could be detected in any of the uploaded photos.",
        )

    await db.commit()

    # Refresh the known persons cache in the stream processor
    await stream_processor.refresh_known_persons()

    logger.info(
        "Person created: id=%d name='%s' embeddings=%d",
        person.id,
        name,
        len(embeddings_created),
    )

    return _build_person_response(person, embeddings_created)


@router.get("/{person_id}", response_model=PersonResponse)
async def get_person(person_id: int, db: AsyncSession = Depends(get_db)):
    """Get details for a specific person."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)


@router.put("/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: int,
    data: PersonUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a person's name or role."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if data.name is not None:
        person.name = data.name
    if data.role is not None:
        person.role = data.role

    await db.commit()
    await db.refresh(person)

    # Refresh cache
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)


@router.delete("/{person_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_person(person_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a person and all their embeddings and reference photos."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Delete reference photo files
    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    for emb in emb_result.scalars().all():
        try:
            Path(emb.reference_photo_path).unlink(missing_ok=True)
        except Exception as e:
            logger.warning("Failed to delete reference photo: %s", e)

    await db.delete(person)
    await db.commit()

    # Refresh cache
    await stream_processor.refresh_known_persons()

    logger.info("Person deleted: id=%d", person_id)


@router.post("/{person_id}/photos", response_model=PersonResponse)
async def add_photos(
    person_id: int,
    photos: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Add additional reference photos for an existing person."""
    person = await db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    added = 0

    for photo in photos:
        image_bytes = await photo.read()
        embedding = face_engine.extract_embedding_from_photo(image_bytes)

        if embedding is None:
            logger.warning("No face in photo '%s', skipping.", photo.filename)
            continue

        ext = Path(photo.filename or "photo.jpg").suffix or ".jpg"
        ref_filename = f"{uuid.uuid4().hex}{ext}"
        ref_path = Path(settings.reference_photo_dir) / ref_filename
        ref_path.parent.mkdir(parents=True, exist_ok=True)

        with open(ref_path, "wb") as f:
            f.write(image_bytes)

        person_emb = PersonEmbedding(
            person_id=person.id,
            embedding=embedding.tolist(),
            reference_photo_path=str(ref_path),
        )
        db.add(person_emb)
        added += 1

    if added == 0:
        raise HTTPException(
            status_code=400,
            detail="No faces detected in any of the uploaded photos.",
        )

    await db.commit()
    await stream_processor.refresh_known_persons()

    emb_result = await db.execute(
        select(PersonEmbedding).where(PersonEmbedding.person_id == person.id)
    )
    embeddings = emb_result.scalars().all()

    return _build_person_response(person, embeddings)
