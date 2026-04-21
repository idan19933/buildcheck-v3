#!/usr/bin/env python3
"""
DXF Explorer — Generic structural fingerprint for any DXF file.

Produces a JSON report describing everything in the file without interpreting
anything domain-specific. The output is designed to be fed to an AI that will
generate a custom extraction script tailored to this exact file's structure.

Usage : python dxf_explorer.py input.dxf > exploration.json
On error: JSON {"error": "..."} and exit 1.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter

try:
    import ezdxf
except ImportError:
    print(json.dumps({"error": "ezdxf not installed. Run: pip install -r requirements.txt"}))
    sys.exit(1)


# ----------------------------------------------------------------- text helpers

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


def _safe_text(text: str) -> str:
    decoded = decode_text(text)
    return "".join(c for c in decoded if c.isprintable() or c in "\t\n")


def _has_hebrew(s: str) -> bool:
    return any("\u0590" <= c <= "\u05FF" for c in s)


# ----------------------------------------------------------------- DXF load (with Hebrew encoding fallback)

def _has_hebrew_anywhere(doc) -> bool:
    """Quick scan for Hebrew chars across all blocks."""
    checked = 0
    for block in doc.blocks:
        for e in block:
            if checked > 300:
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


def load_dxf(path: str):
    """Try Hebrew encodings if default doesn't yield Hebrew text."""
    doc = ezdxf.readfile(path)
    if _has_hebrew_anywhere(doc):
        return doc
    for enc in ("cp1255", "cp862"):
        try:
            doc2 = ezdxf.readfile(path, encoding=enc)
            if _has_hebrew_anywhere(doc2):
                print(f"[encoding] re-read with {enc}", file=sys.stderr)
                return doc2
        except Exception:
            continue
    return doc


# ----------------------------------------------------------------- block fingerprint

def _entity_points(e) -> list[tuple[float, float]]:
    et = e.dxftype()
    try:
        if et == "LINE":
            return [(e.dxf.start[0], e.dxf.start[1]), (e.dxf.end[0], e.dxf.end[1])]
        if et in ("TEXT", "MTEXT", "INSERT"):
            return [(e.dxf.insert[0], e.dxf.insert[1])]
        if et in ("CIRCLE", "ARC"):
            c, r = e.dxf.center, e.dxf.radius
            return [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)]
        if et == "POLYLINE":
            return [(v.dxf.location[0], v.dxf.location[1]) for v in e.vertices]
        if et == "LWPOLYLINE":
            return [(p[0], p[1]) for p in e.get_points(format="xy")]
        if et == "SOLID":
            pts = []
            for k in ("vtx0", "vtx1", "vtx2", "vtx3"):
                try:
                    p = getattr(e.dxf, k)
                    pts.append((p[0], p[1]))
                except Exception:
                    pass
            return pts
    except Exception:
        return []
    return []


