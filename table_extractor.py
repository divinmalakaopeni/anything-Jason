"""
extractors/table_extractor.py
──────────────────────────────
Multi-strategy table extraction:

Strategy 1 — pdfplumber lattice  (explicit ruled lines)
Strategy 2 — pdfplumber stream   (whitespace-column layout)
Strategy 3 — Camelot lattice     (Ghostscript graphical line analysis)

For each page:
  • Try strategy 1 first (fastest, most precise for ruled tables).
  • If it yields no tables, try strategy 2.
  • If still no tables, optionally try strategy 3 (slower, most robust).

Multi-line cells: pdfplumber joins spans within the same PDF cell automatically.
We also post-process to strip accidental newlines within cells.

Returns list of element dicts with:
  type           : "table"
  page           : 1-based page number
  bounding_box   : [x0, y0, x1, y1]
  extraction_method: "lattice" | "stream" | "camelot"
  accuracy       : float 0-100 (camelot) or heuristic estimate
  headers        : list[str]  (first non-empty row treated as header)
  rows           : list[list[str]]
"""
from __future__ import annotations

import logging
import re
from typing import Any

import pdfplumber

from bbox_utils import Bbox, to_list
from id_generator import next_id

logger = logging.getLogger("pdf2json.table")


# ── Cleaning helpers ─────────────────────────────────────────────────────────

def _clean_cell(cell: Any) -> str:
    if cell is None:
        return ""
    text = str(cell)
    # Collapse internal newlines to a space
    text = re.sub(r"\s*\n\s*", " ", text)
    # Collapse multiple spaces
    text = re.sub(r"  +", " ", text)
    return text.strip()


def _clean_row(row: list[Any]) -> list[str]:
    return [_clean_cell(c) for c in row]


def _is_empty_row(row: list[str]) -> bool:
    return all(c == "" for c in row)


def _table_to_headers_rows(
    raw_table: list[list[Any]],
) -> tuple[list[str], list[list[str]]]:
    """
    Given a raw 2-D cell list, extract headers (first non-empty row)
    and data rows.
    """
    cleaned = [_clean_row(r) for r in raw_table if not _is_empty_row(_clean_row(r))]
    if not cleaned:
        return [], []
    headers = cleaned[0]
    rows = cleaned[1:]
    return headers, rows


def _bbox_from_pdfplumber_table(table: Any, page: Any) -> Bbox:
    """Extract bbox from pdfplumber table object."""
    try:
        cells = table.cells
        if cells:
            x0 = min(c[0] for c in cells)
            y0 = min(c[1] for c in cells)
            x1 = max(c[2] for c in cells)
            y1 = max(c[3] for c in cells)
            return (x0, y0, x1, y1)
    except Exception:
        pass
    # Fallback: derive from bbox attribute if present
    if hasattr(table, "bbox"):
        return tuple(table.bbox)  # type: ignore[return-value]
    # Last resort: full page width
    return (0, 0, page.width, page.height)


# ── Strategy 1 & 2: pdfplumber ───────────────────────────────────────────────

def _extract_pdfplumber(
    plumber_page: Any,
    page_number: int,
    method: str = "lattice",
) -> list[dict]:
    """
    method: "lattice" — explicit lines only
            "stream"  — whitespace gaps
    """
    settings: dict = {}
    if method == "stream":
        settings = {
            "vertical_strategy": "text",
            "horizontal_strategy": "text",
            "snap_tolerance": 5,
            "join_tolerance": 5,
            "edge_min_length": 3,
            "min_words_vertical": 3,
            "min_words_horizontal": 1,
        }
    else:
        settings = {
            "vertical_strategy": "lines",
            "horizontal_strategy": "lines",
            "snap_tolerance": 3,
            "join_tolerance": 3,
            "edge_min_length": 10,
        }

    elements: list[dict] = []
    try:
        tables = plumber_page.extract_tables(table_settings=settings)
        tobj_list = plumber_page.find_tables(table_settings=settings)
    except Exception as exc:
        logger.debug("pdfplumber %s error on page %d: %s", method, page_number, exc)
        return []

    for i, (raw_table, tobj) in enumerate(zip(tables, tobj_list)):
        headers, rows = _table_to_headers_rows(raw_table)
        if not headers and not rows:
            continue
        if len(headers) == 0:
            continue

        try:
            bbox = _bbox_from_pdfplumber_table(tobj, plumber_page)
        except Exception:
            bbox = (0.0, 0.0, float(plumber_page.width), float(plumber_page.height))

        elements.append({
            "id": next_id(page_number),
            "type": "table",
            "page": page_number,
            "bounding_box": to_list(bbox),
            "extraction_method": method,
            "accuracy": 90.0 if method == "lattice" else 75.0,
            "headers": headers,
            "rows": rows,
            "col_count": len(headers),
            "row_count": len(rows),
        })

    return elements


