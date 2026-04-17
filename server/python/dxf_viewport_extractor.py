#!/usr/bin/env python3
"""
DXF Viewport Extractor for BuildCheck v2.

Reads a בקשת היתר DXF file and extracts structured data from each VIEWPORT block.
Each viewport typically represents a separate sheet in the permit set:
  - Index page (תיק מידע)
  - Floor plans (קרקע, קומה א', גג)
  - Cross-sections (חתך 1-1, חתך 2-2)
  - Elevations (חזיות — צפונית, דרומית, מזרחית, מערבית)
  - Parking sections (חתך חנייה)
  - Survey / site plan (מדידה, תוכנית העמדה)

Input : DXF file path (argv[1])
Output: JSON to stdout. On error, JSON with {"error": ...} and exit 1.

Usage : python dxf_viewport_extractor.py path/to/file.dxf
"""

import sys
import json
import re
from collections import Counter

try:
    import ezdxf
except ImportError:
    print(json.dumps({"error": "ezdxf not installed. Run: pip install -r requirements.txt"}))
    sys.exit(1)


# ------------------------------------------------------------------ helpers

_UNICODE_ESCAPE_RE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")


def _combine_and_scrub_surrogates(s: str) -> str:
    """Combine UTF-16 surrogate pairs into single code points; drop lone surrogates."""
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        o = ord(c)
        if 0xD800 <= o <= 0xDBFF and i + 1 < n:
            o2 = ord(s[i + 1])
            if 0xDC00 <= o2 <= 0xDFFF:
                combined = ((o - 0xD800) * 0x400) + (o2 - 0xDC00) + 0x10000
                out.append(chr(combined))
                i += 2
                continue
        if 0xD800 <= o <= 0xDFFF:
            # Lone surrogate — drop it (can't be encoded as UTF-8 or JSON)
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def decode_unicode_escapes(text: str) -> str:
    """Convert ezdxf \\U+XXXX escapes to actual characters, then repair surrogates."""
    decoded = _UNICODE_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
    return _combine_and_scrub_surrogates(decoded)


def _safe_coord(point, idx: int, default: float = 0.0) -> float:
    try:
        return round(float(point[idx]), 2)
    except (IndexError, TypeError, ValueError):
        return default


# ------------------------------------------------------------------ extraction

def extract_viewport_texts(block) -> list:
    """Extract TEXT and MTEXT entities, decoded."""
    texts = []
    for entity in block:
        etype = entity.dxftype()
        if etype not in ("TEXT", "MTEXT"):
            continue
        try:
            if etype == "TEXT":
                raw = entity.dxf.text
            else:  # MTEXT
                raw = entity.text if hasattr(entity, "text") else entity.dxf.text
            decoded = decode_unicode_escapes(raw).strip()
            if not decoded:
                continue
            x = _safe_coord(entity.dxf.insert, 0)
            y = _safe_coord(entity.dxf.insert, 1)
            height = round(float(getattr(entity.dxf, "height", 0) or 0), 2)
            texts.append({
                "text": decoded,
                "x": x,
                "y": y,
                "height": height,
            })
        except Exception:
            continue
    return texts


def extract_viewport_geometry(block) -> dict:
    """Summarise geometry in the block. Avoids dumping every line."""
    entity_counts = Counter()
    lines = []
    inserts = []
    circles = 0
    arcs = 0

    for entity in block:
        etype = entity.dxftype()
        entity_counts[etype] += 1

        try:
            if etype == "LINE":
                lines.append((
                    _safe_coord(entity.dxf.start, 0), _safe_coord(entity.dxf.start, 1),
                    _safe_coord(entity.dxf.end, 0), _safe_coord(entity.dxf.end, 1),
                    entity.dxf.layer,
                ))
            elif etype == "INSERT":
                inserts.append(entity.dxf.name)
            elif etype == "CIRCLE":
                circles += 1
            elif etype == "ARC":
                arcs += 1
        except Exception:
            continue

    # Bounding box from lines (capped for perf)
    bbox = None
    if lines:
        sample = lines[:5000]
        xs = [v for ln in sample for v in (ln[0], ln[2])]
        ys = [v for ln in sample for v in (ln[1], ln[3])]
        if xs and ys:
            bbox = {
                "x_min": round(min(xs), 2),
                "x_max": round(max(xs), 2),
                "y_min": round(min(ys), 2),
                "y_max": round(max(ys), 2),
                "width": round(max(xs) - min(xs), 2),
                "height": round(max(ys) - min(ys), 2),
            }

    layers = sorted({ln[4] for ln in lines[:2000]})

    return {
        "entity_counts": dict(entity_counts),
        "total_entities": sum(entity_counts.values()),
        "line_count": len(lines),
        "polyline_count": entity_counts.get("POLYLINE", 0) + entity_counts.get("LWPOLYLINE", 0) + entity_counts.get("POLYLINE2D", 0),
        "insert_count": len(inserts),
        "circle_count": circles,
        "arc_count": arcs,
        "bounding_box": bbox,
        "insert_names": sorted(set(inserts))[:20],
        "layers_used": layers[:40],
    }


