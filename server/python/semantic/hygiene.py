"""
hygiene.py
==========

Canonical entity model + three-stage hygiene pipeline + five hint helpers
for building the spatial reasoning layer on top of raw DXF output.

Stages
------
  1. `stage1_geometric_normalize`
       - Force-close polylines whose endpoints are within `close_tolerance`
       - Flag degenerate polygons (<3 distinct points)
       - Flag zero-length lines
  2. `stage2_build_containment`
       - Build a parent-child hierarchy over closed polygons using centroid-
         inside-polygon + area-ranking
  3. `stage3_text_consolidation`
       - Merge adjacent TEXT entities that form a single phrase
         (same Y band, small X gap, concatenation passes vocab callback)

Hint helpers
------------
  - `hint_text_inside_polygon`  — text's insertion point lies inside polygon
  - `hint_text_near_polygon`    — text lies within N drawing units of polygon
  - `hint_area_ranking`         — largest-first ordering of polygons
  - `hint_containment`          — parent-child relationship as structural hint
  - `hint_area_prior_for_room`  — polygon area matches known room-size prior

All helpers return `Hint` objects from `hints.py` — the scoring layer.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .hints import Hint

# Local import path tolerance — support both `from semantic.hygiene import X`
# and `from hygiene import X` (the latter is how the user's test runner calls it).
try:
    from .hints import Hint, HintCategory
except ImportError:  # pragma: no cover — flat import fallback
    from hints import Hint, HintCategory  # type: ignore


# ─────────────────────────────────────────────────────── geometry types

@dataclass
class Point:
    x: float
    y: float

    def dist(self, o: "Point") -> float:
        return math.hypot(self.x - o.x, self.y - o.y)


@dataclass
class CanonicalEntity:
    """One uniform representation for every entity we care about.

    `kind` ∈ {LINE, POLYLINE, POLYGON, TEXT, INSERT, ARC, CIRCLE, …}
    Fields are nullable per kind; hygiene stages populate `area`, `centroid`,
    `bbox` for closed shapes.
    """
    id: str
    kind: str
    source_block: str
    layer: str = "0"
    points: list[Point] = field(default_factory=list)
    is_closed: bool = False
    text: Optional[str] = None
    text_height: float = 0.0

    # Populated by hygiene stages
    area: Optional[float] = None
    centroid: Optional[Point] = None
    bbox: Optional[tuple[float, float, float, float]] = None  # (minx, miny, maxx, maxy)

    # Audit trail
    was_merged_from: list[str] = field(default_factory=list)
    was_consolidated_from: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)


@dataclass
class StageReport:
    """Per-stage audit record."""
    stage: str
    entities_in: int
    entities_out: int
    actions: dict[str, int] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────── geometry helpers

def polygon_area(pts: list[Point]) -> float:
    """Signed Shoelace area. Absolute value is the true polygon area."""
    if len(pts) < 3:
        return 0.0
    s = 0.0
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        s += pts[i].x * pts[j].y
        s -= pts[j].x * pts[i].y
    return abs(s) / 2.0


def polygon_centroid(pts: list[Point]) -> Optional[Point]:
    """Geometric centroid via the standard polygon formula (not just the mean
    of vertices, which is wrong for non-uniform polygons)."""
    if len(pts) < 3:
        return None
    cx = cy = 0.0
    a = 0.0
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
        a += cross
        cx += (pts[i].x + pts[j].x) * cross
        cy += (pts[i].y + pts[j].y) * cross
    a = a / 2.0
    if abs(a) < 1e-9:
        # Degenerate — fall back to vertex mean
        mx = sum(p.x for p in pts) / n
        my = sum(p.y for p in pts) / n
        return Point(mx, my)
    return Point(cx / (6 * a), cy / (6 * a))


def bbox_of(pts: list[Point]) -> Optional[tuple[float, float, float, float]]:
    if not pts:
        return None
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def point_in_polygon(p: Point, poly: list[Point]) -> bool:
    """Ray-casting point-in-polygon. Works for any simple polygon, CW or CCW."""
    if len(poly) < 3:
        return False
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i].x, poly[i].y
        xj, yj = poly[j].x, poly[j].y
        intersect = ((yi > p.y) != (yj > p.y)) and (
            p.x < (xj - xi) * (p.y - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersect:
            inside = not inside
        j = i
    return inside


def point_to_polygon_distance(p: Point, poly: list[Point]) -> float:
    """Perpendicular distance from p to the nearest polygon edge.
    Returns 0 if the point is inside the polygon."""
    if len(poly) < 2:
        return float("inf")
    if point_in_polygon(p, poly):
        return 0.0
    best = float("inf")
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        d = _point_to_segment_distance(p, a, b)
        if d < best:
            best = d
    return best


def _point_to_segment_distance(p: Point, a: Point, b: Point) -> float:
    dx, dy = b.x - a.x, b.y - a.y
    len2 = dx * dx + dy * dy
    if len2 < 1e-12:
        return p.dist(a)
    t = max(0.0, min(1.0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    proj = Point(a.x + t * dx, a.y + t * dy)
    return p.dist(proj)


def compute_geometry(e: CanonicalEntity) -> None:
    """Populate area/centroid/bbox on a closed polygon entity. No-op otherwise."""
    if e.kind in ("POLYLINE", "POLYGON") and e.is_closed and len(e.points) >= 3:
        e.area = polygon_area(e.points)
        e.centroid = polygon_centroid(e.points)
        e.bbox = bbox_of(e.points)
    elif e.kind == "LINE" and len(e.points) >= 2:
        e.bbox = bbox_of(e.points)


# ─────────────────────────────────────────────────────── STAGE 1

def stage1_geometric_normalize(
    entities: list[CanonicalEntity],
    *,
    close_tolerance: float = 2.0,
) -> tuple[list[CanonicalEntity], StageReport]:
    """Force-close near-closed polylines, flag degenerate polygons, flag
    zero-length lines. Runs geometry computation on every closed polygon."""
    report = StageReport(
        stage="stage1_geometric_normalize",
        entities_in=len(entities),
        entities_out=0,
    )
    actions: dict[str, int] = defaultdict(int)

    for e in entities:
        # LINE — zero-length check
        if e.kind == "LINE" and len(e.points) == 2:
            if e.points[0].dist(e.points[1]) < 1e-6:
                e.flags.append("zero_length_line")
                actions["flagged_zero_length_line"] += 1
            continue

        # POLYLINE — maybe force-close
        if e.kind == "POLYLINE" and len(e.points) >= 3:
            if not e.is_closed:
                gap = e.points[0].dist(e.points[-1])
                if 0 < gap <= close_tolerance:
                    e.is_closed = True
                    e.flags.append(f"force_closed_gap_{gap:.3f}")
                    actions["force_closed"] += 1
            if e.is_closed:
                # Count distinct vertices for degeneracy check
                distinct: set[tuple[float, float]] = set()
                for p in e.points:
                    distinct.add((round(p.x, 3), round(p.y, 3)))
                if len(distinct) < 3:
                    e.flags.append("degenerate")
                    actions["flagged_degenerate"] += 1
                    e.is_closed = False
                    continue
                compute_geometry(e)
            continue

        # POLYGON — compute geometry if not already
        if e.kind == "POLYGON" and e.is_closed and len(e.points) >= 3:
            if e.area is None:
                compute_geometry(e)

    report.entities_out = len(entities)
    report.actions = dict(actions)
    return entities, report


# ─────────────────────────────────────────────────────── STAGE 2 — containment

@dataclass
class ContainmentNode:
    polygon_id: str
    parent_id: Optional[str] = None
    children: list[str] = field(default_factory=list)
    depth: int = 0


def stage2_build_containment(
    entities: list[CanonicalEntity],
) -> tuple[dict[str, ContainmentNode], StageReport]:
    """For every closed polygon, identify its immediate containing polygon
    (smallest one whose footprint encloses this polygon's centroid).
    Returns an id → ContainmentNode map + stage report."""
    closed_polys = [
        e for e in entities
        if e.kind in ("POLYLINE", "POLYGON") and e.is_closed
        and e.area and e.area > 0 and e.centroid is not None
    ]
    report = StageReport(
        stage="stage2_containment",
        entities_in=len(entities),
        entities_out=len(closed_polys),
    )
    if not closed_polys:
        report.notes.append("0 closed polygons considered")
        return {}, report

    # For each polygon, find its immediate parent = smallest enclosing polygon
    # (sort candidates by area ascending — first match wins).
    by_area_asc = sorted(closed_polys, key=lambda e: e.area or 0)
    nodes: dict[str, ContainmentNode] = {e.id: ContainmentNode(polygon_id=e.id) for e in closed_polys}

    for child in closed_polys:
        if child.centroid is None:
            continue
        parent_id: Optional[str] = None
        for candidate in by_area_asc:
            if candidate.id == child.id:
                continue
            if (candidate.area or 0) <= (child.area or 0):
                continue
            # Is child.centroid inside candidate?
            if point_in_polygon(child.centroid, candidate.points):
                parent_id = candidate.id
                break
        if parent_id is not None:
            nodes[child.id].parent_id = parent_id
            nodes[parent_id].children.append(child.id)

    # Compute depth
    def _depth(node_id: str, seen: set[str]) -> int:
        if node_id in seen:
            return 0
        seen.add(node_id)
        n = nodes[node_id]
        if n.parent_id is None or n.parent_id not in nodes:
            return 0
        return 1 + _depth(n.parent_id, seen)

    for nid in nodes:
        nodes[nid].depth = _depth(nid, set())

    report.actions["parent_child_link"] = sum(1 for n in nodes.values() if n.parent_id)
    return nodes, report


# ─────────────────────────────────────────────────────── STAGE 3 — text consolidation

def stage3_text_consolidation(
    entities: list[CanonicalEntity],
    *,
    vocab_concat_check: Callable[[str], bool],
    y_tolerance: float = 1.0,
    x_max_gap: float = 6.0,
) -> tuple[list[CanonicalEntity], StageReport]:
    """Merge adjacent TEXT entities that form a single phrase.

    Heuristic: two TEXT entities that (a) sit on the same Y baseline within
    `y_tolerance`, (b) are within `x_max_gap` drawing-units apart on X, and
    (c) concatenated in RTL order pass `vocab_concat_check` — get merged into
    one consolidated TEXT entity. The originals are kept in the entity list;
    the new consolidated entity is appended with `was_consolidated_from`
    listing the source ids."""
    report = StageReport(
        stage="stage3_text_consolidation",
        entities_in=len(entities),
        entities_out=0,
    )
    texts = [e for e in entities if e.kind == "TEXT" and e.text and e.points]

    # Bucket by (source_block, rounded y). Texts on the same line of the same
    # sheet are consolidation candidates.
    buckets: dict[tuple[str, int], list[CanonicalEntity]] = defaultdict(list)
    for t in texts:
        key = (t.source_block, int(round(t.points[0].y / max(y_tolerance, 0.1))))
        buckets[key].append(t)

    new_entities: list[CanonicalEntity] = []
    consolidated_counter = 0
    consumed: set[str] = set()

    for (_, _), bucket in buckets.items():
        if len(bucket) < 2:
            continue
        # Sort by X — we concatenate from RIGHT to LEFT because Hebrew is RTL.
        bucket_sorted = sorted(bucket, key=lambda t: -t.points[0].x)
        i = 0
        while i < len(bucket_sorted) - 1:
            left = bucket_sorted[i]
            right = bucket_sorted[i + 1]
            if left.id in consumed or right.id in consumed:
                i += 1
                continue
            # X gap (RTL: left.x > right.x)
            gap = left.points[0].x - right.points[0].x
            if gap <= 0 or gap > x_max_gap:
                i += 1
                continue
            # Y baseline delta
            y_delta = abs(left.points[0].y - right.points[0].y)
            if y_delta > y_tolerance:
                i += 1
                continue
            # Try concatenations in both orders — pick the one that passes vocab
            merged_rtl = f"{left.text} {right.text}"    # visual RTL
            merged_ltr = f"{right.text} {left.text}"    # logical LTR
            for candidate in (merged_rtl, merged_ltr):
                if vocab_concat_check(candidate):
                    consolidated_counter += 1
                    consumed.add(left.id)
                    consumed.add(right.id)
                    new_entity = CanonicalEntity(
                        id=f"consolidated_{consolidated_counter}",
                        kind="TEXT",
                        source_block=left.source_block,
                        layer=left.layer,
                        points=[Point(
                            (left.points[0].x + right.points[0].x) / 2,
                            left.points[0].y,
                        )],
                        text=candidate,
                        text_height=max(left.text_height, right.text_height),
                        was_consolidated_from=[left.id, right.id],
                    )
                    new_entities.append(new_entity)
                    break
            i += 1

    out_entities = entities + new_entities
    report.entities_out = len(out_entities)
    report.actions["consolidated_cluster"] = consolidated_counter
    if consolidated_counter:
        report.notes.append(f"{consolidated_counter} consolidated text entities added")
    return out_entities, report


# ─────────────────────────────────────────────────────── hint helpers

def _is_semantic_room(classif: dict) -> bool:
    """True if a classification represents a room-like label."""
    return (classif.get("category") == "rooms"
            and classif.get("match_type") not in ("unclassified", "noise"))


def hint_text_inside_polygon(
    texts: list[CanonicalEntity],
    polygons: list[CanonicalEntity],
    classifications: dict[str, dict],
) -> list[Hint]:
    """For every (text, polygon) pair where the text's insertion point lies
    inside the polygon, emit a SEMANTIC+POSITIONAL hint tying them together."""
    hints: list[Hint] = []
    for t in texts:
        if not t.points:
            continue
        classif = classifications.get(t.id)
        if not classif:
            continue
        if classif.get("match_type") in ("unclassified", "noise"):
            continue
        cat = classif.get("category")
        key = classif.get("key")
        if cat not in ("rooms", "boundaries", "construction_elements", "sheet_labels"):
            continue
        tp = t.points[0]
        for poly in polygons:
            if not poly.points or not poly.is_closed:
                continue
            if not point_in_polygon(tp, poly.points):
                continue
            # Generate hypothesis based on category
            if cat == "rooms":
                hyp = f"polygon:{poly.id}:is_room:{key}"
            elif cat == "boundaries":
                hyp = f"polygon:{poly.id}:is_boundary:{key}"
            elif cat == "sheet_labels":
                hyp = f"polygon:{poly.id}:is_sheet:{key}"
            else:
                hyp = f"polygon:{poly.id}:contains:{key}"
            strength = 0.85 if classif.get("match_type") == "canonical_exact" else 0.7
            hints.append(Hint(
                hint_type="text_inside_polygon",
                category=HintCategory.POSITIONAL,
                hypothesis=hyp,
                supports=True,
                strength=strength,
                evidence=(
                    f"text {t.text!r} (at {tp.x:.1f},{tp.y:.1f}) lies inside "
                    f"polygon {poly.id} (area={poly.area:.1f})"
                ),
                source_entities=[t.id, poly.id],
            ))
    return hints


def hint_text_near_polygon(
    texts: list[CanonicalEntity],
    polygons: list[CanonicalEntity],
    classifications: dict[str, dict],
    *,
    max_distance: float = 4.0,
) -> list[Hint]:
    """For every (text, polygon) pair where the text lies within `max_distance`
    drawing units of the polygon edge (but NOT inside), emit a weaker hint."""
    hints: list[Hint] = []
    for t in texts:
        if not t.points:
            continue
        classif = classifications.get(t.id)
        if not classif:
            continue
        if classif.get("match_type") in ("unclassified", "noise"):
            continue
        cat = classif.get("category")
        key = classif.get("key")
        if cat not in ("rooms", "boundaries", "construction_elements"):
            continue
        tp = t.points[0]
        for poly in polygons:
            if not poly.points or not poly.is_closed:
                continue
            if point_in_polygon(tp, poly.points):
                continue  # already covered by text_inside_polygon
            d = point_to_polygon_distance(tp, poly.points)
            if d <= 0 or d > max_distance:
                continue
            hyp_prefix = {
                "rooms": "polygon:{}:is_room:{}",
                "boundaries": "polygon:{}:is_boundary:{}",
                "construction_elements": "polygon:{}:has_element:{}",
            }[cat]
            hyp = hyp_prefix.format(poly.id, key)
            # Strength decays with distance
            strength = max(0.3, 0.6 * (1.0 - d / max_distance))
            hints.append(Hint(
                hint_type="text_near_polygon",
                category=HintCategory.POSITIONAL,
                hypothesis=hyp,
                supports=True,
                strength=round(strength, 3),
                evidence=(
                    f"text {t.text!r} is {d:.1f} units from polygon {poly.id} "
                    f"edge (< {max_distance:.1f})"
                ),
                source_entities=[t.id, poly.id],
            ))
    return hints


def hint_area_ranking(
    polygons: list[CanonicalEntity],
    sheet_id: str,
) -> list[Hint]:
    """Emit a structural hint naming the largest polygon on the sheet as the
    probable sheet outline, the next few as likely floor footprints."""
    if not polygons:
        return []
    sorted_polys = sorted(polygons, key=lambda p: -(p.area or 0))
    hints: list[Hint] = []
    largest = sorted_polys[0]
    hints.append(Hint(
        hint_type="area_ranking",
        category=HintCategory.STRUCTURAL,
        hypothesis=f"polygon:{largest.id}:is_sheet_outline",
        supports=True,
        strength=0.6,
        evidence=(
            f"largest polygon on sheet {sheet_id} "
            f"(area={largest.area:.1f} of {len(polygons)} polygons)"
        ),
        source_entities=[largest.id],
    ))
    # Second + third largest often = building outline + interior block
    for rank, p in enumerate(sorted_polys[1:3], start=2):
        hints.append(Hint(
            hint_type="area_ranking",
            category=HintCategory.STRUCTURAL,
            hypothesis=f"polygon:{p.id}:is_building_footprint",
            supports=True,
            strength=0.4,
            evidence=f"rank-{rank} largest polygon (area={p.area:.1f})",
            source_entities=[p.id],
        ))
    return hints


def hint_containment(
    containment: dict,
    polygons_by_id: dict[str, CanonicalEntity],
) -> list[Hint]:
    """Emit hints from the parent-child containment graph: parent is probably
    the floor outline of which the child is an interior room."""
    hints: list[Hint] = []
    for child_id, node in containment.items():
        if node.parent_id is None:
            continue
        parent = polygons_by_id.get(node.parent_id)
        child = polygons_by_id.get(child_id)
        if not parent or not child:
            continue
        # Children of the floor outline are interior rooms
        hints.append(Hint(
            hint_type="containment",
            category=HintCategory.STRUCTURAL,
            hypothesis=f"polygon:{child_id}:is_interior_of:{parent.id}",
            supports=True,
            strength=0.55,
            evidence=(
                f"polygon {child_id} (area={child.area:.1f}) centroid lies "
                f"inside polygon {parent.id} (area={parent.area:.1f})"
            ),
            source_entities=[child_id, parent.id],
        ))
    return hints


def hint_area_prior_for_room(
    polygon: CanonicalEntity,
    room_key: str,
    priors: dict[str, tuple[float, float]],
) -> list[Hint]:
    """Given a polygon + a proposed room_key, check the polygon's area against
    the statistical prior (min, max) in m². Emits a SUPPORTING hint if in
    range, a CONTRADICTING hint if way off."""
    if polygon.area is None or room_key not in priors:
        return []
    lo, hi = priors[room_key]
    a = polygon.area
    hyp = f"polygon:{polygon.id}:is_room:{room_key}"
    if lo <= a <= hi:
        return [Hint(
            hint_type="area_prior",
            category=HintCategory.STATISTICAL,
            hypothesis=hyp,
            supports=True,
            strength=0.5,
            evidence=f"area {a:.1f} m² in typical {room_key} range [{lo}, {hi}]",
            source_entities=[polygon.id],
        )]
    # Out of range — contradicting hint
    if a < lo * 0.5 or a > hi * 2.0:
        dev = "too small" if a < lo else "too large"
        return [Hint(
            hint_type="area_prior",
            category=HintCategory.STATISTICAL,
            hypothesis=hyp,
            supports=False,
            strength=0.7,
            evidence=f"area {a:.1f} m² {dev} for {room_key} (prior [{lo}, {hi}])",
            source_entities=[polygon.id],
        )]
    # Marginally off — soft contradiction
    return [Hint(
        hint_type="area_prior",
        category=HintCategory.STATISTICAL,
        hypothesis=hyp,
        supports=False,
        strength=0.3,
        evidence=f"area {a:.1f} m² marginally outside {room_key} prior [{lo}, {hi}]",
        source_entities=[polygon.id],
    )]
