"""
utils/bbox_utils.py — Bounding-box helpers used across all extractors.

Coordinate system: PDF default (origin bottom-left).
PyMuPDF uses top-left origin — we normalise to top-left throughout.
All bboxes are [x0, y0, x1, y1] with x1>x0, y1>y0.
"""
from __future__ import annotations

from typing import Sequence


Bbox = tuple[float, float, float, float]  # x0, y0, x1, y1


# ──────────────────────────────────────────────────────────────────────────────
# Basic geometry
# ──────────────────────────────────────────────────────────────────────────────

def area(b: Bbox) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def intersection(a: Bbox, b: Bbox) -> Bbox | None:
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return None
    return (x0, y0, x1, y1)


def union(a: Bbox, b: Bbox) -> Bbox:
    return (min(a[0], b[0]), min(a[1], b[1]),
            max(a[2], b[2]), max(a[3], b[3]))


def iou(a: Bbox, b: Bbox) -> float:
    inter = intersection(a, b)
    if inter is None:
        return 0.0
    inter_area = area(inter)
    union_area = area(a) + area(b) - inter_area
    return inter_area / union_area if union_area > 0 else 0.0


def overlap_ratio(a: Bbox, b: Bbox) -> float:
    """Fraction of the smaller box covered by intersection."""
    inter = intersection(a, b)
    if inter is None:
        return 0.0
    return area(inter) / min(area(a), area(b))


def contains(outer: Bbox, inner: Bbox, tolerance: float = 2.0) -> bool:
    return (outer[0] - tolerance <= inner[0] and
            outer[1] - tolerance <= inner[1] and
            outer[2] + tolerance >= inner[2] and
            outer[3] + tolerance >= inner[3])


def expand(b: Bbox, margin: float) -> Bbox:
    return (b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin)


def center(b: Bbox) -> tuple[float, float]:
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def width(b: Bbox) -> float:
    return b[2] - b[0]


def height(b: Bbox) -> float:
    return b[3] - b[1]


def to_list(b: Bbox) -> list[float]:
    return [round(b[0], 2), round(b[1], 2), round(b[2], 2), round(b[3], 2)]


# ──────────────────────────────────────────────────────────────────────────────
# Clustering
# ──────────────────────────────────────────────────────────────────────────────

def cluster_bboxes(bboxes: list[Bbox], gap: float = 5.0) -> list[list[Bbox]]:
    """
    Group bboxes into clusters where any two bboxes in the same cluster
    are within `gap` pixels of each other (union-find).
    """
    if not bboxes:
        return []

    parent = list(range(len(bboxes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union_sets(i: int, j: int) -> None:
        parent[find(i)] = find(j)

    expanded = [expand(b, gap / 2) for b in bboxes]
    for i in range(len(bboxes)):
        for j in range(i + 1, len(bboxes)):
            if intersection(expanded[i], expanded[j]) is not None:
                union_sets(i, j)

    clusters: dict[int, list[Bbox]] = {}
    for i, b in enumerate(bboxes):
        root = find(i)
        clusters.setdefault(root, []).append(b)

    return list(clusters.values())


def merge_cluster_to_bbox(cluster: list[Bbox]) -> Bbox:
    x0 = min(b[0] for b in cluster)
    y0 = min(b[1] for b in cluster)
    x1 = max(b[2] for b in cluster)
    y1 = max(b[3] for b in cluster)
    return (x0, y0, x1, y1)


# ──────────────────────────────────────────────────────────────────────────────
# Filtering helpers
# ──────────────────────────────────────────────────────────────────────────────

def filter_tiny(bboxes: list[Bbox], min_area: float = 100.0) -> list[Bbox]:
    return [b for b in bboxes if area(b) >= min_area]


def non_max_suppression(bboxes: list[Bbox], iou_threshold: float = 0.5) -> list[Bbox]:
    """Keep non-overlapping bboxes, preferring larger ones."""
    sorted_boxes = sorted(bboxes, key=area, reverse=True)
    kept: list[Bbox] = []
    for box in sorted_boxes:
        if all(iou(box, k) < iou_threshold for k in kept):
            kept.append(box)
    return kept