def extract_dimensions_from_texts(texts: list) -> dict:
    """Classify text tokens into heights / dimensions / percentages / scales / Hebrew labels."""
    heights, dimensions, percentages, scales, labels = [], [], [], [], []

    re_height = re.compile(r"^[+\-]\d+\.?\d*$")
    re_int = re.compile(r"^\d+$")
    re_pct = re.compile(r"^\d+\.?\d*%$")
    re_scale = re.compile(r"^1\s*:\s*\d+$")

    for t in texts:
        s = t["text"].strip()

        if re_height.match(s):
            val = float(s)
            h_type = "relative_height" if abs(val) < 100 else "absolute_elevation"
            heights.append({"value": val, "type": h_type, "x": t["x"], "y": t["y"]})
        elif re_int.match(s):
            n = int(s)
            if 5 <= n <= 10000:
                dimensions.append({"value": n, "x": t["x"], "y": t["y"]})
        elif re_pct.match(s):
            percentages.append({"value": s, "x": t["x"], "y": t["y"]})
        elif re_scale.match(s.replace(" ", "")):
            scales.append(s.replace(" ", ""))
        elif any("\u0590" <= c <= "\u05FF" for c in s):
            labels.append({"text": s, "x": t["x"], "y": t["y"]})

    return {
        "heights": heights,
        "dimensions": dimensions,
        "percentages": percentages,
        "scales": scales,
        "labels": labels,
    }


# ------------------------------------------------------------------ classification

INDEX_KEYWORDS = ["קרקע", "קומה", "חתך", "מדידה", "פיתוח", "העמדה", "גג", "חנייה", "חזית"]
ROOM_KEYWORDS = ["מטבח", "דיור", "הורים", "שינה", "אמבטיה", "ממד",
                 "סלון", "מרפסת", "שירותים", "מבואה", "מסדרון"]
ELEVATION_KEYWORDS = ["חזית", "קו בניין", "גבול מגרש"]
PARKING_KEYWORDS = ["חנייה", "חניייה", "חנייה מקורה", "חתך חנייה"]
DEVELOPMENT_KEYWORDS = ["פיתוח", "העמדה", "תוכנית פיתוח", "תוכנית העמדה"]
DIRECTIONS = ["צפונית", "דרומית", "מזרחית", "מערבית"]


def _augment_with_reversed_hebrew(texts: list[str]) -> list[str]:
    """Add reversed versions of Hebrew strings to handle visual-order R12 DXFs."""
    augmented = list(texts)
    for t in texts:
        if any("\u0590" <= c <= "\u05FF" for c in t):
            rev = t[::-1]
            if rev != t:
                augmented.append(rev)
    return augmented


