#!/usr/bin/env python3
"""
dxf_sheet_renderer.py — Composite SVG renderer for Israeli permit DXFs.

Israeli בקשת היתר DXF files use a dual-viewport pattern: each printable sheet
is split across TWO named VIEWPORT* blocks at the same coordinate space.
  - One geometry block (walls, hatches, furniture, windows): high LINE/POLYLINE
    count, almost no TEXT.
  - One annotation block (labels, dimensions, heights, room names): high TEXT
    count, only dimension lines.

The previous renderer drew each VIEWPORT independently, producing tiny dots
for the annotation blocks and unlabelled drawings for the geometry blocks.

This renderer:
  1. Discovers VIEWPORT blocks with meaningful content
  2. Pairs geometry + annotation blocks by bounding-box IoU
  3. Emits one SVG per sheet (geometry + annotations overlaid)
  4. Outputs a JSON manifest (sheet number, label_he, label_en, type, scale,
     filename, source viewports) so the frontend can render a sheet browser.

Usage : python dxf_sheet_renderer.py <dxf_path> <out_dir>
Output: JSON to stdout.
On error: JSON {"error": "..."} and exit 1.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from collections import Counter
from xml.sax.saxutils import escape as xml_escape

try:
    import ezdxf
except ImportError:
    print(json.dumps({"error": "ezdxf not installed. Run: pip install -r requirements.txt"}))
    sys.exit(1)


# ----------------------------------------------------------------- log helper

def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ----------------------------------------------------------------- unicode

_UNICODE_ESCAPE_RE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")


def _scrub_surrogates(s: str) -> str:
    out = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        o = ord(c)
        if 0xD800 <= o <= 0xDBFF and i + 1 < n:
            o2 = ord(s[i + 1])
            if 0xDC00 <= o2 <= 0xDFFF:
                out.append(chr(((o - 0xD800) * 0x400) + (o2 - 0xDC00) + 0x10000))
                i += 2
                continue
        if 0xD800 <= o <= 0xDFFF:
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def decode_text(text: str) -> str:
    decoded = _UNICODE_ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), text)
    return _scrub_surrogates(decoded)


def _has_hebrew(s: str) -> bool:
    return any("\u0590" <= c <= "\u05FF" for c in s)


# ----------------------------------------------------------------- DXF load

def _has_hebrew_in_viewports(doc) -> bool:
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
                    if _has_hebrew(decode_text(raw)):
                        return True
                except Exception:
                    pass
                checked += 1
    return False


def load_dxf(dxf_path: str):
    """Try Hebrew encodings if the default doesn't yield Hebrew text in viewports."""
    doc = ezdxf.readfile(dxf_path)
    if _has_hebrew_in_viewports(doc):
        return doc
    for enc in ("cp1255", "cp862"):
        try:
            doc2 = ezdxf.readfile(dxf_path, encoding=enc)
            if _has_hebrew_in_viewports(doc2):
                log(f"[encoding] re-read with {enc}")
                return doc2
        except Exception:
            continue
    return doc


# ----------------------------------------------------------------- block stats

def _entity_bbox(e):
    """Return (xmin,ymin,xmax,ymax) for a single entity, or None."""
    et = e.dxftype()
    try:
        if et == "LINE":
            x1, y1 = e.dxf.start[0], e.dxf.start[1]
            x2, y2 = e.dxf.end[0], e.dxf.end[1]
            return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
        if et == "LWPOLYLINE":
            pts = list(e.get_points(format="xy"))
            if not pts:
                return None
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            return (min(xs), min(ys), max(xs), max(ys))
        if et == "POLYLINE":
            xs, ys = [], []
            for v in e.vertices:
                xs.append(v.dxf.location[0]); ys.append(v.dxf.location[1])
            if not xs:
                return None
            return (min(xs), min(ys), max(xs), max(ys))
        if et == "ARC":
            cx, cy, r = e.dxf.center[0], e.dxf.center[1], e.dxf.radius
            return (cx - r, cy - r, cx + r, cy + r)
        if et == "CIRCLE":
            cx, cy, r = e.dxf.center[0], e.dxf.center[1], e.dxf.radius
            return (cx - r, cy - r, cx + r, cy + r)
        if et in ("TEXT", "MTEXT", "INSERT"):
            x, y = e.dxf.insert[0], e.dxf.insert[1]
            return (x, y, x, y)
        if et == "SOLID":
            xs, ys = [], []
            for k in ("vtx0", "vtx1", "vtx2", "vtx3"):
                try:
                    p = getattr(e.dxf, k)
                    xs.append(p[0]); ys.append(p[1])
                except Exception:
                    pass
            if not xs:
                return None
            return (min(xs), min(ys), max(xs), max(ys))
    except Exception:
        return None
    return None


