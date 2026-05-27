"""
core/element_merger.py
───────────────────────
After all three extractors (text, table, image) run on a page, this module:

1. Removes text elements that overlap significantly with a detected table/image bbox.
2. Removes caption text that is already stored inside an image element.
3. Expands vector-region exclusion zones by a margin to suppress nearby wire labels.
4. Sorts all elements by reading order (top-to-bottom, left-to-right).
"""
from __future__ import annotations

from bbox_utils import Bbox, overlap_ratio


# Text block is suppressed if this fraction of its area overlaps an exclusion zone.
TEXT_INSIDE_THRESHOLD = 0.30

# Extra margin (points) added around vector diagram bboxes to catch nearby
# wire labels, pin annotations, axis ticks, etc.
DIAGRAM_LABEL_MARGIN = 45.0


def merge_page_elements(elements: list[dict]) -> list[dict]:
    tables = [e for e in elements if e["type"] == "table"]
    images = [e for e in elements if e["type"] == "image"]
    texts  = [e for e in elements if e["type"] in ("paragraph", "heading")]

    exclusion_bboxes: list[Bbox] = []
    captured_captions: set[str] = set()

    for el in tables + images:
        bb = el.get("bounding_box")
        if bb and len(bb) == 4:
            if el.get("type") == "image" and el.get("subtype") == "vector_region":
                x0, y0, x1, y1 = bb
                exclusion_bboxes.append((
                    x0 - DIAGRAM_LABEL_MARGIN, y0 - DIAGRAM_LABEL_MARGIN,
                    x1 + DIAGRAM_LABEL_MARGIN, y1 + DIAGRAM_LABEL_MARGIN,
                ))
            else:
                exclusion_bboxes.append(tuple(bb))  # type: ignore[arg-type]
        cap = el.get("caption")
        if cap:
            captured_captions.add(cap.strip())

    filtered_texts: list[dict] = []
    for t in texts:
        txt = t.get("text", "").strip()
        if txt in captured_captions:
            continue
        bb = t.get("bounding_box")
        if not bb or len(bb) != 4:
            filtered_texts.append(t)
            continue
        text_bbox: Bbox = tuple(bb)  # type: ignore[assignment]
        dominated = any(
            overlap_ratio(excl, text_bbox) > TEXT_INSIDE_THRESHOLD
            for excl in exclusion_bboxes
        )
        if not dominated:
            filtered_texts.append(t)

    merged = filtered_texts + tables + images

    def sort_key(el: dict) -> tuple[float, float]:
        bb = el.get("bounding_box") or [0, 0, 0, 0]
        return (bb[1], bb[0])

    merged.sort(key=sort_key)
    return merged