def classify_viewport(vp_name: str, texts: list, geometry: dict, parsed: dict) -> dict:
    label_texts = [l["text"] for l in parsed["labels"]]
    all_texts = [t["text"] for t in texts]
    # Handle visual-order Hebrew (reversed) in legacy DXF R12 files
    label_texts = _augment_with_reversed_hebrew(label_texts)
    all_texts = _augment_with_reversed_hebrew(all_texts)
    has_heights = bool(parsed["heights"])
    has_dimensions = bool(parsed["dimensions"])
    has_scales = bool(parsed["scales"])
    text_count = len(texts)
    line_count = geometry.get("line_count", 0)

    def default_scale(fallback: str) -> str:
        return parsed["scales"][0] if parsed["scales"] else fallback

    # Index page — many sheet-name keywords together indicate the table of contents
    index_matches = sum(1 for kw in INDEX_KEYWORDS if any(kw in t for t in all_texts))
    if index_matches >= 4:
        conf = 0.95 if has_scales else 0.85
        return {"type": "index_page", "confidence": conf, "label": "תיק מידע", "scale": None}

    # Floor plan
    room_matches = sum(1 for kw in ROOM_KEYWORDS if any(kw in t for t in label_texts))
    if room_matches >= 2 and has_dimensions:
        floor_label = "קרקע"
        joined = " ".join(label_texts)
        if "קומה א" in joined or "קומה א'" in joined:
            floor_label = "קומה א"
        elif "קומה ב" in joined:
            floor_label = "קומה ב"
        elif "גג" in joined and "תוכנית" in joined:
            floor_label = "תוכנית גג"
        return {"type": "floor_plan", "confidence": 0.85,
                "label": floor_label, "scale": default_scale("1:100")}

    # Cross-section
    if any("חתך" in t for t in all_texts) and has_heights and text_count > 15:
        section_id = next((m.group(1) for t in all_texts
                           for m in [re.match(r"^(\d+-\d+)$", t)] if m), None)
        label = f"חתך {section_id}" if section_id else "חתך"
        return {"type": "cross_section", "confidence": 0.80,
                "label": label, "scale": default_scale("1:100")}

    # Elevation
    elev_matches = sum(1 for kw in ELEVATION_KEYWORDS if any(kw in t for t in label_texts))
    if elev_matches >= 2:
        direction = next((d for t in label_texts for d in DIRECTIONS if d in t), None)
        label = f"חזית {direction}" if direction else "חזית"
        return {"type": "elevation", "confidence": 0.80,
                "label": label, "scale": default_scale("1:100")}

    # Parking section
    if any(kw in t for kw in PARKING_KEYWORDS for t in all_texts):
        return {"type": "parking_section", "confidence": 0.80,
                "label": "חתך חנייה", "scale": default_scale("1:50")}

    # Survey / measurement
    if line_count > 2000 and text_count < 50 and has_dimensions:
        r_values = [t for t in all_texts if t.startswith("R=")]
        if r_values or (len(parsed["dimensions"]) > 10 and len(parsed["labels"]) < 5):
            return {"type": "survey", "confidence": 0.75,
                    "label": "מדידה", "scale": "1:250"}

    # Site / development plan
    if any(kw in t for kw in DEVELOPMENT_KEYWORDS for t in label_texts):
        return {"type": "site_plan", "confidence": 0.70,
                "label": "תוכנית פיתוח", "scale": default_scale("1:100")}

    # Roof plan
    if any("גג" in t for t in label_texts) and has_dimensions and line_count > 500:
        return {"type": "roof_plan", "confidence": 0.70,
                "label": "תוכנית גג", "scale": "1:100"}

    # Area calculation
    if any("שטח" in t for t in all_texts) and text_count > 20:
        return {"type": "area_calculation", "confidence": 0.65,
                "label": "חישוב שטחים", "scale": None}

    return {"type": "unclassified", "confidence": 0.0, "label": vp_name, "scale": None}


# ------------------------------------------------------------------ encoding

def _has_hebrew_in_viewports(doc) -> bool:
    """Quick check: do any viewport TEXT entities contain Hebrew chars?"""
    checked = 0
    for block in doc.blocks:
        if not block.name.startswith("VIEWPORT") or block.name.startswith("VIEWPORT_"):
            continue
        for e in block:
            if checked > 200:
                return False
            if e.dxftype() in ("TEXT", "MTEXT"):
                try:
                    raw = e.dxf.text if e.dxftype() == "TEXT" else getattr(e, "text", e.dxf.text)
                    decoded = decode_unicode_escapes(raw)
                    if any("\u0590" <= c <= "\u05FF" for c in decoded):
                        return True
                except Exception:
                    pass
                checked += 1
    return False