def block_stats(block) -> dict:
    counts: Counter = Counter()
    xmins, ymins, xmaxs, ymaxs = [], [], [], []
    for e in block:
        counts[e.dxftype()] += 1
        bb = _entity_bbox(e)
        if bb is not None:
            xmins.append(bb[0]); ymins.append(bb[1])
            xmaxs.append(bb[2]); ymaxs.append(bb[3])
    bbox = None
    if xmins:
        bbox = (min(xmins), min(ymins), max(xmaxs), max(ymaxs))
    return {
        "name": block.name,
        "counts": dict(counts),
        "line_count": counts.get("LINE", 0),
        "poly_count": counts.get("POLYLINE", 0) + counts.get("LWPOLYLINE", 0),
        "text_count": counts.get("TEXT", 0) + counts.get("MTEXT", 0),
        "insert_count": counts.get("INSERT", 0),
        "arc_count": counts.get("ARC", 0),
        "total": sum(counts.values()),
        "bbox": bbox,
    }


# ----------------------------------------------------------------- pairing

def _bbox_iou(a, b) -> float:
    if a is None or b is None:
        return 0.0
    ix0 = max(a[0], b[0]); iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2]); iy1 = min(a[3], b[3])
    iw = max(0.0, ix1 - ix0); ih = max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aw = max(0.001, a[2] - a[0]); ah = max(0.001, a[3] - a[1])
    bw = max(0.001, b[2] - b[0]); bh = max(0.001, b[3] - b[1])
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _bbox_size_match(a, b) -> float:
    """Return 1.0 if widths and heights match closely, decreasing as they diverge."""
    if a is None or b is None:
        return 0.0
    aw = max(0.001, a[2] - a[0]); ah = max(0.001, a[3] - a[1])
    bw = max(0.001, b[2] - b[0]); bh = max(0.001, b[3] - b[1])
    rw = min(aw, bw) / max(aw, bw)
    rh = min(ah, bh) / max(ah, bh)
    return rw * rh


