"""
Per-upload sessions: each upload gets its own private dataset.

Why: the backend used to hold ONE dataset for everyone, so a second user could
read the first user's staff data, and two audits at once would overwrite each
other. Now every successful upload creates a session with a random, unguessable
id; the browser sends that id back on every request (X-Session-Id header) and
only ever sees its own data.

Lifetime: memory only, never disk. A session ends when the user starts a new
audit (DELETE /api/session) or after SESSION_IDLE_MINUTES with no requests.
Expired sessions are swept whenever any session is created or looked up, so no
background job is needed.

An unknown or expired id is reported exactly like "nothing uploaded yet", which
the frontend already treats as a recoverable lost session (re-upload the same
file and the audit's decisions are restored).
"""
import secrets
import threading
import time
from typing import Callable, Dict, Optional, Tuple

from .uploaded_dataset import UploadedDataset

SESSION_IDLE_MINUTES = 60


class SessionStore:
    """In-memory map of session id -> that session's UploadedDataset."""

    def __init__(
        self,
        idle_seconds: int = SESSION_IDLE_MINUTES * 60,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._idle_seconds = idle_seconds
        self._clock = clock  # swappable so tests can fast-forward time
        self._lock = threading.Lock()
        self._sessions: Dict[str, Tuple[UploadedDataset, float]] = {}

    def create(self, dataset: UploadedDataset) -> str:
        """Store a freshly loaded dataset and return its new session id."""
        session_id = secrets.token_urlsafe(32)
        with self._lock:
            self._sweep()
            self._sessions[session_id] = (dataset, self._clock())
        return session_id

    def get(self, session_id: Optional[str]) -> Optional[UploadedDataset]:
        """Return the session's dataset (and mark it active), or None."""
        if not session_id:
            return None
        with self._lock:
            self._sweep()
            entry = self._sessions.get(session_id)
            if entry is None:
                return None
            dataset, _ = entry
            self._sessions[session_id] = (dataset, self._clock())
            return dataset

    def end(self, session_id: Optional[str]) -> None:
        """Forget a session immediately. Unknown ids are ignored."""
        if not session_id:
            return
        with self._lock:
            self._sessions.pop(session_id, None)

    def count(self) -> int:
        with self._lock:
            self._sweep()
            return len(self._sessions)

    def _sweep(self) -> None:
        """Drop sessions idle longer than the limit. Caller holds the lock."""
        cutoff = self._clock() - self._idle_seconds
        for sid in [s for s, (_, last) in self._sessions.items() if last < cutoff]:
            del self._sessions[sid]