def _load_dxf_with_hebrew_fallback(dxf_path: str):
    """
    Load DXF, trying Hebrew encodings if the default doesn't produce Hebrew text.
    Israeli permit DXFs often have $DWGCODEPAGE=ANSI_1252 but contain Hebrew text
    encoded as cp862 (DOS) or cp1255 (Windows). Without the right encoding, the
    viewport classifier can't match Hebrew keywords and most viewports stay unclassified.
    """
    doc = ezdxf.readfile(dxf_path)
    if _has_hebrew_in_viewports(doc):
        return doc

    import sys as _sys
    for enc in ("cp1255", "cp862"):
        try:
            doc2 = ezdxf.readfile(dxf_path, encoding=enc)
            if _has_hebrew_in_viewports(doc2):
                print(f"[encoding] re-read with {enc} — Hebrew detected", file=_sys.stderr)
                return doc2
        except Exception:
            continue
    return doc


# ------------------------------------------------------------------ area computation

def compute_closed_polyline_areas(block, scale_str: str | None) -> list:
    """
    Compute area (Shoelace formula) for every closed LWPOLYLINE in the block.
    Returns list of { area_raw, area_m2_approx, vertex_count, center, layer }.

    Unit heuristic: in Israeli permit DXFs at scale 1:100, DXF units are typically cm.
    At 1:50, units may also be cm. At 1:250, units are often m.
    We report raw area + an approximate m² conversion using the scale.
    """
    scale_divisor = 1.0
    if scale_str:
        m = re.match(r"1\s*:\s*(\d+)", scale_str.replace(" ", ""))
        if m:
            s = int(m.group(1))
            if s <= 100:
                scale_divisor = 10000.0  # DXF units = cm → cm² → m²
            elif s <= 250:
                scale_divisor = 1.0      # DXF units = m → m²
            else:
                scale_divisor = 1.0

    areas = []
    for e in block:
        etype = e.dxftype()
        pts = []
        is_closed = False

        if etype == "LWPOLYLINE":
            if not e.closed:
                continue
            pts = list(e.get_points(format="xy"))
            is_closed = True
        elif etype == "POLYLINE":
            # DXF R12 uses POLYLINE with VERTEX sub-entities
            try:
                is_closed = e.is_closed
                if not is_closed:
                    continue
                pts = [(v.dxf.location[0], v.dxf.location[1]) for v in e.vertices]
            except Exception:
                continue
        else:
            continue
        if len(pts) < 3:
            continue

        # Shoelace formula
        n = len(pts)
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += pts[i][0] * pts[j][1]
            area -= pts[j][0] * pts[i][1]
        area = abs(area) / 2.0

        if area < 0.1:
            continue

        cx = sum(p[0] for p in pts) / n
        cy = sum(p[1] for p in pts) / n

        area_m2 = round(area / scale_divisor, 2) if scale_divisor > 0 else None

        areas.append({
            "area_raw": round(area, 2),
            "area_m2_approx": area_m2,
            "vertex_count": n,
            "center": [round(cx, 2), round(cy, 2)],
            "layer": e.dxf.layer,
        })

    # Sort largest first — most interesting polygons are typically the biggest
    areas.sort(key=lambda a: a["area_raw"], reverse=True)
    return areas[:50]  # Cap to avoid sending huge arrays


# ------------------------------------------------------------------ spatial correlation engine


def extract_setbacks(texts: list) -> list:
    """Find setback distances between קו בניין and גבול מגרש label pairs in elevation viewports."""
    kav_binyan = [t for t in texts if "קו בניין" in t["text"]]
    gvul_migrash = [t for t in texts if "גבול מגרש" in t["text"]]

    pairs = []
    used_gvul = set()
    for kb in kav_binyan:
        best_match = None
        best_dist = 999.0
        for i, gm in enumerate(gvul_migrash):
            if i in used_gvul:
                continue
            y_diff = abs(kb["y"] - gm["y"])
            if y_diff < 15 and y_diff < best_dist:
                best_dist = y_diff
                best_match = (i, gm)
        if best_match:
            used_gvul.add(best_match[0])
            pairs.append((kb, best_match[1]))

    integers = [
        t for t in texts
        if re.match(r"^\d+$", t["text"].strip()) and 50 <= int(t["text"].strip()) <= 1500
    ]

    results = []
    for kb, gm in pairs:
        min_x = min(kb["x"], gm["x"])
        max_x = max(kb["x"], gm["x"])
        label_y = max(kb["y"], gm["y"])

        best_num = None
        best_score = 999.0
        for num in integers:
            y_below = label_y - num["y"]
            x_between = min_x - 30 <= num["x"] <= max_x + 30
            if 0 < y_below < 40 and x_between:
                score = y_below + abs(num["x"] - (min_x + max_x) / 2) * 0.5
                if score < best_score:
                    best_score = score
                    best_num = num

        if best_num:
            val = int(best_num["text"].strip())
            side = "left" if gm["x"] < kb["x"] else "right"
            results.append({
                "type": "setback",
                "boundary_label_pos": {"x": gm["x"], "y": gm["y"]},
                "building_line_pos": {"x": kb["x"], "y": kb["y"]},
                "distance_cm": val,
                "distance_m": round(val / 100, 2),
                "side": side,
            })

    return results