def classify_block_role(s: dict) -> str:
    """geometry | annotation | self_contained | mixed | empty.

    self_contained: huge detailed drawings (typically surveys) that carry
    their own labels and shouldn't be paired with an annotation block.
    """
    if s["total"] < 5 or s["bbox"] is None:
        return "empty"
    # A survey-style block: tens of thousands of lines + non-trivial text +
    # significant arcs/polylines. These shouldn't compete for annotation pairing.
    if s["line_count"] > 10000 and s["text_count"] > 30:
        return "self_contained"
    line_heavy = s["line_count"] > 200 and s["text_count"] < max(20, s["line_count"] // 30)
    text_heavy = s["text_count"] > 20 and s["line_count"] < 1500
    if line_heavy and not text_heavy:
        return "geometry"
    if text_heavy and not line_heavy:
        return "annotation"
    return "mixed"


def pair_viewports(stats: list[dict]) -> list[dict]:
    """Pair geometry blocks with annotation blocks by bbox similarity.

    Strategy: process annotation blocks first (typically fewer, more distinctive)
    and for each pick the best geometry partner. Skip self-contained blocks.
    """
    roles = {s["name"]: classify_block_role(s) for s in stats}
    geo_pool = [s for s in stats if roles[s["name"]] in ("geometry", "mixed") and s["total"] > 50]
    ann_pool = [s for s in stats if roles[s["name"]] == "annotation"]
    self_contained = [s for s in stats if roles[s["name"]] == "self_contained"]

    # Global best-pair-first matching — repeatedly extract the highest-scoring
    # (geo, ann) pair until no pair clears the threshold. This avoids cases where
    # the largest annotation block greedily steals a geometry block that fits a
    # smaller annotation block much better.
    candidates: list[tuple[float, dict, dict]] = []
    for g in geo_pool:
        for a in ann_pool:
            iou = _bbox_iou(g["bbox"], a["bbox"])
            size = _bbox_size_match(g["bbox"], a["bbox"])
            score = 0.7 * iou + 0.3 * size
            if score > 0.45:
                candidates.append((score, g, a))
    candidates.sort(key=lambda c: -c[0])

    used_geo: set[str] = set()
    used_ann: set[str] = set()
    pairs: list[dict] = []

    for score, g, a in candidates:
        if g["name"] in used_geo or a["name"] in used_ann:
            continue
        used_geo.add(g["name"])
        used_ann.add(a["name"])
        pairs.append({"geo": g["name"], "ann": a["name"], "score": round(score, 3),
                      "geo_bbox": g["bbox"], "ann_bbox": a["bbox"]})

    # Annotation-only sheets (e.g., index page).
    for a in ann_pool:
        if a["name"] in used_ann:
            continue
        pairs.append({"geo": None, "ann": a["name"], "score": 0.0,
                      "geo_bbox": None, "ann_bbox": a["bbox"]})

    # Geometry-only sheets (no matching annotation block).
    for g in geo_pool:
        if g["name"] in used_geo:
            continue
        pairs.append({"geo": g["name"], "ann": None, "score": 0.0,
                      "geo_bbox": g["bbox"], "ann_bbox": None})

    # Self-contained blocks (surveys etc.) → always standalone.
    for s in self_contained:
        pairs.append({"geo": s["name"], "ann": None, "score": 0.0,
                      "geo_bbox": s["bbox"], "ann_bbox": None,
                      "self_contained": True})

    return pairs


# ----------------------------------------------------------------- sheet labels

ROOM_KW = ("מטבח", "דיור", "הורים", "שינה", "אמבטיה", "ממ\"ד", "ממד",
           "סלון", "מרפסת", "שירותים", "מבואה", "מסדרון")
INDEX_KW = ("קרקע", "קומה", "חתך", "מדידה", "פיתוח", "העמדה", "גג", "חנייה", "חזית")
DIRECTIONS = ("צפונית", "דרומית", "מזרחית", "מערבית")

SCALE_RE = re.compile(r"1\s*:\s*(\d+)")


def _read_texts(block) -> list[str]:
    out = []
    for e in block:
        et = e.dxftype()
        if et not in ("TEXT", "MTEXT"):
            continue
        try:
            raw = e.dxf.text if et == "TEXT" else getattr(e, "text", e.dxf.text)
            t = decode_text(raw).strip()
            if t:
                out.append(t)
        except Exception:
            continue
    return out


def _detect_scale(texts: list[str]) -> str | None:
    for t in texts:
        m = SCALE_RE.search(t.replace(" ", ""))
        if m:
            return f"1:{m.group(1)}"
    return None


_ELEVATION_HINTS = ("קו בניין", "גבול מגרש", "מפלס שכן", "פני קרקע")
_SECTION_HINTS = ("רום", "ממ\"ד", "תקרה", "ריצוף", "אצטדיון")  # generic vertical-view markers


def label_sheet(geo_block, ann_block, geo_stats=None) -> dict:
    """Determine a Hebrew label + sheet type from the annotation block's text.

    When an annotation block is provided we use ONLY its texts to avoid
    contamination from the geometry block's layer/dimension labels.
    """
    if ann_block is not None:
        texts = _read_texts(ann_block)
    elif geo_block is not None:
        texts = _read_texts(geo_block)
    else:
        texts = []
    joined = " ".join(texts)
    scale = _detect_scale(texts)

    index_hits = sum(1 for k in INDEX_KW if k in joined)
    room_hits = sum(1 for k in ROOM_KW if k in joined)
    elev_hints = sum(1 for h in _ELEVATION_HINTS if h in joined)
    # Floor-plan dimension chains are short integers labeled in cm. Cross-sections/elevations
    # use signed heights like +3.00, -0.50.
    height_count = sum(1 for t in texts if re.match(r"^[+\-]\d+\.?\d*$", t.strip()))
    section_match = re.search(r"חתך\s*(\d+\s*[-–]\s*\d+)", joined)
    is_section_label_dominant = bool(section_match) and height_count >= 5

    # 1. Index page — many sheet-name keywords AND no rooms / no setbacks
    #    (Must come before Survey because index page lists "מדידה" as a sheet name.)
    if index_hits >= 4 and room_hits < 2 and elev_hints == 0:
        return {"label_he": "תיק מידע", "label_en": "Index page", "type": "index_page", "scale": scale}

    # 2. Survey — strong markers like "מדידה" or many curve radii (R=…)
    r_count = sum(1 for t in texts if re.match(r"^R\s*=", t))
    if any("מדידה" in t for t in texts) or (r_count >= 3 and geo_stats and geo_stats["line_count"] > 5000):
        return {"label_he": "מדידה", "label_en": "Survey", "type": "survey", "scale": scale or "1:250"}

    # 3. Floor plan — multiple room labels (rooms ALWAYS win over section markers
    #    because floor plans typically contain "חתך 1-1" markers as section indicators).
    if room_hits >= 2:
        floor = "קרקע"
        if "קומה א" in joined:
            floor = "קומה א'"
        elif "קומה ב" in joined:
            floor = "קומה ב'"
        elif "קומה ג" in joined:
            floor = "קומה ג'"
        elif "מרתף" in joined:
            floor = "מרתף"
        elif "תוכנית גג" in joined:
            return {"label_he": "תוכנית גג", "label_en": "Roof plan", "type": "roof_plan", "scale": scale or "1:100"}
        return {"label_he": floor, "label_en": f"Floor: {floor}", "type": "floor_plan", "scale": scale or "1:100"}

    # 4. Site / development plan — distinctive keywords (also has "כניסה למגרש", "מקורה" etc.)
    if "תוכנית פיתוח" in joined or "תוכנית העמדה" in joined or "כניסה למגרש" in joined:
        return {"label_he": "תוכנית פיתוח", "label_en": "Site plan", "type": "site_plan", "scale": scale or "1:100"}

    # 5. Parking section — explicit
    if "חתך חנייה" in joined or "חתך חניה" in joined:
        return {"label_he": "חתך חנייה", "label_en": "Parking section", "type": "parking_section", "scale": scale or "1:50"}

    # 6. Cross-section — explicit "חתך N-N" + many height markers (so we don't catch floor-plan section indicators)
    if is_section_label_dominant:
        suffix = section_match.group(1).replace(" ", "")
        return {"label_he": f"חתך {suffix}", "label_en": f"Section {suffix}",
                "type": "cross_section", "scale": scale or "1:100"}

    # 7. Elevation — many setback/boundary hints OR explicit "חזית"
    if "חזית" in joined or elev_hints >= 2:
        direction = next((d for d in DIRECTIONS if d in joined), "")
        label = f"חזית {direction}".strip() if direction else "חזית"
        en_label = f"Elevation {direction}".strip() if direction else "Elevation"
        return {"label_he": label, "label_en": en_label, "type": "elevation", "scale": scale or "1:100"}

    # 8. Pure section pattern (no other context)
    if section_match:
        suffix = section_match.group(1).replace(" ", "")
        return {"label_he": f"חתך {suffix}", "label_en": f"Section {suffix}",
                "type": "cross_section", "scale": scale or "1:100"}

    # 9. Roof plan — explicit "תוכנית גג"
    if "תוכנית גג" in joined or ("גג" in joined and room_hits == 0 and elev_hints == 0):
        return {"label_he": "תוכנית גג", "label_en": "Roof plan", "type": "roof_plan", "scale": scale or "1:100"}

    # 10. Generic parking
    if "חנייה" in joined or "חניייה" in joined:
        return {"label_he": "חנייה", "label_en": "Parking", "type": "parking_section", "scale": scale or "1:50"}

    # 11. Site plan fallback (broader "פיתוח" alone, after rooms ruled out)
    if "פיתוח" in joined or "העמדה" in joined:
        return {"label_he": "תוכנית פיתוח", "label_en": "Site plan", "type": "site_plan", "scale": scale or "1:100"}

    return {"label_he": "תכנית", "label_en": "Drawing", "type": "unclassified", "scale": scale}


# ----------------------------------------------------------------- SVG render

# Bright/transparent ACI colors that don't read on white. Remapped to readable tones.
_REMAP = {
    7: "#1f2937",   # white → near-black
    2: "#a16207",   # yellow → ochre
    8: "#475569",   # dark gray → slate
    9: "#64748b",
    14: "#7c2d12",
    50: "#ca8a04",
    51: "#a16207",
}

_ACI = {
    1: "#dc2626", 2: "#a16207", 3: "#16a34a", 4: "#0891b2", 5: "#1d4ed8",
    6: "#9333ea", 7: "#1f2937", 8: "#475569", 9: "#64748b",
    10: "#dc2626", 11: "#ef4444", 12: "#b91c1c", 14: "#7c2d12",
    20: "#ea580c", 21: "#fb923c", 30: "#ea580c", 40: "#d97706",
    50: "#ca8a04", 60: "#65a30d", 70: "#16a34a", 80: "#059669",
    90: "#10b981", 100: "#14b8a6", 130: "#0891b2", 140: "#0284c7",
    150: "#0369a1", 170: "#1d4ed8", 200: "#7c3aed",
    250: "#374151", 251: "#475569", 252: "#52525b", 253: "#71717a",
    254: "#9ca3af", 255: "#d1d5db",
}


def _entity_color(e, doc) -> str:
    try:
        c = e.dxf.color
        if c is None or c == 256:
            layer = doc.layers.get(e.dxf.layer)
            if layer:
                c = layer.color
        if c == 0:
            c = 7
        if c is None or c < 0:
            c = 7
        return _REMAP.get(c, _ACI.get(c, "#1f2937"))
    except Exception:
        return "#1f2937"


def _stroke_width(scene_size: float) -> float:
    """Pick a reasonable stroke width relative to the scene size."""
    return max(0.5, scene_size * 0.0008)


def _arc_points(cx: float, cy: float, r: float, sa_deg: float, ea_deg: float, steps: int = 32) -> list[tuple[float, float]]:
    sa = math.radians(sa_deg); ea = math.radians(ea_deg)
    if ea < sa:
        ea += 2 * math.pi
    n = max(8, steps)
    return [(cx + r * math.cos(sa + (ea - sa) * i / n),
             cy + r * math.sin(sa + (ea - sa) * i / n)) for i in range(n + 1)]


def _draw_block_to_paths(block, doc, paths_by_color: dict[str, list[str]], texts: list[dict]) -> int:
    """Append SVG path strings (grouped by stroke color) and text dicts. Return entity count."""
    drawn = 0
    for e in block:
        et = e.dxftype()
        try:
            color = _entity_color(e, doc)
            if et == "LINE":
                x1, y1 = e.dxf.start[0], e.dxf.start[1]
                x2, y2 = e.dxf.end[0], e.dxf.end[1]
                paths_by_color.setdefault(color, []).append(
                    f"M{x1:.2f},{-y1:.2f} L{x2:.2f},{-y2:.2f}"
                )
                drawn += 1
            elif et == "LWPOLYLINE":
                pts = list(e.get_points(format="xy"))
                if len(pts) < 2:
                    continue
                d = f"M{pts[0][0]:.2f},{-pts[0][1]:.2f}"
                for p in pts[1:]:
                    d += f" L{p[0]:.2f},{-p[1]:.2f}"
                if e.closed and len(pts) >= 3:
                    d += " Z"
                paths_by_color.setdefault(color, []).append(d)
                drawn += 1
            elif et == "POLYLINE":
                pts = [(v.dxf.location[0], v.dxf.location[1]) for v in e.vertices]
                if len(pts) < 2:
                    continue
                d = f"M{pts[0][0]:.2f},{-pts[0][1]:.2f}"
                for p in pts[1:]:
                    d += f" L{p[0]:.2f},{-p[1]:.2f}"
                try:
                    if e.is_closed and len(pts) >= 3:
                        d += " Z"
                except Exception:
                    pass
                paths_by_color.setdefault(color, []).append(d)
                drawn += 1
            elif et == "ARC":
                cx, cy, r = e.dxf.center[0], e.dxf.center[1], e.dxf.radius
                pts = _arc_points(cx, cy, r, e.dxf.start_angle, e.dxf.end_angle)
                d = f"M{pts[0][0]:.2f},{-pts[0][1]:.2f}"
                for p in pts[1:]:
                    d += f" L{p[0]:.2f},{-p[1]:.2f}"
                paths_by_color.setdefault(color, []).append(d)
                drawn += 1
            elif et == "CIRCLE":
                cx, cy, r = e.dxf.center[0], e.dxf.center[1], e.dxf.radius
                # Approximate as 32-segment polygon to keep one-color batching simple.
                pts = _arc_points(cx, cy, r, 0, 360)
                d = f"M{pts[0][0]:.2f},{-pts[0][1]:.2f}"
                for p in pts[1:]:
                    d += f" L{p[0]:.2f},{-p[1]:.2f}"
                d += " Z"
                paths_by_color.setdefault(color, []).append(d)
                drawn += 1
            elif et == "SOLID":
                pts = []
                for k in ("vtx0", "vtx1", "vtx2", "vtx3"):
                    try:
                        p = getattr(e.dxf, k)
                        pts.append((p[0], p[1]))
                    except Exception:
                        pass
                if len(pts) < 3:
                    continue
                d = f"M{pts[0][0]:.2f},{-pts[0][1]:.2f}"
                for p in pts[1:]:
                    d += f" L{p[0]:.2f},{-p[1]:.2f}"
                d += " Z"
                paths_by_color.setdefault(color + "|fill", []).append(d)
                drawn += 1
            elif et in ("TEXT", "MTEXT"):
                raw = e.dxf.text if et == "TEXT" else getattr(e, "text", e.dxf.text)
                t = decode_text(raw).strip()
                if not t:
                    continue
                ins = e.dxf.insert
                h = float(getattr(e.dxf, "height", 0) or 0)
                rot = float(getattr(e.dxf, "rotation", 0) or 0)
                texts.append({
                    "x": float(ins[0]),
                    "y": float(ins[1]),
                    "h": max(0.5, h),
                    "rot": rot,
                    "text": t,
                    "color": color,
                    "rtl": _has_hebrew(t),
                })
                drawn += 1
        except Exception:
            continue
    return drawn


def render_sheet_svg(geo_block, ann_block, doc, *, draw_text: bool = True) -> tuple[str, dict] | tuple[None, None]:
    """Render one composite sheet SVG. Returns (svg_string, metadata)."""
    paths_by_color: dict[str, list[str]] = {}
    texts: list[dict] = []
    drawn = 0

    if geo_block is not None:
        drawn += _draw_block_to_paths(geo_block, doc, paths_by_color, texts)
    if ann_block is not None:
        drawn += _draw_block_to_paths(ann_block, doc, paths_by_color, texts)

    if drawn == 0:
        return None, None

    # Compute bbox from rendered content
    xs, ys = [], []
    for color, ds in paths_by_color.items():
        for d in ds:
            for nx, ny in re.findall(r"([-\d.]+),(-?[\d.]+)", d):
                xs.append(float(nx)); ys.append(float(ny))
    for t in texts:
        xs.append(t["x"]); ys.append(-t["y"])
    if not xs:
        return None, None

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w = max(1.0, max_x - min_x)
    h = max(1.0, max_y - min_y)
    pad = max(w, h) * 0.04
    vb_x = min_x - pad
    vb_y = min_y - pad
    vb_w = w + 2 * pad
    vb_h = h + 2 * pad

    sw = _stroke_width(max(w, h))

    out: list[str] = []
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{vb_x:.2f} {vb_y:.2f} {vb_w:.2f} {vb_h:.2f}" '
        f'preserveAspectRatio="xMidYMid meet" '
        f'style="background:#ffffff">'
    )
    out.append(
        f'<rect x="{vb_x:.2f}" y="{vb_y:.2f}" width="{vb_w:.2f}" height="{vb_h:.2f}" fill="#ffffff"/>'
    )
    # Group strokes by color to keep file size down
    out.append(f'<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="{sw:.3f}">')
    for color, ds in paths_by_color.items():
        if color.endswith("|fill"):
            real = color[:-5]
            out.append(f'<path fill="{real}" fill-opacity="0.35" stroke="{real}" stroke-width="{sw * 0.6:.3f}" d="{" ".join(ds)}"/>')
        else:
            out.append(f'<path stroke="{color}" d="{" ".join(ds)}"/>')
    out.append("</g>")

    if draw_text and texts:
        out.append('<g font-family="Arial, sans-serif">')
        for t in texts:
            fs = max(sw * 8, t["h"] * 0.85)
            x = t["x"]; y = -t["y"]
            transform = ""
            if abs(t["rot"]) > 0.1:
                transform = f' transform="rotate({-t["rot"]:.2f} {x:.2f} {y:.2f})"'
            anchor = "end" if t["rtl"] else "start"
            direction = ' direction="rtl"' if t["rtl"] else ""
            txt = xml_escape(t["text"])
            out.append(
                f'<text x="{x:.2f}" y="{y:.2f}" font-size="{fs:.2f}" '
                f'fill="{t["color"]}" text-anchor="{anchor}"{direction}{transform}>{txt}</text>'
            )
        out.append("</g>")

    out.append("</svg>")

    meta = {
        "entity_count": drawn,
        "bbox": [round(min_x, 2), round(min_y, 2), round(max_x, 2), round(max_y, 2)],
    }
    return "\n".join(out), meta


