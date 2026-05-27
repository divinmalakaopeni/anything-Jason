"""
output_schemas/schema_v1.py
────────────────────────────
JSON serialisation helpers for the pdf2json output format.

Uses `orjson` for fast, compact serialisation (falls back to stdlib json).
Provides:
  - write_json(doc_dict, path)          → single-file output
  - write_json_stream(chunks, out_dir)  → chunked output for large docs
  - validate_element(el)                → lightweight structural check
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Generator

logger = logging.getLogger("pdf2json.schema")

# Try orjson for speed; fall back to stdlib
try:
    import orjson

    def _dumps(obj: Any, indent: bool = True) -> bytes:
        opts = orjson.OPT_INDENT_2 if indent else 0
        return orjson.dumps(obj, option=opts)

    def write_json(doc: dict, path: str | Path, indent: bool = True) -> None:
        data = _dumps(doc, indent)
        Path(path).write_bytes(data)
        logger.info("Written %s (%.1f MB)", path, len(data) / 1e6)

except ImportError:
    def write_json(doc: dict, path: str | Path, indent: bool = True) -> None:  # type: ignore[misc]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2 if indent else None, ensure_ascii=False)
        logger.info("Written %s", path)


def write_json_stream(
    chunks: Generator[dict, None, None],
    out_dir: str | Path,
    base_name: str = "output",
) -> list[Path]:
    """
    Write each yielded chunk to a separate JSON file.
    Returns list of written paths.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    for chunk in chunks:
        idx = chunk.get("chunk", {}).get("chunk_index", len(written))
        fname = out_dir / f"{base_name}_chunk_{idx:04d}.json"
        write_json(chunk, fname)
        written.append(fname)

    return written


# ── Element validation ────────────────────────────────────────────────────────

_REQUIRED_FIELDS = {
    "paragraph": {"id", "type", "page", "text"},
    "heading":   {"id", "type", "page", "text", "level"},
    "table":     {"id", "type", "page", "headers", "rows"},
    "image":     {"id", "type", "page", "extracted_image_path"},
}


def validate_element(el: dict) -> list[str]:
    """Return list of validation error strings (empty = valid)."""
    errors: list[str] = []
    etype = el.get("type", "")
    required = _REQUIRED_FIELDS.get(etype, {"id", "type", "page"})
    for field in required:
        if field not in el or el[field] is None:
            errors.append(f"Missing field '{field}' in {etype} element {el.get('id', '?')}")
    return errors


def validate_document(doc: dict) -> bool:
    """Validate the full document dict. Returns True if valid."""
    ok = True
    if "document_metadata" not in doc:
        logger.error("Missing 'document_metadata'")
        ok = False
    if "content" not in doc:
        logger.error("Missing 'content' array")
        ok = False
        return ok
    for el in doc["content"]:
        errs = validate_element(el)
        for e in errs:
            logger.warning(e)
            ok = False
    return ok
