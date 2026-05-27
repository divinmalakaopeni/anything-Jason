"""
core/page_analyzer.py
──────────────────────
Lightweight per-page content type analysis.

Returns a PageProfile that guides which extractors to run and with what strategy,
avoiding expensive extractor calls on pages that clearly have no tables or images.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PageProfile:
    page_number: int
    has_text:     bool  = True
    has_tables:   bool  = False
    has_raster:   bool  = False
    has_vector:   bool  = False
    has_lines:    bool  = False   # explicit ruled lines → lattice tables likely
    text_density: float = 0.0    # chars per page area (normalised)
    dominant_type: str  = "text"  # text | table | image | mixed
    suggested_table_method: str = "auto"


def analyze_page(fitz_page: Any, page_number: int) -> PageProfile:
    """
    Cheap scan of a page to detect its content mix.

    Uses:
    - get_text("words")  — fast word list
    - get_images()       — raster image xrefs
    - get_drawings()     — vector paths
    """
    profile = PageProfile(page_number=page_number)

    page_rect  = fitz_page.rect
    page_area  = max(page_rect.width * page_rect.height, 1)

    # ── Text ─────────────────────────────────────────────────────────────────
    words = fitz_page.get_text("words")
    char_count = sum(len(w[4]) for w in words)
    profile.has_text    = char_count > 20
    profile.text_density = char_count / page_area

    # ── Raster images ─────────────────────────────────────────────────────────
    images = fitz_page.get_images(full=False)
    profile.has_raster = len(images) > 0

    # ── Vector drawings ───────────────────────────────────────────────────────
    drawings = fitz_page.get_drawings()
    if drawings:
        profile.has_vector = True
        profile.has_lines  = _has_ruled_lines(drawings, page_rect)

    # ── Suggest table extraction strategy ────────────────────────────────────
    if profile.has_lines:
        profile.has_tables = True
        profile.suggested_table_method = "lattice"
    elif profile.text_density > 0.001 and _looks_like_tabular(words, fitz_page):
        profile.has_tables = True
        profile.suggested_table_method = "stream"

    # ── Dominant type ─────────────────────────────────────────────────────────
    scores = {
        "text":   int(profile.has_text) * (1 + int(profile.text_density > 0.005)),
        "table":  int(profile.has_tables) * 2,
        "image":  int(profile.has_raster or profile.has_vector) * 2,
    }
    total = sum(scores.values())
    if total == 0:
        profile.dominant_type = "empty"
    else:
        top = max(scores, key=scores.__getitem__)
        # If the second highest is within 1 point, call it mixed
        sorted_scores = sorted(scores.values(), reverse=True)
        if len(sorted_scores) > 1 and (sorted_scores[0] - sorted_scores[1]) <= 1:
            profile.dominant_type = "mixed"
        else:
            profile.dominant_type = top

    return profile


# ── Helpers ──────────────────────────────────────────────────────────────────

def _has_ruled_lines(drawings: list[dict], page_rect: Any) -> bool:
    """
    Quick check: does the page have horizontal AND vertical lines
    long enough to form table borders?
    """
    MIN_LINE_LENGTH = 30  # points (~1 cm)
    has_h = False
    has_v = False

    for d in drawings:
        rect = d.get("rect")
        if rect is None:
            continue
        w = rect.width
        h = rect.height
        if h < 2 and w >= MIN_LINE_LENGTH:
            has_h = True
        if w < 2 and h >= MIN_LINE_LENGTH:
            has_v = True
        if has_h and has_v:
            return True

    return False


def _looks_like_tabular(words: list, fitz_page: Any) -> bool:
    """
    Heuristic: if many words share the same Y coordinate in clusters,
    the page may have a text-based table.
    """
    if len(words) < 10:
        return False

    y_coords: dict[int, int] = {}  # rounded y0 → word count
    for w in words:
        y_bucket = int(w[1] / 5) * 5  # bucket to 5pt rows
        y_coords[y_bucket] = y_coords.get(y_bucket, 0) + 1

    # If there are many rows with multiple words side by side
    multi_word_rows = sum(1 for v in y_coords.values() if v >= 3)
    return multi_word_rows >= 4
