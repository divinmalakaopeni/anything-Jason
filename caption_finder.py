"""
utils/caption_finder.py — Find figure/table captions near a bounding box.

Strategy:
1. Look for text blocks immediately BELOW the bbox (within `below_gap` px).
2. If nothing found, look ABOVE (within `above_gap` px).
3. Match lines starting with common caption prefixes (Figure, Fig., Table, etc.)
   OR just take the nearest text line if it's close enough.
"""
from __future__ import annotations

import re
from typing import Any

from bbox_utils import Bbox, intersection, width

# ── Regex for caption-like prefixes ──────────────────────────────────────────
_CAPTION_RE = re.compile(
    r"^(fig(?:ure)?\.?\s*\d|table\s+\d|diagram\s*\d|schematic\s*\d"
    r"|block\s*\d|circuit\s*\d|note\s*\d|\d+\.\d+)",
    re.IGNORECASE,
)


def _text_blocks_on_page(fitz_page: Any) -> list[dict]:
    """
    Return list of {text, bbox} dicts from the page's text dict.
    bbox is (x0, y0, x1, y1) in PyMuPDF top-left coordinates.
    """
    blocks = []
    raw = fitz_page.get_text("dict", flags=0)
    for block in raw.get("blocks", []):
        if block.get("type") != 0:  # 0 = text
            continue
        lines_text = []
        for line in block.get("lines", []):
            span_text = " ".join(s["text"] for s in line.get("spans", []))
            lines_text.append(span_text.strip())
        full_text = " ".join(t for t in lines_text if t)
        if not full_text:
            continue
        b = block["bbox"]  # (x0, y0, x1, y1)
        blocks.append({"text": full_text, "bbox": (b[0], b[1], b[2], b[3])})
    return blocks


def find_caption(
    fitz_page: Any,
    image_bbox: Bbox,
    below_gap: float = 48.0,
    above_gap: float = 24.0,
    min_overlap_ratio: float = 0.25,
) -> str | None:
    """
    Search for a caption string near `image_bbox` on `fitz_page`.

    Returns the caption string, or None if not found.
    """
    text_blocks = _text_blocks_on_page(fitz_page)
    x0, y0, x1, y1 = image_bbox
    img_width = x1 - x0

    candidates: list[tuple[float, str]] = []  # (distance, text)

    for tb in text_blocks:
        tx0, ty0, tx1, ty1 = tb["bbox"]
        txt = tb["text"].strip()
        if not txt:
            continue

        # Horizontal overlap check — text should be roughly under/above the image
        h_overlap = min(tx1, x1) - max(tx0, x0)
        h_frac = h_overlap / max(img_width, 1)
        if h_frac < min_overlap_ratio:
            continue

        # Below the image
        if ty0 >= y1 and (ty0 - y1) <= below_gap:
            dist = ty0 - y1
            is_caption = bool(_CAPTION_RE.match(txt))
            candidates.append((dist - (100 if is_caption else 0), txt))

        # Above the image
        elif ty1 <= y0 and (y0 - ty1) <= above_gap:
            dist = y0 - ty1
            is_caption = bool(_CAPTION_RE.match(txt))
            candidates.append((dist + 200 - (100 if is_caption else 0), txt))

    if not candidates:
        return None

    # Pick the candidate with the smallest adjusted distance
    candidates.sort(key=lambda c: c[0])
    return candidates[0][1]
