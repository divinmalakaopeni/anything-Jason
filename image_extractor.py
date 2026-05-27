"""
extractors/image_extractor.py
──────────────────────────────
Two-track image extraction:

Track A — Embedded raster images
  • PyMuPDF `page.get_images(full=True)` → xref → Pixmap → PNG
  • Position: `page.get_image_rects(xref)`
  • Colourspace normalisation (CMYK → RGB)
  • Deduplication by xref

Track B — Vector diagram regions
  • PyMuPDF `page.get_drawings()` returns all vector paths/curves
  • Cluster path bboxes (union-find with 8 px gap) to get diagram regions
  • Filter: region must be "complex enough" (≥ min_path_count paths,
    area ≥ min_area) and NOT dominated by simple horizontal/vertical lines
    (which are likely table borders)
  • Render each region via `page.get_pixmap(clip=rect, dpi=dpi)`

Both tracks call caption_finder to annotate extracted images.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from bbox_utils import (
    Bbox, area, cluster_bboxes, merge_cluster_to_bbox,
    expand, to_list, filter_tiny,
)
from caption_finder import find_caption
from id_generator import next_id

logger = logging.getLogger("pdf2json.image")


# ── Constants ────────────────────────────────────────────────────────────────
MIN_IMAGE_AREA    = 1000    # px² in PDF units (points)
MIN_VECTOR_AREA   = 2000    # minimum area for a vector diagram region
MIN_PATH_COUNT    = 3       # minimum drawing paths to be "a diagram"
VECTOR_CLUSTER_GAP = 80.0  # gap in points to cluster drawing paths into regions
VECTOR_DPI        = 150     # DPI when rendering vector regions


# ── Helper: save pixmap as PNG ───────────────────────────────────────────────

def _save_pixmap(pix: Any, output_dir: Path, filename: str) -> str:
    """Save a fitz.Pixmap to disk. Returns relative path string."""
    output_dir.mkdir(parents=True, exist_ok=True)
    filepath = output_dir / filename
    if pix.n - pix.alpha > 3:  # CMYK or other — convert to RGB
        pix = fitz.Pixmap(fitz.csRGB, pix)
    pix.save(str(filepath))
    return str(filepath)


# ── Track A: raster images ───────────────────────────────────────────────────

def extract_raster_images(
    fitz_page: Any,
    fitz_doc: Any,
    page_number: int,
    output_dir: Path,
    extract_captions: bool = True,
) -> list[dict]:
    """
    Extract embedded raster images from a page.
    Returns list of image element dicts.
    """
    elements: list[dict] = []
    seen_xrefs: set[int] = set()

    images = fitz_page.get_images(full=True)

    for img_info in images:
        xref = img_info[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)

        # Get image position(s) on page
        try:
            rects = fitz_page.get_image_rects(xref)
        except Exception:
            rects = []

        if not rects:
            continue

        # Use the largest rect if the image appears multiple times
        rect = max(rects, key=lambda r: r.width * r.height)
        bbox: Bbox = (rect.x0, rect.y0, rect.x1, rect.y1)

        if area(bbox) < MIN_IMAGE_AREA:
            continue

        # Extract the raw image pixmap
        try:
            pix = fitz.Pixmap(fitz_doc, xref)
        except Exception as exc:
            logger.debug("Page %d: failed to extract xref %d: %s", page_number, xref, exc)
            continue

        # Skip very small raster images (icons, bullets, decorative)
        if pix.width * pix.height < MIN_IMAGE_AREA:
            pix = None
            continue

        w, h = pix.width, pix.height
        colorspace = pix.colorspace.name if pix.colorspace else "unknown"

        img_idx = len(elements) + 1
        filename = f"img_p{page_number:04d}_{img_idx:03d}.png"
        try:
            saved_path = _save_pixmap(pix, output_dir, filename)
        except Exception as exc:
            logger.warning("Page %d: could not save image %s: %s", page_number, filename, exc)
            continue

        caption: str | None = None
        if extract_captions:
            caption = find_caption(fitz_page, bbox)

        elements.append({
            "id": next_id(page_number),
            "type": "image",
            "subtype": "raster",
            "page": page_number,
            "bounding_box": to_list(bbox),
            "extracted_image_path": saved_path,
            "width_px": w,
            "height_px": h,
            "colorspace": colorspace,
            "caption": caption,
        })

    return elements


# ── Track B: vector diagram regions ──────────────────────────────────────────

def _is_table_border_cluster(paths: list[dict]) -> bool:
    """
    Heuristic: if almost all paths are pure horizontal or vertical lines,
    it's likely a table border grid, not a diagram.
    For diagrams, we expect a mix of differently-sized rectangles or curves.
    """
    if not paths:
        return False

    h_or_v_lines = 0
    non_trivial = 0

    for p in paths:
        rect = p.get("rect")
        if rect is None:
            continue
        w = rect.width
        h = rect.height
        # A pure horizontal or vertical line has one dimension near 0
        if w < 2 or h < 2:
            h_or_v_lines += 1
        else:
            non_trivial += 1  # 2D shape (rect, arc, etc.)

    total = h_or_v_lines + non_trivial
    if total == 0:
        return False

    # If the cluster has meaningful 2D shapes (boxes, arcs),
    # it's almost certainly a diagram, not a table border.
    if non_trivial >= 2:
        return False

    # Only flag as table border if overwhelming majority are pure lines
    return h_or_v_lines / total > 0.9


def extract_vector_regions(
    fitz_page: Any,
    page_number: int,
    output_dir: Path,
    extract_captions: bool = True,
    dpi: int = VECTOR_DPI,
    raster_exclusions: list[Bbox] | None = None,
) -> list[dict]:
    """
    Detect and render vector diagram regions (circuits, schematics, logic blocks).
    Returns list of image element dicts with subtype "vector_region".
    """
    raster_excl = raster_exclusions or []
    elements: list[dict] = []

    drawings = fitz_page.get_drawings()
    if not drawings:
        return []

    # Collect path bounding rects — for zero-area lines, expand to a point bbox
    path_bboxes: list[Bbox] = []
    path_by_bbox: dict[Bbox, list[dict]] = {}

    for d in drawings:
        rect = d.get("rect")
        if rect is None:
            continue
        b: Bbox = (rect.x0, rect.y0, rect.x1, rect.y1)
        # Zero-area paths (pure lines): give them a 1pt footprint so they
        # participate in clustering and expand the merged region correctly
        if area(b) < 1:
            cx = (rect.x0 + rect.x1) / 2
            cy = (rect.y0 + rect.y1) / 2
            b = (cx - 0.5, cy - 0.5, cx + 0.5, cy + 0.5)
        path_bboxes.append(b)

    if not path_bboxes:
        return []

    # Cluster nearby paths
    clusters = cluster_bboxes(path_bboxes, gap=VECTOR_CLUSTER_GAP)

    # Store paths per cluster for table-border heuristic
    # (re-run clustering and map drawings back)
    # Simpler: we just use path count and area
    vec_idx = 0
    for cluster in clusters:
        merged: Bbox = merge_cluster_to_bbox(cluster)

        # Filter by area
        if area(merged) < MIN_VECTOR_AREA:
            continue

        # Filter by path density
        if len(cluster) < MIN_PATH_COUNT:
            continue

        # Check if it overlaps with a detected raster image
        # (a raster image inside the drawings cluster — skip)
        overlaps_raster = any(
            (re_bbox := _intersection_area(merged, rex)) > 0.5 * area(merged)
            for rex in raster_excl
        )
        if overlaps_raster:
            continue

        # Table-border heuristic: filter clusters that are just grid lines
        cluster_drawings = [
            d for d in drawings
            if d.get("rect") is not None and
               _rect_in_cluster(d["rect"], merged)
        ]
        if _is_table_border_cluster(cluster_drawings):
            continue

        # Expand region slightly for context
        clip_rect = fitz.Rect(
            merged[0] - 4, merged[1] - 4,
            merged[2] + 4, merged[3] + 4,
        )
        clip_rect &= fitz_page.rect  # clip to page bounds

        try:
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = fitz_page.get_pixmap(matrix=mat, clip=clip_rect, alpha=False)
        except Exception as exc:
            logger.debug("Page %d: vector crop failed: %s", page_number, exc)
            continue

        vec_idx += 1
        filename = f"vec_p{page_number:04d}_{vec_idx:03d}.png"
        output_dir.mkdir(parents=True, exist_ok=True)
        saved_path = str(output_dir / filename)
        pix.save(saved_path)

        bbox_out: Bbox = (clip_rect.x0, clip_rect.y0, clip_rect.x1, clip_rect.y1)
        caption: str | None = None
        if extract_captions:
            caption = find_caption(fitz_page, bbox_out)

        elements.append({
            "id": next_id(page_number),
            "type": "image",
            "subtype": "vector_region",
            "page": page_number,
            "bounding_box": to_list(bbox_out),
            "extracted_image_path": saved_path,
            "width_px": pix.width,
            "height_px": pix.height,
            "path_count": len(cluster),
            "caption": caption,
        })

    return elements


# ── Helpers ──────────────────────────────────────────────────────────────────

def _intersection_area(a: Bbox, b: Bbox) -> float:
    ix0 = max(a[0], b[0])
    iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2])
    iy1 = min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    return (ix1 - ix0) * (iy1 - iy0)


def _rect_in_cluster(rect: Any, merged: Bbox, tolerance: float = 20.0) -> bool:
    """Check if a fitz.Rect's center lies within the cluster bbox."""
    cx = (rect.x0 + rect.x1) / 2
    cy = (rect.y0 + rect.y1) / 2
    return (merged[0] - tolerance <= cx <= merged[2] + tolerance and
            merged[1] - tolerance <= cy <= merged[3] + tolerance)


# ── Combined entry point ──────────────────────────────────────────────────────

def extract_image_elements(
    fitz_page: Any,
    fitz_doc: Any,
    page_number: int,
    output_dir: Path,
    extract_vectors: bool = True,
    extract_captions: bool = True,
    dpi: int = VECTOR_DPI,
) -> list[dict]:
    """
    Extract all image elements from a page (raster + vector diagrams).
    """
    raster = extract_raster_images(
        fitz_page, fitz_doc, page_number, output_dir, extract_captions
    )

    raster_bboxes: list[Bbox] = [
        tuple(el["bounding_box"]) for el in raster  # type: ignore[misc]
    ]

    vector: list[dict] = []
    if extract_vectors:
        vector = extract_vector_regions(
            fitz_page, page_number, output_dir,
            extract_captions=extract_captions,
            dpi=dpi,
            raster_exclusions=raster_bboxes,
        )

    return raster + vector
