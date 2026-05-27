"""
core/pipeline.py
─────────────────
Central orchestration: opens the PDF, iterates pages (optionally in parallel),
runs page_analyzer → table_extractor → image_extractor → text_extractor →
element_merger, and assembles the final document dict.

Streaming mode: yields page-batch dicts so callers can write JSON chunks
without holding the entire document in RAM (essential for 20 000-page docs).
"""
from __future__ import annotations

import datetime
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Generator, Iterator

import fitz          # PyMuPDF
import pdfplumber

from element_merger import merge_page_elements
from page_analyzer  import analyze_page
from image_extractor import extract_image_elements
from table_extractor import extract_table_elements
from text_extractor  import extract_text_elements
from bbox_utils import Bbox
from id_generator import reset as reset_ids

logger = logging.getLogger("pdf2json.pipeline")

EXTRACTOR_VERSION = "1.0.0"


# ── Document metadata ─────────────────────────────────────────────────────────

def _get_metadata(fitz_doc: Any, pdf_path: str, page_count: int) -> dict:
    meta = fitz_doc.metadata or {}
    return {
        "title":            meta.get("title") or Path(pdf_path).stem,
        "author":           meta.get("author") or "",
        "subject":          meta.get("subject") or "",
        "keywords":         meta.get("keywords") or "",
        "creator":          meta.get("creator") or "",
        "creation_date":    meta.get("creationDate") or "",
        "modification_date":meta.get("modDate") or "",
        "page_count":       page_count,
        "source_pdf":       Path(pdf_path).name,
        "extraction_date":  datetime.datetime.utcnow().isoformat() + "Z",
        "extractor_version":EXTRACTOR_VERSION,
    }


# ── Per-page processing ───────────────────────────────────────────────────────

def _process_page(
    *,
    fitz_doc: "fitz.Document",
    plumber_pdf: "pdfplumber.PDF",
    pdf_path: str,
    page_number: int,        # 1-based
    images_dir: Path,
    table_method: str,
    extract_vectors: bool,
    extract_images_flag: bool,
    extract_tables_flag: bool,
    vector_dpi: int,
) -> list[dict]:
    """Process a single page and return its elements."""
    fitz_page = fitz_doc[page_number - 1]

    profile = analyze_page(fitz_page, page_number)
    logger.debug(
        "Page %d: dom=%s has_text=%s has_tables=%s has_raster=%s has_vector=%s",
        page_number, profile.dominant_type,
        profile.has_text, profile.has_tables,
        profile.has_raster, profile.has_vector,
    )

    # ── Images ───────────────────────────────────────────────────────────────
    image_elements: list[dict] = []
    if extract_images_flag and (profile.has_raster or profile.has_vector):
        image_elements = extract_image_elements(
            fitz_page=fitz_page,
            fitz_doc=fitz_doc,
            page_number=page_number,
            output_dir=images_dir,
            extract_vectors=extract_vectors,
            extract_captions=True,
            dpi=vector_dpi,
        )

    # ── Tables ───────────────────────────────────────────────────────────────
    table_elements: list[dict] = []
    if extract_tables_flag and profile.has_tables:
        effective_method = table_method if table_method != "auto" else profile.suggested_table_method
        table_elements = extract_table_elements(
            pdf_path=pdf_path,
            plumber_pdf=plumber_pdf,
            page_number=page_number,
            method=effective_method,
        )

    # Build exclusion zones for text extractor:
    # tables + ALL image regions (both raster and vector crops).
    # This prevents text labels inside diagrams from leaking as paragraphs.
    exclusion_bboxes: list[Bbox] = []
    for el in image_elements + table_elements:
        bb = el.get("bounding_box")
        if bb and len(bb) == 4:
            exclusion_bboxes.append(tuple(bb))  # type: ignore[arg-type]

    # ── Text ─────────────────────────────────────────────────────────────────
    text_elements: list[dict] = []
    if profile.has_text:
        text_elements = extract_text_elements(
            fitz_page=fitz_page,
            page_number=page_number,
            exclusion_zones=exclusion_bboxes,
        )

    all_elements = text_elements + table_elements + image_elements
    return merge_page_elements(all_elements)


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_pipeline(
    pdf_path: str,
    images_dir: Path,
    page_start: int = 1,
    page_end: int | None = None,
    table_method: str = "auto",
    extract_vectors: bool = True,
    extract_images: bool = True,
    extract_tables: bool = True,
    workers: int = 4,
    vector_dpi: int = 150,
) -> dict:
    """
    Run the full extraction pipeline and return the complete document dict.
    For large documents use `run_pipeline_streaming` instead.
    """
    reset_ids()
    t0 = time.time()

    fitz_doc = fitz.open(pdf_path)
    total_pages = fitz_doc.page_count
    end = min(page_end or total_pages, total_pages)
    pages = list(range(page_start, end + 1))

    logger.info("Processing %d pages (workers=%d)", len(pages), workers)
    meta = _get_metadata(fitz_doc, pdf_path, total_pages)

    all_elements: list[dict] = []

    with pdfplumber.open(pdf_path) as plumber_pdf:
        if workers <= 1:
            from tqdm import tqdm
            for pn in tqdm(pages, desc="Pages", unit="pg"):
                elems = _process_page(
                    fitz_doc=fitz_doc, plumber_pdf=plumber_pdf,
                    pdf_path=pdf_path, page_number=pn,
                    images_dir=images_dir, table_method=table_method,
                    extract_vectors=extract_vectors,
                    extract_images_flag=extract_images,
                    extract_tables_flag=extract_tables,
                    vector_dpi=vector_dpi,
                )
                all_elements.extend(elems)
        else:
            # NOTE: PyMuPDF fitz_doc is NOT thread-safe; each worker must use
            # its own fitz.open() call.
            from tqdm import tqdm
            futures = {}
            results: dict[int, list[dict]] = {}

            with ThreadPoolExecutor(max_workers=workers) as pool:
                for pn in pages:
                    fut = pool.submit(
                        _process_page_isolated,
                        pdf_path=pdf_path, page_number=pn,
                        images_dir=images_dir, table_method=table_method,
                        extract_vectors=extract_vectors,
                        extract_images_flag=extract_images,
                        extract_tables_flag=extract_tables,
                        vector_dpi=vector_dpi,
                    )
                    futures[fut] = pn

                with tqdm(total=len(pages), desc="Pages", unit="pg") as pbar:
                    for fut in as_completed(futures):
                        pn = futures[fut]
                        try:
                            results[pn] = fut.result()
                        except Exception as exc:
                            logger.error("Page %d failed: %s", pn, exc)
                            results[pn] = []
                        pbar.update(1)

            for pn in sorted(results.keys()):
                all_elements.extend(results[pn])

    elapsed = time.time() - t0
    logger.info("Done in %.1f s — %d elements extracted", elapsed, len(all_elements))

    return {
        "document_metadata": meta,
        "stats": {
            "total_elements": len(all_elements),
            "paragraphs":     sum(1 for e in all_elements if e["type"] == "paragraph"),
            "headings":       sum(1 for e in all_elements if e["type"] == "heading"),
            "tables":         sum(1 for e in all_elements if e["type"] == "table"),
            "images":         sum(1 for e in all_elements if e["type"] == "image"),
            "elapsed_seconds": round(elapsed, 2),
        },
        "content": all_elements,
    }


