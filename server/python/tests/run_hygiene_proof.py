"""
run_hygiene_proof.py
====================

End-to-end proof harness for the hygiene + hints pipeline.

Loads a DXF, runs the full hygiene/classification/reconstruction/hint flow
on a single target sheet, and dumps a JSON artifact + console summary.

Usage:
    python run_hygiene_proof.py <dxf_path> [target_sheet]

The default target_sheet is auto-picked: the modelspace block with the most
LINE entities (proxy for the floor-plan sheet).
"""
from __future__ import annotations

import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

# Make Windows cp1252 console tolerate Hebrew + arrows.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "buffer"):
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# Make `from semantic.X import Y` and bare `from X import Y` both work.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent             # server/python
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "semantic"))

import ezdxf  # noqa: E402

from semantic.semantic_classifier import SemanticClassifier, MatchType  # noqa: E402
from semantic.hints import Hint, rank_hypotheses  # noqa: E402
from semantic.hygiene import (  # noqa: E402
    Point, CanonicalEntity,
    stage1_geometric_normalize, stage2_build_containment,
    stage3_text_consolidation,
    hint_text_inside_polygon, hint_text_near_polygon,
    hint_area_ranking, hint_containment, hint_area_prior_for_room,
)
from semantic.polygon_reconstruction import reconstruct_polygons_from_lines  # noqa: E402


UPLUS = re.compile(r"\\U\+([0-9A-Fa-f]{4})")


def decode_hebrew(s: str) -> str:
    return UPLUS.sub(lambda m: chr(int(m.group(1), 16)), s)


# -------------------------------------------------------------------
# 1. DXF → CanonicalEntity[]
# -------------------------------------------------------------------

def dxf_to_canonical(doc) -> list[CanonicalEntity]:
    entities: list[CanonicalEntity] = []
    counter = 0
    for block in doc.blocks:
        if block.name.startswith("*Paper_Space"):
            continue
        for e in block:
            counter += 1
            eid = f"e{counter}"
            try:
                t = e.dxftype()
                if t == "LINE":
                    entities.append(CanonicalEntity(
                        id=eid, kind="LINE",
                        source_block=block.name, layer=e.dxf.layer,
                        points=[
                            Point(float(e.dxf.start.x), float(e.dxf.start.y)),
                            Point(float(e.dxf.end.x),   float(e.dxf.end.y)),
                        ],
                    ))
                elif t == "POLYLINE":
                    pts = [Point(float(v.dxf.location.x), float(v.dxf.location.y))
                           for v in e.vertices]
                    entities.append(CanonicalEntity(
                        id=eid, kind="POLYLINE",
                        source_block=block.name, layer=e.dxf.layer,
                        points=pts, is_closed=bool(e.is_closed),
                    ))
                elif t == "LWPOLYLINE":
                    pts = [Point(float(p[0]), float(p[1]))
                           for p in e.get_points(format="xy")]
                    entities.append(CanonicalEntity(
                        id=eid, kind="POLYLINE",
                        source_block=block.name, layer=e.dxf.layer,
                        points=pts, is_closed=bool(e.closed),
                    ))
                elif t in ("TEXT", "MTEXT"):
                    raw = e.dxf.text if t == "TEXT" else e.text
                    if not raw or not raw.strip():
                        continue
                    pos = e.dxf.insert
                    entities.append(CanonicalEntity(
                        id=eid, kind="TEXT",
                        source_block=block.name, layer=e.dxf.layer,
                        points=[Point(float(pos.x), float(pos.y))],
                        text=decode_hebrew(raw),
                        text_height=float(getattr(e.dxf, "height", 0) or 2.5),
                    ))
            except Exception:
                continue
    return entities


def pick_target_sheet(canonical: list[CanonicalEntity]) -> str:
    """Pick the block with the most LINE entities — proxy for floor-plan sheet."""
    line_counts: Counter[str] = Counter()
    for e in canonical:
        if e.kind == "LINE":
            line_counts[e.source_block] += 1
    if not line_counts:
        return "0"
    return line_counts.most_common(1)[0][0]


