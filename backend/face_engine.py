"""
Face detection & recognition engine powered by InsightFace (ArcFace).

Provides a singleton wrapper that:
  - Initializes the InsightFace FaceAnalysis pipeline (SCRFD detection + ArcFace recognition)
  - Detects faces and extracts 512-d embeddings from video frames
  - Matches embeddings against a database of known individuals via cosine similarity
  - Extracts embeddings from uploaded reference photos for enrollment
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np
from numpy.typing import NDArray

from backend.config import settings

logger = logging.getLogger(__name__)


@dataclass
class DetectedFace:
    """A single detected face with its bounding box and embedding."""
    bbox: tuple[int, int, int, int]  # (x1, y1, x2, y2)
    embedding: NDArray[np.float32]   # 512-d vector
    det_score: float                 # Detection confidence


@dataclass
class MatchResult:
    """Result of comparing a face embedding against known persons."""
    person_id: Optional[int] = None
    person_name: str = "Unknown"
    confidence: float = 0.0
    is_known: bool = False


@dataclass
class KnownPerson:
    """A known person with their precomputed embeddings."""
    person_id: int
    person_name: str
    embeddings: list[NDArray[np.float32]] = field(default_factory=list)


class FaceEngine:
    """
    Singleton face detection and recognition engine.

    Usage:
        engine = FaceEngine()
        engine.init()  # Call once at startup
        faces = engine.detect_and_embed(frame)
        match = engine.match(face.embedding, known_persons)
    """

    _instance: Optional["FaceEngine"] = None
    _initialized: bool = False

    def __new__(cls) -> "FaceEngine":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def init(self) -> None:
        """Initialize the InsightFace model pipeline."""
        if self._initialized:
            logger.info("FaceEngine already initialized, skipping.")
            return

        try:
            from insightface.app import FaceAnalysis

            logger.info(
                "Initializing InsightFace with model='%s'...",
                settings.insightface_model,
            )

            # Try GPU first, fall back to CPU
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            self._app = FaceAnalysis(
                name=settings.insightface_model,
                providers=providers,
            )
            self._app.prepare(ctx_id=0, det_size=(640, 640))

            self._initialized = True
            logger.info("FaceEngine initialized successfully.")

        except Exception as e:
            logger.error("Failed to initialize FaceEngine: %s", e)
            raise RuntimeError(f"FaceEngine initialization failed: {e}") from e

    @property
    def is_ready(self) -> bool:
        """Check if the engine is initialized and ready."""
        return self._initialized

    def detect_and_embed(self, frame: NDArray[np.uint8]) -> list[DetectedFace]:
        """
        Detect all faces in a frame and compute their 512-d embeddings.

        Args:
            frame: BGR image as numpy array (from OpenCV).

        Returns:
            List of DetectedFace objects with bounding boxes and embeddings.
        """
        if not self._initialized:
            raise RuntimeError("FaceEngine not initialized. Call init() first.")

        results: list[DetectedFace] = []

        try:
            faces = self._app.get(frame)

            for face in faces:
                # Skip faces with no embedding (detection-only models)
                if face.embedding is None:
                    continue

                bbox = tuple(int(v) for v in face.bbox)
                results.append(
                    DetectedFace(
                        bbox=(bbox[0], bbox[1], bbox[2], bbox[3]),
                        embedding=face.embedding.astype(np.float32),
                        det_score=float(face.det_score),
                    )
                )

        except Exception as e:
            logger.warning("Face detection failed on frame: %s", e)

        return results

    def match(
        self,
        embedding: NDArray[np.float32],
        known_persons: list[KnownPerson],
    ) -> MatchResult:
        """
        Compare a face embedding against all known persons using cosine similarity.

        The best match above the configured threshold is returned.

        Args:
            embedding: 512-d face embedding to match.
            known_persons: List of KnownPerson objects with precomputed embeddings.

        Returns:
            MatchResult with person info and confidence, or Unknown if no match.
        """
        if not known_persons:
            return MatchResult()

        best_score = -1.0
        best_person: Optional[KnownPerson] = None

        # Normalize the query embedding
        query_norm = embedding / (np.linalg.norm(embedding) + 1e-10)

        for person in known_persons:
            for ref_embedding in person.embeddings:
                # Cosine similarity: dot product of normalized vectors
                ref_norm = ref_embedding / (np.linalg.norm(ref_embedding) + 1e-10)
                score = float(np.dot(query_norm, ref_norm))

                if score > best_score:
                    best_score = score
                    best_person = person

        # Check against threshold
        if best_person is not None and best_score >= settings.match_threshold:
            return MatchResult(
                person_id=best_person.person_id,
                person_name=best_person.person_name,
                confidence=best_score,
                is_known=True,
            )

        return MatchResult(confidence=max(best_score, 0.0))

    def extract_embedding_from_photo(self, image_bytes: bytes) -> Optional[NDArray[np.float32]]:
        """
        Extract the face embedding from a reference photo (for person enrollment).

        Args:
            image_bytes: Raw image bytes (JPEG/PNG).

        Returns:
            512-d embedding array, or None if no face detected.
        """
        if not self._initialized:
            raise RuntimeError("FaceEngine not initialized. Call init() first.")

        try:
            # Decode image from bytes
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            if img is None:
                logger.warning("Failed to decode image from bytes.")
                return None

            faces = self._app.get(img)

            if not faces:
                logger.warning("No face detected in reference photo.")
                return None

            # Use the face with highest detection score
            best_face = max(faces, key=lambda f: f.det_score)

            if best_face.embedding is None:
                logger.warning("Face detected but no embedding generated.")
                return None

            return best_face.embedding.astype(np.float32)

        except Exception as e:
            logger.error("Embedding extraction failed: %s", e)
            return None

    def crop_face(
        self,
        frame: NDArray[np.uint8],
        bbox: tuple[int, int, int, int],
        padding: float = 0.7,
    ) -> NDArray[np.uint8]:
        """
        Crop a face region from a frame with padding.

        Args:
            frame: Full BGR image.
            bbox: (x1, y1, x2, y2) bounding box.
            padding: Fractional padding around the face (0.7 = 70%).

        Returns:
            Cropped face image as numpy array.
        """
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = bbox

        # Add padding
        face_w = x2 - x1
        face_h = y2 - y1
        pad_x = int(face_w * padding)
        pad_y = int(face_h * padding)

        x1 = max(0, x1 - pad_x)
        y1 = max(0, y1 - pad_y)
        x2 = min(w, x2 + pad_x)
        y2 = min(h, y2 + pad_y)

        return frame[y1:y2, x1:x2].copy()


# Module-level singleton
face_engine = FaceEngine()