# ----------------------------------------------------------------- main

# Generic Hebrew labels we attach when no semantic clue is present.
_TYPE_ICON = {
    "floor_plan": "🏠",
    "roof_plan": "🏘️",
    "cross_section": "✂️",
    "elevation": "🏛️",
    "site_plan": "🗺️",
    "survey": "📐",
    "parking_section": "🅿️",
    "index_page": "📋",
    "unclassified": "📐",
}


def _safe_filename_part(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", s.strip())
    return s.strip("-").lower() or "sheet"


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python dxf_sheet_renderer.py <dxf> <out_dir>"}))
        sys.exit(1)

    dxf_path = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = load_dxf(dxf_path)
    except Exception as e:
        print(json.dumps({"error": f"readfile failed: {e}"}))
        sys.exit(1)

    # Collect viewport blocks with content
    blocks_by_name = {}
    stats: list[dict] = []
    for block in doc.blocks:
        name = block.name
        if not name.startswith("VIEWPORT") or name.startswith("VIEWPORT_"):
            continue
        s = block_stats(block)
        if s["total"] < 5:
            continue
        blocks_by_name[name] = block
        stats.append(s)

    if not stats:
        print(json.dumps({"sheets": [], "files": [], "warning": "no viewport blocks with content"}))
        return

    pairs = pair_viewports(stats)

    stats_by_name = {s["name"]: s for s in stats}
    sheets: list[dict] = []
    sheet_num = 0
    for pair in pairs:
        geo_block = blocks_by_name.get(pair["geo"]) if pair["geo"] else None
        ann_block = blocks_by_name.get(pair["ann"]) if pair["ann"] else None
        if geo_block is None and ann_block is None:
            continue

        geo_stats = stats_by_name.get(pair["geo"]) if pair["geo"] else None
        label = label_sheet(geo_block, ann_block, geo_stats=geo_stats)
        sheet_num += 1
        slug = _safe_filename_part(label["label_en"])
        filename = f"sheet_{sheet_num:02d}_{slug}.svg"

        svg, meta = render_sheet_svg(geo_block, ann_block, doc)
        if svg is None:
            log(f"  [skip] {filename} — no entities")
            continue

        out_path = os.path.join(out_dir, filename)
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(svg)
        log(f"  wrote {filename} ({meta['entity_count']} entities)")

        sheets.append({
            "sheet_num": sheet_num,
            "filename": filename,
            "label_he": label["label_he"],
            "label_en": label["label_en"],
            "type": label["type"],
            "icon": _TYPE_ICON.get(label["type"], "📐"),
            "scale": label["scale"],
            "geo_viewport": pair["geo"],
            "ann_viewport": pair["ann"],
            "pair_score": pair["score"],
            "entity_count": meta["entity_count"],
            "bbox": meta["bbox"],
        })

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    result = {
        "sheets": sheets,
        "files": [s["filename"] for s in sheets],
        "viewport_count": len(stats),
        "sheet_count": len(sheets),
    }
    try:
        print(json.dumps(result, ensure_ascii=False))
    except (UnicodeEncodeError, ValueError):
        print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