def run_pipeline_streaming(
    pdf_path: str,
    images_dir: Path,
    chunk_size: int = 500,
    page_start: int = 1,
    page_end: int | None = None,
    table_method: str = "auto",
    extract_vectors: bool = True,
    extract_images: bool = True,
    extract_tables: bool = True,
    workers: int = 4,
    vector_dpi: int = 150,
) -> Generator[dict, None, None]:
    """
    Generator variant: yields one chunk dict per `chunk_size` pages.
    Each chunk has the same structure as the full document but `content`
    contains only that chunk's elements.
    """
    reset_ids()
    fitz_doc = fitz.open(pdf_path)
    total_pages = fitz_doc.page_count
    end = min(page_end or total_pages, total_pages)
    pages = list(range(page_start, end + 1))
    meta = _get_metadata(fitz_doc, pdf_path, total_pages)
    fitz_doc.close()

    for chunk_start in range(0, len(pages), chunk_size):
        chunk_pages = pages[chunk_start: chunk_start + chunk_size]
        chunk_elements: list[dict] = []

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {}
            for pn in chunk_pages:
                fut = pool.submit(
                    _process_page_isolated,
                    pdf_path=pdf_path, page_number=pn,
                    images_dir=images_dir, table_method=table_method,
                    extract_vectors=extract_vectors,
                    extract_images_flag=extract_images,
                    extract_tables_flag=extract_tables,
                    vector_dpi=vector_dpi,
                )
                futures[fut] = pn

            results: dict[int, list[dict]] = {}
            for fut in as_completed(futures):
                pn = futures[fut]
                try:
                    results[pn] = fut.result()
                except Exception as exc:
                    logger.error("Page %d failed: %s", pn, exc)
                    results[pn] = []

        for pn in sorted(results.keys()):
            chunk_elements.extend(results[pn])

        logger.info(
            "Chunk pages %d–%d: %d elements",
            chunk_pages[0], chunk_pages[-1], len(chunk_elements),
        )
        yield {
            "document_metadata": meta,
            "chunk": {
                "page_start": chunk_pages[0],
                "page_end":   chunk_pages[-1],
                "chunk_index": chunk_start // chunk_size,
            },
            "content": chunk_elements,
        }


# ── Thread-isolated page processor (opens its own fitz doc) ──────────────────

def _process_page_isolated(
    *,
    pdf_path: str,
    page_number: int,
    images_dir: Path,
    table_method: str,
    extract_vectors: bool,
    extract_images_flag: bool,
    extract_tables_flag: bool,
    vector_dpi: int,
) -> list[dict]:
    fitz_doc = fitz.open(pdf_path)
    try:
        with pdfplumber.open(pdf_path) as plumber_pdf:
            return _process_page(
                fitz_doc=fitz_doc,
                plumber_pdf=plumber_pdf,
                pdf_path=pdf_path,
                page_number=page_number,
                images_dir=images_dir,
                table_method=table_method,
                extract_vectors=extract_vectors,
                extract_images_flag=extract_images_flag,
                extract_tables_flag=extract_tables_flag,
                vector_dpi=vector_dpi,
            )
    finally:
        fitz_doc.close()


# ── Allow `Any` type hint without importing it ────────────────────────────────
from typing import Any