def extract_dimension_chains(texts: list) -> list:
    """Group integer dimension texts by X coordinate to find dimension chains."""
    from collections import defaultdict as _dd

    integers = []
    for t in texts:
        text = t["text"].strip()
        if re.match(r"^\d+$", text):
            val = int(text)
            if 10 <= val <= 2000:
                integers.append({"x": round(t["x"]), "y": t["y"], "val": val})

    x_groups: dict[int, list] = {}
    for item in integers:
        x_groups.setdefault(item["x"], []).append(item)

    chains = []
    for x, items in x_groups.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda i: -i["y"])
        values = [i["val"] for i in items]
        total = sum(values)
        chains.append({
            "type": "dimension_chain",
            "x_position": x,
            "values_cm": values,
            "total_cm": total,
            "total_m": round(total / 100, 2),
            "direction": "vertical",
            "count": len(values),
        })

    chains.sort(key=lambda c: -c["total_cm"])
    return chains[:20]


def correlate_labels_to_values(texts: list) -> list:
    """For significant Hebrew labels, find the closest numeric values."""
    LABELS_OF_INTEREST = [
        "מעקה בנוי", "מעקה קל", "מעקה",
        "חנייה מקורה", "חניייה מקורה", "חנייה",
        "גגון מבטון", "גגון",
        "ממד",
        "מרפסת לא מקורה", "מרפסת",
        "פרגולה קלה", "פרגולה",
        "חומה קיימת", "חומה",
        "רחוב",
    ]

    results = []
    for t in texts:
        text = t["text"].strip()
        if text not in LABELS_OF_INTEREST:
            continue

        nearby = []
        for other in texts:
            if other is t:
                continue
            other_text = other["text"].strip()
            dist = ((t["x"] - other["x"]) ** 2 + (t["y"] - other["y"]) ** 2) ** 0.5
            if dist > 50:
                continue

            value_type = None
            if re.match(r"^[+\-]\d+\.?\d*$", other_text):
                value_type = "height"
            elif re.match(r"^\d+$", other_text) and 10 <= int(other_text) <= 2000:
                value_type = "dimension_cm"
            elif re.match(r"^\d+\.?\d*%$", other_text):
                value_type = "percentage"
            elif re.match(r"^\d+\.\d+$", other_text):
                value_type = "decimal"

            if value_type:
                nearby.append({
                    "value": other_text,
                    "type": value_type,
                    "distance": round(dist, 1),
                    "pos": {"x": other["x"], "y": other["y"]},
                })

        if nearby:
            nearby.sort(key=lambda n: n["distance"])
            results.append({
                "label": text,
                "label_pos": {"x": t["x"], "y": t["y"]},
                "nearby_values": nearby[:5],
            })

    return results


def extract_survey_data(texts: list) -> dict:
    """Separate survey viewport data into terrain elevations, edge lengths, and curve radii."""
    elevations = []
    edge_lengths = []
    curve_radii = []
    point_numbers = []

    for t in texts:
        text = t["text"].strip()

        r_match = re.match(r"^R\s*=\s*(\d+\.?\d*)$", text)
        if r_match:
            curve_radii.append({"value": float(r_match.group(1)), "x": t["x"], "y": t["y"]})
            continue

        if re.match(r"^\d+\.\d+$", text):
            val = float(text)
            if val > 600:
                elevations.append({"value": val, "x": t["x"], "y": t["y"]})
            elif 0.5 < val < 50:
                edge_lengths.append({"value": val, "x": t["x"], "y": t["y"], "unit": "m"})
            continue

        if re.match(r"^\d+$", text):
            val = int(text)
            if 1 <= val <= 30:
                point_numbers.append(val)

    elev_vals = [e["value"] for e in elevations]
    return {
        "terrain_elevations": elevations,
        "boundary_edge_lengths": edge_lengths,
        "curve_radii": curve_radii,
        "estimated_perimeter_m": round(sum(e["value"] for e in edge_lengths), 2),
        "point_numbers": sorted(set(point_numbers)),
        "elevation_range": {
            "min": round(min(elev_vals), 2),
            "max": round(max(elev_vals), 2),
            "diff": round(max(elev_vals) - min(elev_vals), 2),
        } if elev_vals else None,
    }