def explore_block(block) -> dict | None:
    entities = list(block)
    if not entities:
        return None

    type_counts: Counter = Counter()
    layers: Counter = Counter()
    insert_refs: Counter = Counter()
    polyline_stats = {"count": 0, "closed": 0, "total_vertices": 0}
    text_samples: list[dict] = []
    mtext_samples: list[str] = []
    seen_text: set[str] = set()
    all_text_strings: list[str] = []   # full text content for keyword scanning (not bounded by sample cap)

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    for e in entities:
        et = e.dxftype()
        type_counts[et] += 1
        try:
            layers[e.dxf.layer] += 1
        except Exception:
            pass

        for x, y in _entity_points(e):
            if x < min_x: min_x = x
            if y < min_y: min_y = y
            if x > max_x: max_x = x
            if y > max_y: max_y = y

        if et == "TEXT":
            try:
                raw_unstripped = e.dxf.text or ""
                raw = raw_unstripped.strip()
                if raw:
                    all_text_strings.append(raw)
                    if raw not in seen_text and len(text_samples) < 50:
                        seen_text.add(raw)
                        sample = {
                            # The RAW string exactly as ezdxf returned it.
                            # Do NOT decode here — Claude figures out the encoding
                            # from visual context (numbered dots on the preview PNG).
                            "raw": raw,
                            "x": round(float(e.dxf.insert[0]), 1),
                            "y": round(float(e.dxf.insert[1]), 1),
                            "height": round(float(getattr(e.dxf, "height", 0) or 0), 2) or None,
                            "layer": getattr(e.dxf, "layer", None),
                        }
                        # Encoding HINTS only — not authoritative.
                        if "\\U+" in raw:
                            try:
                                decoded = _UNICODE_ESCAPE_RE.sub(
                                    lambda m: chr(int(m.group(1), 16)), raw,
                                )
                                sample["decode_unicode"] = decoded.strip()
                            except Exception:
                                pass
                        if any("\u0590" <= c <= "\u05FF" for c in raw):
                            sample["has_native_hebrew"] = True
                        # SHX-Latin heuristic: lowercase Latin/punct only,
                        # not a normal English word, > 2 chars.
                        stripped_low = raw.lower()
                        normalized = (
                            stripped_low
                            .replace(" ", "").replace("/", "").replace('"', "")
                            .replace(",", "").replace(".", "").replace("'", "")
                        )
                        en_words = ("the", "and", "for", "not", "scale", "plan",
                                    "section", "floor", "elevation", "drawing",
                                    "detail", "north", "south", "east", "west")
                        if (
                            len(stripped_low) > 2
                            and normalized.isalpha()
                            and normalized.isascii()
                            and not any(w in stripped_low for w in en_words)
                        ):
                            sample["possibly_shx_hebrew"] = True
                        text_samples.append(sample)
            except Exception:
                pass

        if et == "MTEXT":
            try:
                raw_attr = getattr(e, "text", None) or e.dxf.text or ""
                raw = raw_attr.strip()
                if raw:
                    all_text_strings.append(raw)
                    if len(mtext_samples) < 10:
                        mtext_samples.append(raw[:200])
            except Exception:
                pass

        if et == "INSERT":
            try:
                insert_refs[e.dxf.name] += 1
            except Exception:
                pass

        if et in ("POLYLINE", "LWPOLYLINE"):
            polyline_stats["count"] += 1
            try:
                if et == "POLYLINE":
                    verts = list(e.vertices)
                    polyline_stats["total_vertices"] += len(verts)
                    if e.is_closed:
                        polyline_stats["closed"] += 1
                else:
                    pts = list(e.get_points(format="xy"))
                    polyline_stats["total_vertices"] += len(pts)
                    if e.closed:
                        polyline_stats["closed"] += 1
            except Exception:
                pass

    bbox = None
    if min_x != float("inf"):
        bbox = {
            "min_x": round(min_x, 1), "min_y": round(min_y, 1),
            "max_x": round(max_x, 1), "max_y": round(max_y, 1),
            "width": round(max_x - min_x, 1),
            "height": round(max_y - min_y, 1),
        }

    # Detect text patterns by scanning the samples
    text_patterns = {
        "has_hebrew": False,
        "has_heights": False,        # +X.XX or -X.XX
        "has_integers": False,       # bare ints (likely dimensions)
        "has_percentages": False,    # X%
        "has_decimals": False,       # X.XX
        "has_scales": False,         # 1:NNN
        "has_coordinates": False,    # large decimal > 600 (terrain elevations)
        "has_radius": False,         # R=XXX
    }
    # Numeric patterns are encoding-agnostic — scan ALL collected text strings.
    for txt in all_text_strings:
        if _has_hebrew(txt): text_patterns["has_hebrew"] = True
        if re.match(r"^[+\-]\d+\.?\d*$", txt): text_patterns["has_heights"] = True
        if re.match(r"^\d+$", txt) and len(txt) <= 4: text_patterns["has_integers"] = True
        if re.match(r"^\d+\.?\d*%$", txt): text_patterns["has_percentages"] = True
        if re.match(r"^\d+\.\d+$", txt):
            text_patterns["has_decimals"] = True
            try:
                if float(txt) > 600: text_patterns["has_coordinates"] = True
            except ValueError:
                pass
        if re.match(r"^1\s*:\s*\d+$", txt.replace(" ", "")):
            text_patterns["has_scales"] = True
        if re.match(r"^R\s*=", txt): text_patterns["has_radius"] = True

    # Keyword classification hints — pre-digested matches by category
    floor_kw = ("מטבח", "סלון", "דיור", "הורים", "שינה", "אמבטיה",
                "שירותים", "מבואה", "ממד", "מרפסת", "ארונות", "עבודה",
                "כביסה", "אוכל", "מטבחון")
    elev_kw = ("קו בניין", "גבול מגרש", "חזית", "צפונית", "דרומית",
               "מזרחית", "מערבית", "מעקה בנוי", "שכן מגרש")
    section_kw = ("חתך", "1-1", "2-2", "3-3", "4-4")
    survey_kw = ("מדידה", "R=")
    parking_kw = ("חנייה", "חניייה", "מקורה", "חתך חנייה")
    roof_kw = ("גג", "תוכנית גג", "מרזב", "ניקוז")
    area_kw = ("חישוב שטחים", "טבלת שטחים", "שטח עיקרי", "שטח שירות",
               "תכסית", "אחוזי בנייה")
    index_kw = ("תיק מידע", "1:50", "1:100", "1:250")

    classification_keywords: dict[str, list[str]] = {
        "floor_plan_keywords": [],
        "elevation_keywords": [],
        "section_keywords": [],
        "survey_keywords": [],
        "parking_keywords": [],
        "roof_keywords": [],
        "area_keywords": [],
        "index_keywords": [],
    }

    def _scan(words: tuple, bucket: str) -> None:
        # Scan EVERY text in the block. Match against BOTH the raw string AND
        # its Unicode-escape-decoded form so we still get hints on \\U+XXXX
        # files. SHX-Latin files won't match either form — Claude classifies
        # those from the preview images instead.
        seen = set()
        for s in all_text_strings:
            decoded = s
            if "\\U+" in s:
                try:
                    decoded = _UNICODE_ESCAPE_RE.sub(
                        lambda m: chr(int(m.group(1), 16)), s,
                    )
                except Exception:
                    decoded = s
            for w in words:
                if w not in seen and (w in s or w in decoded):
                    seen.add(w)
                    classification_keywords[bucket].append(w)

    _scan(floor_kw, "floor_plan_keywords")
    _scan(elev_kw, "elevation_keywords")
    _scan(section_kw, "section_keywords")
    _scan(survey_kw, "survey_keywords")
    _scan(parking_kw, "parking_keywords")
    _scan(roof_kw, "roof_keywords")
    _scan(area_kw, "area_keywords")
    _scan(index_kw, "index_keywords")

    return {
        "entity_counts": dict(type_counts),
        "total_entities": len(entities),
        "bounding_box": bbox,
        "text_samples": text_samples,
        "mtext_samples": mtext_samples,
        "text_patterns": text_patterns,
        "classification_keywords": classification_keywords,
        "insert_references": dict(insert_refs.most_common(20)),
        "layers_used": dict(layers.most_common(20)),
        "polyline_stats": polyline_stats,
    }


