"""
Unit tests for the FaceEngine class.
Tests the matching logic with mock embeddings (does not require insightface installed).
"""

import numpy as np
import pytest

from backend.face_engine import FaceEngine, KnownPerson, MatchResult


class TestFaceEngineMatching:
    """Test the cosine similarity matching logic."""

    def setup_method(self):
        """Create a fresh FaceEngine instance for testing (without initializing insightface)."""
        # Reset singleton for testing
        FaceEngine._instance = None
        FaceEngine._initialized = False
        self.engine = FaceEngine()

    def _make_embedding(self, seed: int = 0) -> np.ndarray:
        """Generate a deterministic 512-d embedding for testing."""
        rng = np.random.RandomState(seed)
        emb = rng.randn(512).astype(np.float32)
        return emb / np.linalg.norm(emb)  # Normalize

    def test_match_no_known_persons(self):
        """Matching with no known persons should return Unknown."""
        query = self._make_embedding(seed=42)
        result = self.engine.match(query, [])
        assert result.is_known is False
        assert result.person_name == "Unknown"

    def test_match_identical_embedding(self):
        """An identical embedding should match with ~1.0 confidence."""
        emb = self._make_embedding(seed=1)
        known = [
            KnownPerson(
                person_id=1,
                person_name="Alice",
                embeddings=[emb.copy()],
            )
        ]
        result = self.engine.match(emb, known)
        assert result.is_known is True
        assert result.person_name == "Alice"
        assert result.confidence > 0.99

    def test_match_similar_embedding(self):
        """A similar embedding (slight noise) should still match above threshold."""
        emb = self._make_embedding(seed=2)
        # Add small noise
        noise = np.random.RandomState(99).randn(512).astype(np.float32) * 0.05
        noisy_emb = emb + noise

        known = [
            KnownPerson(
                person_id=2,
                person_name="Bob",
                embeddings=[emb],
            )
        ]
        result = self.engine.match(noisy_emb, known)
        assert result.is_known is True
        assert result.person_name == "Bob"
        assert result.confidence > 0.5

    def test_match_different_embedding_below_threshold(self):
        """A very different embedding should not match."""
        emb1 = self._make_embedding(seed=10)
        emb2 = self._make_embedding(seed=20)

        known = [
            KnownPerson(
                person_id=3,
                person_name="Charlie",
                embeddings=[emb1],
            )
        ]
        result = self.engine.match(emb2, known)
        # With random orthogonal embeddings, cosine similarity should be near 0
        assert result.is_known is False
        assert result.confidence < 0.5

    def test_match_best_of_multiple_persons(self):
        """When multiple persons exist, the best match should be returned."""
        query = self._make_embedding(seed=5)
        noise = np.random.RandomState(77).randn(512).astype(np.float32) * 0.03

        known = [
            KnownPerson(
                person_id=1,
                person_name="Alice",
                embeddings=[self._make_embedding(seed=100)],  # Very different
            ),
            KnownPerson(
                person_id=2,
                person_name="Bob",
                embeddings=[query + noise],  # Very similar
            ),
        ]
        result = self.engine.match(query, known)
        assert result.is_known is True
        assert result.person_name == "Bob"
        assert result.person_id == 2

    def test_match_multiple_embeddings_per_person(self):
        """A person with multiple reference embeddings should match if any is close."""
        query = self._make_embedding(seed=7)

        known = [
            KnownPerson(
                person_id=1,
                person_name="Dana",
                embeddings=[
                    self._make_embedding(seed=200),  # Different
                    self._make_embedding(seed=201),  # Different
                    query.copy(),                     # Exact match
                ],
            ),
        ]
        result = self.engine.match(query, known)
        assert result.is_known is True
        assert result.person_name == "Dana"
        assert result.confidence > 0.99

    def test_crop_face(self):
        """Test face cropping with padding."""
        # Create a dummy 200x300 BGR image
        frame = np.zeros((200, 300, 3), dtype=np.uint8)
        frame[50:150, 80:220] = 128  # Gray face region

        bbox = (80, 50, 220, 150)
        cropped = self.engine.crop_face(frame, bbox, padding=0.2)

        assert cropped.shape[0] > 0
        assert cropped.shape[1] > 0
        assert cropped.shape[2] == 3

    def test_crop_face_with_clipping(self):
        """Cropping near image edges should clip to boundaries."""
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        bbox = (0, 0, 50, 50)  # Top-left corner
        cropped = self.engine.crop_face(frame, bbox, padding=0.5)

        # Should not exceed image boundaries
        assert cropped.shape[0] <= 100
        assert cropped.shape[1] <= 100