def _scrub(x):
    """Recursively replace surrogate halves so json.dump won't crash on Hebrew."""
    if isinstance(x, str):
        return x.encode("utf-8", "replace").decode("utf-8")
    if isinstance(x, list):
        return [_scrub(v) for v in x]
    if isinstance(x, dict):
        return {k: _scrub(v) for k, v in x.items()}
    return x


# -------------------------------------------------------------------
# Main
# -------------------------------------------------------------------

def main() -> int:
    if len(sys.argv) < 2:
        print("usage: run_hygiene_proof.py <dxf_path> [target_sheet]", file=sys.stderr)
        return 2
    dxf_path = sys.argv[1]
    forced_sheet = sys.argv[2] if len(sys.argv) >= 3 else None

    print(f"Loading DXF: {dxf_path}")
    doc = ezdxf.readfile(dxf_path)
    canonical = dxf_to_canonical(doc)
    print(f"Canonical entities: {len(canonical)}")

    target_sheet = forced_sheet or pick_target_sheet(canonical)
    print(f"Target sheet: {target_sheet}")

    # Classify all texts
    print("\n=== Classifying texts ===")
    vocab_path = ROOT / "semantic" / "vocabulary.yaml"
    clf = SemanticClassifier.from_yaml(vocab_path)

    classifications: dict[str, dict] = {}
    for e in canonical:
        if e.kind == "TEXT" and e.text:
            classifications[e.id] = clf.classify(e.text).to_dict()
    semantic_count = sum(
        1 for c in classifications.values()
        if c["category"] not in (None, "noise", "dimension_or_numeric")
    )
    print(f"Classified {semantic_count} texts semantically "
          f"(out of {len(classifications)} total text entities)")

    # Stage 1
    print("\n=== Stage 1: Geometric Normalization ===")
    canonical, report1 = stage1_geometric_normalize(canonical, close_tolerance=2.0)
    print(f"  In:  {report1.entities_in}")
    print(f"  Out: {report1.entities_out}")
    print(f"  Actions: {report1.actions}")

    # Stage 3
    print("\n=== Stage 3: Text Consolidation ===")

    def vocab_concat_check(s: str) -> bool:
        r = clf.classify(s)
        return (r.match_type not in (MatchType.UNCLASSIFIED, MatchType.NOISE)
                and r.category not in (None, "noise", "dimension_or_numeric"))

    canonical, report3 = stage3_text_consolidation(
        canonical, vocab_concat_check=vocab_concat_check,
        y_tolerance=1.0, x_max_gap=6.0,
    )
    print(f"  In:  {report3.entities_in}")
    print(f"  Out: {report3.entities_out}")
    print(f"  Actions: {report3.actions}")

    for e in canonical:
        if (e.kind == "TEXT" and e.text and e.was_consolidated_from
                and e.id not in classifications):
            classifications[e.id] = clf.classify(e.text).to_dict()

    # Stage 2a — reconstruct polygons from LINEs on the target sheet
    print("\n=== Stage 2a: Polygon Reconstruction from Lines ===")
    sheet_entities = [e for e in canonical if e.source_block == target_sheet]
    sheet_lines = [e for e in sheet_entities if e.kind == "LINE"]
    print(f"  Target sheet: {target_sheet} ({len(sheet_entities)} entities)")
    print(f"  LINE entities: {len(sheet_lines)}")

    reconstructed = reconstruct_polygons_from_lines(
        sheet_lines,
        snap_tolerance=2.0,
        min_polygon_area=2.0,
        max_polygon_vertices=20,
    )
    print(f"  Reconstructed polygons: {len(reconstructed)}")
    if reconstructed:
        areas = sorted((p.area for p in reconstructed if p.area), reverse=True)[:10]
        print(f"  Top 10 polygon areas: {[f'{a:.1f}' for a in areas]}")

    sheet_entities = sheet_entities + reconstructed
    canonical = ([e for e in canonical if e.source_block != target_sheet]
                 + sheet_entities)

    # Stage 2b — containment
    print("\n=== Stage 2b: Containment Hierarchy ===")
    containment, report2 = stage2_build_containment(sheet_entities)
    print(f"  Polygons in hierarchy: {report2.entities_out}")
    print(f"  Parent-child links: {report2.actions.get('parent_child_link', 0)}")

    # Hints
    print(f"\n=== HINT GENERATION for {target_sheet} ===")
    sheet_polygons = [
        e for e in sheet_entities
        if e.kind in ("POLYLINE", "POLYGON") and e.is_closed
        and e.area and e.area > 0
    ]
    sheet_texts = [e for e in sheet_entities if e.kind == "TEXT" and e.text]
    print(f"  Closed polygons: {len(sheet_polygons)}")
    print(f"  Text entities:   {len(sheet_texts)}")

    all_hints: list[Hint] = []
    all_hints.extend(hint_area_ranking(sheet_polygons, target_sheet))

    inside_hints = hint_text_inside_polygon(sheet_texts, sheet_polygons, classifications)
    all_hints.extend(inside_hints)
    print(f"  'text inside polygon' hints: {len(inside_hints)}")

    near_hints = hint_text_near_polygon(sheet_texts, sheet_polygons, classifications)
    all_hints.extend(near_hints)
    print(f"  'text near polygon' hints: {len(near_hints)}")

    polygons_by_id = {p.id: p for p in sheet_polygons}
    cont_hints = hint_containment(containment, polygons_by_id)
    all_hints.extend(cont_hints)
    print(f"  containment hints: {len(cont_hints)}")

    AREA_PRIORS = {
        "kitchen":        (4.0, 18.0),
        "living_room":    (12.0, 40.0),
        "bedroom":        (7.0, 25.0),
        "bathroom_main":  (2.0, 10.0),
        "toilet":         (1.0, 4.0),
        "safe_room":      (7.0, 12.0),
        "kitchen_dining": (10.0, 30.0),
    }
    prior_hints: list[Hint] = []
    for h in inside_hints:
        if ":is_room:" in h.hypothesis:
            poly_id, room_key = h.hypothesis.replace("polygon:", "").split(":is_room:")
            poly = polygons_by_id.get(poly_id)
            if poly:
                prior_hints.extend(hint_area_prior_for_room(poly, room_key, AREA_PRIORS))
    all_hints.extend(prior_hints)
    print(f"  area prior hints: {len(prior_hints)}")
    print(f"\n  TOTAL HINTS: {len(all_hints)}")

    # Rank
    print("\n=== TOP SCORED HYPOTHESES ===")
    ranked = rank_hypotheses(all_hints)
    print(f"Distinct hypotheses: {len(ranked)}")
    for i, sh in enumerate(ranked[:10]):
        print(f"\n[{i+1}] {sh.hypothesis}  → confidence {sh.confidence:.3f}")
        print(f"    Category breakdown: {sh.category_breakdown}")
        for hint in sorted(sh.supporting, key=lambda x: -x.strength)[:3]:
            print(f"    ✓ [{hint.category.value}] {hint.evidence} "
                  f"(strength {hint.strength:.2f})")
        for hint in sh.contradicting:
            print(f"    ✗ [{hint.category.value}] {hint.evidence} "
                  f"(strength {hint.strength:.2f})")

    # Write artifact
    out = {
        "target_sheet": target_sheet,
        "entities_after_hygiene": len(canonical),
        "classifications_total": len(classifications),
        "stage_reports": [
            {"stage": report1.stage, "actions": report1.actions,
             "in": report1.entities_in, "out": report1.entities_out},
            {"stage": report3.stage, "actions": report3.actions,
             "in": report3.entities_in, "out": report3.entities_out,
             "notes": report3.notes},
            {"stage": report2.stage, "actions": report2.actions,
             "in": report2.entities_in, "out": report2.entities_out,
             "notes": report2.notes},
        ],
        "hint_counts": {
            "total": len(all_hints),
            "by_type": dict(Counter(h.hint_type for h in all_hints).most_common()),
        },
        "top_hypotheses": [sh.to_dict() for sh in ranked[:30]],
    }
    out_path = HERE / "hint_scoring_proof.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(_scrub(out), f, ensure_ascii=False, indent=2)
    print(f"\nSaved: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