# ----------------------------------------------------------------- analysis hints

def _bbox_overlap_area(a: dict, b: dict) -> float:
    if not a or not b:
        return 0.0
    xo = max(0.0, min(a["max_x"], b["max_x"]) - max(a["min_x"], b["min_x"]))
    yo = max(0.0, min(a["max_y"], b["max_y"]) - max(a["min_y"], b["min_y"]))
    return xo * yo


def _bbox_iou(a: dict, b: dict) -> float:
    if not a or not b:
        return 0.0
    inter = _bbox_overlap_area(a, b)
    if inter <= 0:
        return 0.0
    union = max(0.001, a["width"] * a["height"]) + max(0.001, b["width"] * b["height"]) - inter
    return inter / union if union > 0 else 0.0


def derive_hints(result: dict) -> dict:
    hints: dict = {}
    blocks = result["blocks"]

    # ── Dual-viewport detection (geometry vs annotation split)
    viewport_blocks = [n for n in blocks if n.startswith("VIEWPORT") and not n.startswith("VIEWPORT_")]
    if viewport_blocks:
        geo_vps, text_vps = [], []
        for vp in viewport_blocks:
            info = blocks[vp]
            ec = info["entity_counts"]
            lines = ec.get("LINE", 0) + info["polyline_stats"]["count"]
            texts = ec.get("TEXT", 0) + ec.get("MTEXT", 0)
            if lines > 500 and texts < 20:
                geo_vps.append(vp)
            elif texts > 20 and lines < texts * 5:
                text_vps.append(vp)

        if geo_vps and text_vps:
            hints["dual_viewport_pattern"] = True
            hints["geometry_viewports"] = sorted(geo_vps)
            hints["annotation_viewports"] = sorted(text_vps)
            hints["note"] = (
                "This file uses a dual-viewport architecture. Geometry VPs contain "
                "walls/hatching (LINE+POLYLINE), annotation VPs contain labels/dimensions "
                "(TEXT). Each printable sheet is a composite of one geometry VP + one "
                "annotation VP overlaid at the same coordinates."
            )

            # Pair by IoU — global best-pair-first to avoid greedy mistakes
            candidates = []
            for g in geo_vps:
                for t in text_vps:
                    iou = _bbox_iou(blocks[g]["bounding_box"], blocks[t]["bounding_box"])
                    if iou > 0.4:
                        candidates.append((iou, g, t))
            candidates.sort(key=lambda c: -c[0])
            used_g: set[str] = set(); used_t: set[str] = set()
            pairs = []
            for iou, g, t in candidates:
                if g in used_g or t in used_t:
                    continue
                used_g.add(g); used_t.add(t)
                pairs.append({"geometry": g, "annotations": t, "iou": round(iou, 3)})
            # Append unpaired blocks so the AI knows about them
            for g in geo_vps:
                if g not in used_g:
                    pairs.append({"geometry": g, "annotations": None, "iou": 0.0})
            for t in text_vps:
                if t not in used_t:
                    pairs.append({"geometry": None, "annotations": t, "iou": 0.0})
            hints["viewport_pairs"] = pairs
        else:
            hints["dual_viewport_pattern"] = False

    # ── Content location
    msp_count = result.get("modelspace_summary", {}).get("total_entities", 0) if result.get("modelspace_summary") else 0
    block_count = sum(info["total_entities"] for info in blocks.values())
    hints["content_location"] = "modelspace" if msp_count > block_count else "blocks"
    hints["modelspace_entity_count"] = msp_count
    hints["named_block_entity_count"] = block_count

    # ── Text encoding signals (multi-encoding aware — see Pattern: visual context)
    encoding_signals = {
        "has_unicode_escapes": False,   # \\U+XXXX sequences → decode then match Hebrew
        "has_native_hebrew": False,     # raw UTF-8 Hebrew → match directly
        "has_possible_shx": False,      # Latin chars rendered as Hebrew via SHX font → match raw
        "has_high_bytes": False,        # 0x80-0xFF bytes → CP862 / Win-1255
        "font_names": [],
        "dxf_declared_encoding": result["file_info"].get("encoding"),
    }
    for info in blocks.values():
        for t in info.get("text_samples", []):
            raw = t.get("raw", "")
            if "\\U+" in raw:
                encoding_signals["has_unicode_escapes"] = True
            if t.get("has_native_hebrew"):
                encoding_signals["has_native_hebrew"] = True
            if t.get("possibly_shx_hebrew"):
                encoding_signals["has_possible_shx"] = True
            if any(0x80 <= ord(c) <= 0xFF for c in raw):
                encoding_signals["has_high_bytes"] = True
    # Pull font_names out of the text-styles table the explorer already collected.
    for style in result.get("text_styles", []) or []:
        if style.get("font") or style.get("bigfont"):
            encoding_signals["font_names"].append({
                "style": style.get("name"),
                "font": style.get("font") or "",
                "bigfont": style.get("bigfont") or "",
            })
    hints["text_encoding"] = encoding_signals

    # ── Dimension unit heuristic
    all_integers: list[int] = []
    for info in blocks.values():
        for t in info.get("text_samples", []):
            raw = t.get("raw", "")
            if re.match(r"^\d+$", raw) and 10 <= int(raw) <= 20000:
                all_integers.append(int(raw))
    if all_integers:
        avg = sum(all_integers) / len(all_integers)
        if avg > 1500:
            hints["dimension_unit"] = "millimeters"
        elif avg > 50:
            hints["dimension_unit"] = "centimeters"
        else:
            hints["dimension_unit"] = "meters"
        hints["dimension_unit_evidence"] = {
            "sample_size": len(all_integers),
            "mean_value": round(avg, 1),
        }

    # ── Definitive single-block hints — make obvious cases unambiguous so the AI
    #    doesn't have to re-deduce them from rules. Pre-classify by hard signals.
    survey_blocks: list[str] = []
    index_blocks: list[str] = []
    floor_plan_blocks: list[str] = []
    for name, info in blocks.items():
        ec = info.get("entity_counts", {}) or {}
        tp = info.get("text_patterns", {}) or {}
        ck = info.get("classification_keywords", {}) or {}
        line_count = ec.get("LINE", 0)
        room_kw = ck.get("floor_plan_keywords") or []

        # Survey: huge line count + terrain coordinates (decimals > 600) + curve radii (R=).
        if line_count > 10000 and tp.get("has_coordinates") and tp.get("has_radius"):
            survey_blocks.append(name)

        # Index page: a block whose Hebrew text spans MANY sheet categories
        # (it's literally listing every sheet name with scale).
        category_hits = sum(
            1 for bucket in (
                "floor_plan_keywords", "elevation_keywords", "section_keywords",
                "survey_keywords", "parking_keywords", "roof_keywords",
                "area_keywords",
            )
            if (ck.get(bucket) or [])
        )
        if category_hits >= 4 and ec.get("TEXT", 0) > 30 and line_count < 100:
            index_blocks.append(name)

        # Floor plan: 3+ distinct room labels — even if parking annotations are
        # present (carports get labeled "חנייה מקורה" inside a ground-floor plan).
        if len(room_kw) >= 3:
            floor_plan_blocks.append(name)

    if survey_blocks:
        hints["definitive_survey_blocks"] = survey_blocks
    if index_blocks:
        hints["definitive_index_blocks"] = index_blocks
    if floor_plan_blocks:
        hints["definitive_floor_plan_blocks"] = floor_plan_blocks

    return hints