def extract_parking_data(texts: list) -> dict:
    """Extract parking-specific measurements."""
    is_covered = any("מקורה" in t["text"] for t in texts)
    slopes = []
    heights = []
    dimensions = []

    for t in texts:
        text = t["text"].strip()
        if re.match(r"^\d+\.?\d*%$", text):
            slopes.append(text)
        elif re.match(r"^[+\-]\d+\.?\d*$", text):
            heights.append(text)
        elif re.match(r"^\d+$", text):
            val = int(text)
            if 20 <= val <= 2000:
                dimensions.append(val)

    bay = None
    widths = [d for d in dimensions if 200 <= d <= 350]
    depths = [d for d in dimensions if 450 <= d <= 700]
    if widths and depths:
        bay = {"width_m": round(widths[0] / 100, 2), "depth_m": round(depths[0] / 100, 2)}

    total_width = None
    large_dims = [d for d in dimensions if d > 400]
    if large_dims:
        total_width = round(max(large_dims) / 100, 2)

    return {
        "is_covered": is_covered,
        "slopes": slopes,
        "heights": heights,
        "dimensions_cm": dimensions,
        "bay_dimensions": bay,
        "total_width_m": total_width,
    }


def analyze_heights(texts: list) -> dict:
    """Classify height values into architectural categories."""
    relative = []
    absolute = []

    for t in texts:
        text = t["text"].strip()
        match = re.match(r"^([+\-])(\d+\.?\d*)$", text)
        if not match:
            continue
        val = float(match.group(2))
        if match.group(1) == "-":
            val = -val

        if abs(val) < 100:
            relative.append({"value": val, "x": t["x"], "y": t["y"]})
        elif val > 600:
            absolute.append({"value": val, "x": t["x"], "y": t["y"]})

    rel_values = sorted(set(r["value"] for r in relative))
    abs_values = sorted(set(a["value"] for a in absolute))

    result: dict = {
        "all_relative": rel_values,
        "all_absolute": abs_values,
        "ground_level": 0.0 if 0.0 in rel_values else None,
    }

    zero_entries = [r for r in relative if r["value"] == 0.0]
    if zero_entries and absolute:
        z = zero_entries[0]
        closest_abs = min(absolute, key=lambda a: ((a["x"] - z["x"]) ** 2 + (a["y"] - z["y"]) ** 2) ** 0.5)
        result["absolute_ground"] = closest_abs["value"]

    floors = []
    if 0.0 in rel_values:
        floors.append({"label": "ground_floor_slab", "relative": 0.0})
    for v in rel_values:
        if 2.5 <= v <= 3.5:
            floors.append({"label": "first_floor_slab", "relative": v})
        elif 5.5 <= v <= 6.5:
            floors.append({"label": "roof_slab", "relative": v})
    result["floor_heights"] = floors

    if rel_values:
        result["max_height"] = max(rel_values)

    roof_candidates = [v for v in rel_values if 5.5 <= v <= 6.5]
    if roof_candidates:
        result["roof_height"] = roof_candidates[0]

    if "roof_height" in result and "max_height" in result:
        diff = round(result["max_height"] - result["roof_height"], 2)
        if 0.3 <= diff <= 1.5:
            result["parapet_height"] = diff

    plinth_candidates = [v for v in rel_values if 1.0 <= v <= 2.0]
    if plinth_candidates:
        result["plinth_height"] = plinth_candidates[0]

    return result


