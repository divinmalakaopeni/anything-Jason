"""
extractors/text_extractor.py
────────────────────────────
Extracts paragraphs and headings from a PDF page using PyMuPDF's span-level
text dict.  Returns a list of element dicts ready for the pipeline.

Algorithm
─────────
1. Get the full text dict from PyMuPDF (blocks → lines → spans).
2. Compute the modal font-size on the page (= body text size).
3. Classify each block as:
   - "heading"  : font size > body * 1.15 OR bold flag on most chars
                  AND the block is a short single-line run
   - "paragraph": everything else
4. Merge adjacent paragraph blocks that are in the same column and
   separated by less than `line_gap_factor × font_size`.
5. Discard blocks that overlap with already-detected table/image regions
   (supplied by the caller as exclusion zones).
"""
from __future__ import annotations

import statistics
from typing import Any

from bbox_utils import Bbox, contains, intersection, to_list
from id_generator import next_id


# ── Flags for PyMuPDF span ───────────────────────────────────────────────────
_FLAG_BOLD   = 2 ** 4   # 16
_FLAG_ITALIC = 2 ** 1   # 2


def _span_is_bold(flags: int) -> bool:
    return bool(flags & _FLAG_BOLD)


def _span_is_italic(flags: int) -> bool:
    return bool(flags & _FLAG_ITALIC)


# ── Heading level heuristic ──────────────────────────────────────────────────
def _heading_level(font_size: float, body_size: float) -> int:
    ratio = font_size / max(body_size, 1)
    if ratio >= 2.0:
        return 1
    if ratio >= 1.5:
        return 2
    if ratio >= 1.2:
        return 3
    return 4


# ── Main extractor ────────────────────────────────────────────────────────────

def extract_text_elements(
    fitz_page: Any,
    page_number: int,
    exclusion_zones: list[Bbox] | None = None,
) -> list[dict]:
    """
    Parameters
    ----------
    fitz_page      : fitz.Page object
    page_number    : 1-based page index
    exclusion_zones: list of bboxes (tables, images already detected) to skip

    Returns
    -------
    List of element dicts (paragraph or heading).
    """
    exclusions = exclusion_zones or []

    raw_dict = fitz_page.get_text(
        "dict",
        flags=0  # no ligatures / whitespace normalisation
    )

    # ── Pass 1: collect raw text blocks with font stats ──────────────────────
    raw_blocks: list[dict] = []
    all_sizes: list[float] = []

    for block in raw_dict.get("blocks", []):
        if block.get("type") != 0:  # skip image blocks
            continue

        bbox: Bbox = tuple(block["bbox"])  # type: ignore[assignment]

        # Skip if overlaps significantly with an exclusion zone (table/image)
        if any(_overlap_area(ez, bbox) / max(_area(bbox), 1) > 0.25 for ez in exclusions):
            continue

        lines_data: list[dict] = []
        block_bold_chars = 0
        block_italic_chars = 0
        block_total_chars = 0
        block_sizes: list[float] = []

        for line in block.get("lines", []):
            line_text_parts: list[str] = []
            for span in line.get("spans", []):
                txt = span.get("text", "").strip()
                if not txt:
                    continue
                sz = float(span.get("size", 10))
                flags = int(span.get("flags", 0))
                block_sizes.append(sz)
                all_sizes.append(sz)
                lc = len(txt)
                if _span_is_bold(flags):
                    block_bold_chars += lc
                if _span_is_italic(flags):
                    block_italic_chars += lc
                block_total_chars += lc
                line_text_parts.append(txt)

            line_text = " ".join(line_text_parts).strip()
            if line_text:
                lines_data.append({
                    "text": line_text,
                    "bbox": tuple(line["bbox"]),
                })

        if not lines_data:
            continue

        full_text = " ".join(l["text"] for l in lines_data)
        dominant_size = statistics.median(block_sizes) if block_sizes else 10.0
        bold_ratio = block_bold_chars / max(block_total_chars, 1)
        italic_ratio = block_italic_chars / max(block_total_chars, 1)

        raw_blocks.append({
            "bbox": bbox,
            "text": full_text,
            "lines": lines_data,
            "font_size": dominant_size,
            "bold": bold_ratio > 0.5,
            "italic": italic_ratio > 0.5,
            "font": _dominant_font(block),
        })

    if not raw_blocks:
        return []

    # ── Compute body size (modal / median of all spans) ──────────────────────
    body_size = statistics.median(all_sizes) if all_sizes else 10.0

    # ── Pass 2: classify and build element dicts ─────────────────────────────
    elements: list[dict] = []

    for rb in raw_blocks:
        sz = rb["font_size"]
        txt = rb["text"].strip()
        if not txt:
            continue

        is_short = len(txt) < 200 and txt.count("\n") < 3
        size_ratio = sz / max(body_size, 1)

        if (size_ratio >= 1.15 or (rb["bold"] and size_ratio >= 1.0)) and is_short:
            # ── Heading ──────────────────────────────────────────────────────
            level = _heading_level(sz, body_size)
            elements.append({
                "id": next_id(page_number),
                "type": "heading",
                "level": level,
                "page": page_number,
                "bounding_box": to_list(rb["bbox"]),
                "text": txt,
                "font": rb["font"],
                "font_size": round(sz, 2),
            })
        else:
            # ── Paragraph ────────────────────────────────────────────────────
            elements.append({
                "id": next_id(page_number),
                "type": "paragraph",
                "page": page_number,
                "bounding_box": to_list(rb["bbox"]),
                "text": txt,
                "font": rb["font"],
                "font_size": round(sz, 2),
                "bold": rb["bold"],
                "italic": rb["italic"],
            })

    return elements


# ── Helpers ──────────────────────────────────────────────────────────────────

def _dominant_font(block: dict) -> str:
    font_counts: dict[str, int] = {}
    for line in block.get("lines", []):
        for span in line.get("spans", []):
            fn = span.get("font", "Unknown")
            font_counts[fn] = font_counts.get(fn, 0) + len(span.get("text", ""))
    if not font_counts:
        return "Unknown"
    return max(font_counts, key=font_counts.__getitem__)


def _area(b: Bbox) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _overlap_area(a: Bbox, b: Bbox) -> float:
    ix = intersection(a, b)
    return _area(ix) if ix else 0.0