# ----------------------------------------------------------------- main

def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python dxf_explorer.py <file.dxf>"}))
        sys.exit(1)

    path = sys.argv[1]
    try:
        doc = load_dxf(path)
    except Exception as e:
        print(json.dumps({"error": f"Failed to read DXF: {e}"}))
        sys.exit(1)

    result = {
        "file_info": {
            "version": doc.dxfversion,
            "encoding": doc.encoding,
        },
        "layouts": [],
        "blocks": {},
        "anonymous_blocks": {"count": 0, "total_entities": 0},
        "modelspace_summary": None,
        "layer_table": [],
        "text_styles": [],
        "analysis_hints": {},
    }

    # Layouts (paperspace + modelspace)
    for layout in doc.layouts:
        try:
            ent_count = len(list(layout))
        except Exception:
            ent_count = 0
        result["layouts"].append({"name": layout.name, "entity_count": ent_count})

    # Layer table
    for layer in doc.layers:
        try:
            result["layer_table"].append({
                "name": layer.dxf.name,
                "color": getattr(layer.dxf, "color", None),
                "on": layer.is_on() if hasattr(layer, "is_on") else True,
            })
        except Exception:
            continue

    # Text styles (font + bigfont matter for SHX-encoded Hebrew detection)
    for style in doc.styles:
        try:
            font = ""
            bigfont = ""
            if hasattr(style.dxf, "get"):
                font = style.dxf.get("font", "") or ""
            else:
                font = getattr(style.dxf, "font", "") or ""
            try:
                bigfont = getattr(style.dxf, "bigfont", "") or ""
            except Exception:
                bigfont = ""
            result["text_styles"].append({
                "name": style.dxf.name,
                "font": font,
                "bigfont": bigfont,
            })
        except Exception:
            continue

    # Modelspace summary
    msp_entities = list(doc.modelspace())
    if msp_entities:
        result["modelspace_summary"] = {
            "total_entities": len(msp_entities),
            "type_counts": dict(Counter(e.dxftype() for e in msp_entities)),
        }

    # Named blocks (and a count of anonymous *U blocks)
    for block in doc.blocks:
        name = block.name
        if name.startswith("*") and not name.startswith("*Paper"):
            ents = list(block)
            if ents:
                result["anonymous_blocks"]["count"] += 1
                result["anonymous_blocks"]["total_entities"] += len(ents)
            continue
        info = explore_block(block)
        if info and info["total_entities"] > 0:
            result["blocks"][name] = info

    result["analysis_hints"] = derive_hints(result)

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    try:
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    except (UnicodeEncodeError, ValueError):
        print(json.dumps(result, ensure_ascii=True, indent=2, default=str))


if __name__ == "__main__":
    main()
