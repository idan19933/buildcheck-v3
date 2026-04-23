"""
polygon_reconstruction.py
=========================

Reconstruct closed polygons from sets of LINE entities.

This is necessary for DXFs where rooms/boundaries were drawn as discrete
line segments rather than as closed POLYLINEs. Very common in R10
save-downs and files exploded from named blocks.

Approach:
  1. Snap line endpoints within a tolerance (to handle imprecise edits)
  2. Build a graph: nodes are snapped points, edges are line segments
  3. Find minimal cycles in the graph using a face-finding algorithm
  4. Convert each cycle to a polygon, validate by Shoelace area

We use a simpler heuristic than full planar-graph face-finding: we find
cycles via per-node BFS, which catches closed rooms drawn as line segments
even if imprecise.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Optional

# Import-path tolerance — support both packaged and flat layouts.
try:
    from .hygiene import Point, CanonicalEntity, polygon_area, polygon_centroid, bbox_of
except ImportError:  # pragma: no cover — flat import fallback
    from hygiene import Point, CanonicalEntity, polygon_area, polygon_centroid, bbox_of  # type: ignore


def _snap_key(p: Point, tolerance: float) -> tuple[int, int]:
    """Snap a point to a grid so nearby points share a key."""
    return (round(p.x / tolerance), round(p.y / tolerance))


def reconstruct_polygons_from_lines(
    lines: list[CanonicalEntity],
    *,
    snap_tolerance: float = 2.0,   # drawing units
    min_polygon_area: float = 1.0,
    max_polygon_vertices: int = 40,
) -> list[CanonicalEntity]:
    """
    Given a list of LINE entities, produce inferred POLYGON entities.

    Returns new CanonicalEntity objects with kind='POLYGON'. Each polygon's
    `was_merged_from` lists the source line IDs for full audit.
    """
    # Step 1: snap endpoints, build edge list
    node_points: dict[tuple[int, int], Point] = {}
    edges: list[tuple[tuple, tuple, str]] = []  # (key_a, key_b, line_id)
    adjacency: dict[tuple, set[tuple]] = defaultdict(set)

    for line in lines:
        if line.kind != "LINE" or len(line.points) != 2:
            continue
        a, b = line.points
        ka = _snap_key(a, snap_tolerance)
        kb = _snap_key(b, snap_tolerance)
        if ka == kb:
            continue  # zero-length after snapping
        node_points.setdefault(ka, a)
        node_points.setdefault(kb, b)
        edges.append((ka, kb, line.id))
        adjacency[ka].add(kb)
        adjacency[kb].add(ka)

    if not edges:
        return []

    # Step 2: find cycles via iterative shortest-cycle search around each node.
    # This is O(n × E) in the worst case but works well in practice on
    # well-formed drawings where each room has ~4-10 edges.
    found_cycles: list[list[tuple]] = []
    cycle_signatures: set[frozenset] = set()
    lines_to_ids = {
        (min(ka, kb), max(ka, kb)): line_id
        for ka, kb, line_id in edges
    }

    for start in list(adjacency.keys()):
        # BFS to find shortest cycle containing `start`.
        # Catches most room polygons even if not perfect.
        for next_node in adjacency[start]:
            cycle = _find_shortest_cycle(
                start, next_node, adjacency,
                max_length=max_polygon_vertices,
            )
            if cycle and len(cycle) >= 3:
                sig = frozenset(cycle)
                if sig in cycle_signatures:
                    continue
                cycle_signatures.add(sig)
                found_cycles.append(cycle)

    # Step 3: convert cycles to polygon entities
    polygons: list[CanonicalEntity] = []
    for i, cycle in enumerate(found_cycles):
        pts = [node_points[k] for k in cycle]
        area = polygon_area(pts)
        if area < min_polygon_area:
            continue
        # Collect source line ids
        source_lines = []
        for j in range(len(cycle)):
            a, b = cycle[j], cycle[(j + 1) % len(cycle)]
            key = (min(a, b), max(a, b))
            lid = lines_to_ids.get(key)
            if lid:
                source_lines.append(lid)

        poly = CanonicalEntity(
            id=f"reconstructed_poly_{i}",
            kind="POLYGON",
            source_block=lines[0].source_block if lines else "",
            layer="0",
            points=pts,
            is_closed=True,
            was_merged_from=source_lines,
            flags=[f"reconstructed_from_{len(source_lines)}_lines"],
        )
        poly.area = area
        poly.centroid = polygon_centroid(pts)
        poly.bbox = bbox_of(pts)
        polygons.append(poly)

    # Step 4: dedupe — cycles might be found multiple times from different
    # starting points. Filter to keep only the smallest cycle at each spot.
    polygons.sort(key=lambda p: p.area or 0)
    deduped: list[CanonicalEntity] = []
    for p in polygons:
        # Skip if a smaller already-kept polygon has the same centroid
        if p.centroid and any(
            q.centroid
            and abs(p.centroid.x - q.centroid.x) < snap_tolerance * 2
            and abs(p.centroid.y - q.centroid.y) < snap_tolerance * 2
            and abs((p.area or 0) - (q.area or 0)) / max(p.area or 1, 1) < 0.05
            for q in deduped
        ):
            continue
        deduped.append(p)

    return deduped


def _find_shortest_cycle(
    start: tuple,
    first_step: tuple,
    adjacency: dict[tuple, set[tuple]],
    *,
    max_length: int,
) -> Optional[list[tuple]]:
    """
    BFS from (start → first_step) looking for a path back to start
    that doesn't retrace the first edge. Returns the cycle nodes
    (without repeating start at the end).
    """
    visited: dict[tuple, tuple] = {first_step: start}  # node -> parent
    queue: list[tuple] = [first_step]
    length_to: dict[tuple, int] = {first_step: 1}

    while queue:
        node = queue.pop(0)
        if length_to[node] > max_length:
            continue
        for nbr in adjacency[node]:
            if nbr == start and length_to[node] >= 2:
                # Found a cycle
                cycle = [start]
                cur = node
                while cur != start:
                    cycle.append(cur)
                    cur = visited[cur]
                return cycle
            if nbr in visited:
                continue
            visited[nbr] = node
            length_to[nbr] = length_to[node] + 1
            queue.append(nbr)

    return None
