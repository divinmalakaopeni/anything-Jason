"""
utils/id_generator.py — Thread-safe deterministic element ID generator.

IDs are of the form:  elem_{seq:06d}_p{page:04d}
where seq is a global counter. This makes IDs sortable by appearance order
and easy to correlate back to a page.
"""
from __future__ import annotations

import threading


class IDGenerator:
    """Thread-safe sequential ID generator."""

    def __init__(self) -> None:
        self._counter = 0
        self._lock = threading.Lock()

    def next(self, page: int) -> str:
        with self._lock:
            self._counter += 1
            return f"elem_{self._counter:06d}_p{page:04d}"

    def reset(self) -> None:
        with self._lock:
            self._counter = 0


# Module-level singleton — import and use directly
_generator = IDGenerator()


def next_id(page: int) -> str:
    return _generator.next(page)


def reset() -> None:
    _generator.reset()