# ------------------------------------------------------------------ main

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python dxf_viewport_extractor.py <path_to_dxf>"}))
        sys.exit(1)

    dxf_path = sys.argv[1]

    try:
        doc = _load_dxf_with_hebrew_fallback(dxf_path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read DXF: {e}"}))
        sys.exit(1)

    result = {
        "file_info": {
            "version": doc.dxfversion,
            "encoding": doc.encoding,
            "layout_count": len(list(doc.layouts)),
        },
        "viewports": {},
        "viewport_classifications": {},
        "summary": {
            "total_viewports": 0,
            "classified": 0,
            "unclassified": 0,
            "types_found": [],
        },
    }

    # Find VIEWPORT* blocks with meaningful content.
    viewport_blocks = []
    for block in doc.blocks:
        name = block.name
        if not name.startswith("VIEWPORT") or name.startswith("VIEWPORT_"):
            continue
        entities = list(block)
        if len(entities) > 5:
            viewport_blocks.append(block)

    result["summary"]["total_viewports"] = len(viewport_blocks)

    for block in viewport_blocks:
        vp_name = block.name
        texts = extract_viewport_texts(block)
        geometry = extract_viewport_geometry(block)
        parsed = extract_dimensions_from_texts(texts)
        classification = classify_viewport(vp_name, texts, geometry, parsed)

        # Compute closed-polyline areas for plan-type viewports
        closed_areas = []
        if classification["type"] in ("floor_plan", "roof_plan", "site_plan", "survey", "area_calculation", "unclassified"):
            closed_areas = compute_closed_polyline_areas(block, classification.get("scale"))
        parsed["closed_areas"] = closed_areas

        # Spatial correlation based on viewport type
        spatial_data: dict = {}
        vp_type = classification["type"]

        if vp_type in ("elevation", "cross_section"):
            spatial_data["setbacks"] = extract_setbacks(texts)
            spatial_data["height_analysis"] = analyze_heights(texts)
            spatial_data["label_correlations"] = correlate_labels_to_values(texts)
        elif vp_type in ("floor_plan", "roof_plan", "site_plan"):
            spatial_data["dimension_chains"] = extract_dimension_chains(texts)
            spatial_data["label_correlations"] = correlate_labels_to_values(texts)
        elif vp_type == "survey":
            spatial_data["survey"] = extract_survey_data(texts)
        elif vp_type == "parking_section":
            spatial_data["parking"] = extract_parking_data(texts)
            spatial_data["height_analysis"] = analyze_heights(texts)
        elif vp_type == "area_calculation":
            spatial_data["label_correlations"] = correlate_labels_to_values(texts)

        result["viewports"][vp_name] = {
            "texts": texts,
            "geometry": geometry,
            "parsed_data": parsed,
            "classification": classification,
            "spatial_data": spatial_data,
        }
        result["viewport_classifications"][vp_name] = classification

        if classification["type"] != "unclassified":
            result["summary"]["classified"] += 1
        else:
            result["summary"]["unclassified"] += 1

    result["summary"]["types_found"] = sorted({
        c["type"] for c in result["viewport_classifications"].values()
        if c["type"] != "unclassified"
    })

    # ---- Aggregate compliance_data from all viewports ----
    all_setbacks = []
    building_envelope = {}
    survey_summary = None
    parking_summary = None
    best_height_analysis = None
    best_height_count = 0

    for vp_name, vp_data in result["viewports"].items():
        sd = vp_data.get("spatial_data", {})

        for s in sd.get("setbacks", []):
            s["source_viewport"] = vp_name
            all_setbacks.append(s)

        chains = sd.get("dimension_chains", [])
        if chains:
            building_envelope[vp_name] = {
                "max_dimension_m": chains[0]["total_m"],
                "chain": chains[0]["values_cm"],
            }

        if "survey" in sd and survey_summary is None:
            survey_summary = sd["survey"]
            survey_summary["source_viewport"] = vp_name

        if "parking" in sd and parking_summary is None:
            parking_summary = sd["parking"]
            parking_summary["source_viewport"] = vp_name

        ha = sd.get("height_analysis", {})
        count = len(ha.get("all_relative", []))
        if count > best_height_count:
            best_height_count = count
            best_height_analysis = dict(ha)
            best_height_analysis["source_viewport"] = vp_name

    result["compliance_data"] = {
        "setbacks": all_setbacks,
        "building_envelope": building_envelope,
        "survey": survey_summary,
        "parking": parking_summary,
        "height_analysis": best_height_analysis,
    }

    # Ensure utf-8 on Windows stdout for Hebrew output.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    # Prefer raw Hebrew output. If any residual surrogate slips through,
    # fall back to ascii-escaped JSON so the pipeline never crashes.
    try:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (UnicodeEncodeError, ValueError):
        print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