# ── Strategy 3: Camelot ──────────────────────────────────────────────────────

def _extract_camelot(pdf_path: str, page_number: int) -> list[dict]:
    try:
        import camelot  # type: ignore
    except ImportError:
        logger.warning("camelot-py not installed; skipping Camelot strategy.")
        return []

    elements: list[dict] = []
    try:
        tables = camelot.read_pdf(
            pdf_path,
            pages=str(page_number),
            flavor="lattice",
            copy_text=["v"],   # propagate text in merged cells vertically
        )
    except Exception as exc:
        logger.debug("Camelot error on page %d: %s", page_number, exc)
        return []

    for t in tables:
        raw_table = t.df.values.tolist()
        headers, rows = _table_to_headers_rows(raw_table)
        if not headers:
            continue

        bbox_c = t._bbox  # camelot bbox: (x1, y2, x2, y1) bottom-left origin
        # Convert camelot (bottom-left) to top-left by using page height
        # pdfplumber/fitz use top-left already; we store as-is and note the method
        acc = float(t.accuracy) if hasattr(t, "accuracy") else 70.0

        elements.append({
            "id": next_id(page_number),
            "type": "table",
            "page": page_number,
            "bounding_box": [
                round(bbox_c[0], 2), round(bbox_c[3], 2),
                round(bbox_c[2], 2), round(bbox_c[1], 2),
            ],
            "extraction_method": "camelot",
            "accuracy": round(acc, 2),
            "headers": headers,
            "rows": rows,
            "col_count": len(headers),
            "row_count": len(rows),
        })

    return elements


# ── Public API ────────────────────────────────────────────────────────────────

def extract_table_elements(
    pdf_path: str,
    plumber_pdf: Any,          # open pdfplumber.PDF object
    page_number: int,          # 1-based
    method: str = "auto",      # auto | lattice | stream | camelot
) -> list[dict]:
    """
    Extract tables from a single page.

    Parameters
    ----------
    pdf_path    : path to the source PDF (needed for Camelot)
    plumber_pdf : open pdfplumber.PDF object (shared across pages)
    page_number : 1-based page index
    method      : extraction strategy

    Returns
    -------
    List of table element dicts.
    """
    plumber_page = plumber_pdf.pages[page_number - 1]

    if method == "camelot":
        return _extract_camelot(pdf_path, page_number)

    if method == "stream":
        return _extract_pdfplumber(plumber_page, page_number, "stream")

    if method == "lattice":
        return _extract_pdfplumber(plumber_page, page_number, "lattice")

    # ── auto ─────────────────────────────────────────────────────────────────
    results = _extract_pdfplumber(plumber_page, page_number, "lattice")
    if results:
        logger.debug("Page %d: %d table(s) via lattice", page_number, len(results))
        return results

    results = _extract_pdfplumber(plumber_page, page_number, "stream")
    if results:
        logger.debug("Page %d: %d table(s) via stream", page_number, len(results))
        return results

    # Camelot is slow — only try if we have a known table indicator
    # (line drawings on the page), handled by page_analyzer upstream.
    logger.debug("Page %d: no tables found", page_number)
    return []
