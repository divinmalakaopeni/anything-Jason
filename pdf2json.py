#!/usr/bin/env python3
"""
pdf2json.py — CLI entry point for the PDF → JSON extraction pipeline.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# ── Add the folder containing this script to the Python path ─────────────────
_here = Path(__file__).resolve().parent
if str(_here) not in sys.path:
    sys.path.insert(0, str(_here))

# ── Logger (inline, no external file needed) ──────────────────────────────────
try:
    from rich.logging import RichHandler
    def get_logger(name="pdf2json", level="INFO", log_file=None):
        logger = logging.getLogger(name)
        if logger.handlers:
            return logger
        logger.setLevel(getattr(logging, level.upper(), logging.INFO))
        handler = RichHandler(show_path=False, markup=True)
        handler.setLevel(getattr(logging, level.upper(), logging.INFO))
        logger.addHandler(handler)
        if log_file:
            fh = logging.FileHandler(log_file, encoding="utf-8")
            fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
            logger.addHandler(fh)
        logger.propagate = False
        return logger
except ImportError:
    def get_logger(name="pdf2json", level="INFO", log_file=None):
        logging.basicConfig(level=getattr(logging, level.upper(), logging.INFO),
                            format="%(asctime)s [%(levelname)s] %(message)s")
        return logging.getLogger(name)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pdf2json",
        description="Convert any PDF document to a structured JSON file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python pdf2json.py manual.pdf
  python pdf2json.py specs.pdf --output specs.json --workers 8
  python pdf2json.py big.pdf --stream --chunk-size 500 --output-dir ./chunks
  python pdf2json.py schematics.pdf --vector-crop --dpi 200 --no-tables
        """,
    )
    p.add_argument("input", metavar="PDF", help="Input PDF file path")
    p.add_argument("--output", "-o", metavar="FILE",
                   help="Output JSON path (default: <input>.json)")
    p.add_argument("--output-dir", metavar="DIR",
                   help="Output directory for chunked (--stream) JSON files")
    p.add_argument("--images-dir", metavar="DIR", default="./extracted_images",
                   help="Directory to save extracted images (default: ./extracted_images)")
    p.add_argument("--page-start", type=int, default=1, metavar="N",
                   help="First page to process (1-based, default: 1)")
    p.add_argument("--page-end", type=int, default=None, metavar="N",
                   help="Last page to process (default: last page)")
    p.add_argument("--table-method", choices=["auto", "lattice", "stream", "camelot"],
                   default="auto", help="Table extraction strategy (default: auto)")
    p.add_argument("--no-tables", action="store_true", help="Skip table extraction")
    p.add_argument("--no-images", action="store_true", help="Skip image extraction")
    p.add_argument("--vector-crop", action="store_true",
                   help="Extract vector diagram regions (circuits, schematics)")
    p.add_argument("--dpi", type=int, default=150, metavar="N",
                   help="DPI for rendering vector regions (default: 150)")
    p.add_argument("--workers", type=int, default=4, metavar="N",
                   help="Parallel page workers (default: 4)")
    p.add_argument("--stream", action="store_true",
                   help="Write output in chunks (use for large docs)")
    p.add_argument("--chunk-size", type=int, default=500, metavar="N",
                   help="Pages per chunk in streaming mode (default: 500)")
    p.add_argument("--log-level", choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                   default="INFO", help="Logging verbosity (default: INFO)")
    p.add_argument("--log-file", metavar="FILE", help="Also write logs to this file")
    p.add_argument("--validate", action="store_true",
                   help="Validate output JSON structure after extraction")
    p.add_argument("--compact", action="store_true",
                   help="Write compact JSON (no indentation)")
    return p


def main() -> int:
    parser = build_parser()
    args   = parser.parse_args()

    log_file = Path(args.log_file) if args.log_file else None
    logger   = get_logger("pdf2json", level=args.log_level, log_file=log_file)

    pdf_path = Path(args.input).resolve()
    if not pdf_path.exists():
        logger.error("Input file not found: %s", pdf_path)
        return 1

    images_dir = Path(args.images_dir).resolve()
    indent     = not args.compact

    from pipeline import run_pipeline, run_pipeline_streaming
    from schema_v1 import validate_document, write_json, write_json_stream

    common_kwargs = dict(
        pdf_path        = str(pdf_path),
        images_dir      = images_dir,
        page_start      = args.page_start,
        page_end        = args.page_end,
        table_method    = args.table_method,
        extract_vectors = args.vector_crop,
        extract_images  = not args.no_images,
        extract_tables  = not args.no_tables,
        workers         = args.workers,
        vector_dpi      = args.dpi,
    )

    if args.stream:
        out_dir   = Path(args.output_dir or (pdf_path.stem + "_chunks")).resolve()
        base_name = pdf_path.stem
        logger.info("Streaming mode → %s (chunk_size=%d)", out_dir, args.chunk_size)
        gen     = run_pipeline_streaming(chunk_size=args.chunk_size, **common_kwargs)
        written = write_json_stream(gen, out_dir, base_name)
        logger.info("Wrote %d chunk files to %s", len(written), out_dir)
        return 0

    output_path = Path(args.output).resolve() if args.output else pdf_path.with_suffix(".json")
    logger.info("Output → %s", output_path)

    doc = run_pipeline(**common_kwargs)

    if args.validate:
        valid = validate_document(doc)
        if not valid:
            logger.warning("Validation found issues in the output (see above)")

    write_json(doc, output_path, indent=indent)
    logger.info(
        "Extraction complete — %d elements on %d pages",
        doc["stats"]["total_elements"],
        doc["document_metadata"]["page_count"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
