"""
Script to recompute all person face embeddings in the database
from the preserved reference photo files using the currently active InsightFace model.

Run this script whenever you switch INSIGHTFACE_MODEL in .env (e.g., from buffalo_l to buffalo_s):
    python -m scripts.reindex_embeddings
"""

import asyncio
import logging
import sys
from pathlib import Path
from sqlalchemy import select

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.config import settings
from backend.database import async_session
from backend.face_engine import face_engine
from backend.models import PersonEmbedding, Person

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reindex_embeddings")


async def reindex_embeddings() -> None:
    logger.info("Initializing FaceEngine with model='%s'...", settings.insightface_model)
    face_engine.init()

    async with async_session() as session:
        result = await session.execute(
            select(PersonEmbedding, Person.name)
            .join(Person, Person.id == PersonEmbedding.person_id)
        )
        rows = result.all()

        if not rows:
            logger.info("No person embeddings found in the database.")
            return

        logger.info("Found %d embedding records to re-index.", len(rows))
        success_count = 0
        failed_count = 0

        for emb, person_name in rows:
            photo_path = Path(emb.reference_photo_path)
            if not photo_path.exists():
                logger.warning(
                    "Photo file missing for %s (person_id=%d): %s",
                    person_name,
                    emb.person_id,
                    photo_path,
                )
                failed_count += 1
                continue

            try:
                img_bytes = photo_path.read_bytes()
                new_vec = face_engine.extract_embedding_from_photo(img_bytes)

                if new_vec is not None:
                    emb.embedding = new_vec.tolist()
                    success_count += 1
                    logger.info("Successfully re-indexed photo for '%s' (ID %d)", person_name, emb.person_id)
                else:
                    logger.warning(
                        "No face detected in photo for '%s' (ID %d) using model '%s'",
                        person_name,
                        emb.person_id,
                        settings.insightface_model,
                    )
                    failed_count += 1
            except Exception as e:
                logger.error("Error processing photo %s: %s", photo_path, e)
                failed_count += 1

        if success_count > 0:
            await session.commit()
            logger.info(
                "Re-indexing complete: %d embeddings updated, %d failed.",
                success_count,
                failed_count,
            )
        else:
            logger.warning("No embeddings were updated.")


if __name__ == "__main__":
    asyncio.run(reindex_embeddings())
