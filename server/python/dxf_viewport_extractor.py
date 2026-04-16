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
        "polyline_count": entity_counts.get("POLYLINE", 0) + entity_counts.get("LWPOLYLINE", 0),
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


def classify_viewport(vp_name: str, texts: list, geometry: dict, parsed: dict) -> dict:
    label_texts = [l["text"] for l in parsed["labels"]]
    all_texts = [t["text"] for t in texts]
    has_heights = bool(parsed["heights"])
    has_dimensions = bool(parsed["dimensions"])
    has_scales = bool(parsed["scales"])
    text_count = len(texts)
    line_count = geometry.get("line_count", 0)

    def default_scale(fallback: str) -> str:
        return parsed["scales"][0] if parsed["scales"] else fallback

    # Index page
    index_matches = sum(1 for kw in INDEX_KEYWORDS if any(kw in t for t in all_texts))
    if index_matches >= 4 and has_scales:
        return {"type": "index_page", "confidence": 0.95, "label": "תיק מידע", "scale": None}

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


# ------------------------------------------------------------------ main

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python dxf_viewport_extractor.py <path_to_dxf>"}))
        sys.exit(1)

    dxf_path = sys.argv[1]

    try:
        doc = ezdxf.readfile(dxf_path)
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

        result["viewports"][vp_name] = {
            "texts": texts,
            "geometry": geometry,
            "parsed_data": parsed,
            "classification": classification,
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
