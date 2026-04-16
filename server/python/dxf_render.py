#!/usr/bin/env python3
"""
dxf_render.py — Render a DXF as PNG previews (dark background, ACI colors).

Produces an overview and a zoomed detail of modelspace, plus a light attempt
to render the bounding box of every classified VIEWPORT block if modelspace is
sparse (common in Israeli permit DXFs where content lives inside viewports).

Usage: python3 dxf_render.py <dxf_path> <output_dir>
Output (stdout, JSON): list of generated filenames (basename only).
"""
import sys
import os
import math
import json
import re

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from matplotlib.patches import Polygon as MplPolygon, Circle as MplCircle, Ellipse as MplEllipse
import matplotlib.patheffects as pe

import ezdxf


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def distance(p1, p2):
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


ACI_COLORS = {
    1: "#FF0000", 2: "#FFFF00", 3: "#00FF00", 4: "#00FFFF", 5: "#0000FF",
    6: "#FF00FF", 7: "#FFFFFF", 8: "#808080", 9: "#C0C0C0",
    10: "#FF0000", 11: "#FF7F7F", 12: "#CC0000", 14: "#990000",
    20: "#FF3F00", 21: "#FF9F7F", 30: "#FF7F00", 31: "#FFBF7F",
    40: "#FFBF00", 41: "#FFDF7F", 50: "#FFFF00", 51: "#FFFF7F",
    60: "#BFFF00", 70: "#7FFF00", 80: "#3FFF00", 90: "#00FF00",
    100: "#00FF3F", 110: "#00FF7F", 120: "#00FFBF", 130: "#00FFFF",
    140: "#00BFFF", 150: "#007FFF", 160: "#003FFF", 170: "#0000FF",
    180: "#3F00FF", 190: "#7F00FF", 200: "#BF00FF", 210: "#FF00FF",
    220: "#FF00BF", 230: "#FF007F", 240: "#FF003F",
    250: "#333333", 251: "#505050", 252: "#696969",
    253: "#808080", 254: "#B3B3B3", 255: "#CCCCCC",
}


def get_aci_color(idx):
    return ACI_COLORS.get(idx, "#AAAAAA")


def get_entity_color(entity, doc):
    try:
        color = entity.dxf.color
        if color is None or color == 256:
            layer = doc.layers.get(entity.dxf.layer)
            if layer:
                color = layer.color
        if color == 0:
            color = 7
        if color is not None and color > 0:
            return get_aci_color(color)
    except Exception:
        pass
    return "#AAAAAA"


def get_entity_lineweight(entity, doc):
    try:
        lw = entity.dxf.lineweight
        if lw is not None and lw > 0:
            return max(0.3, min(3.0, lw / 40))
        layer = doc.layers.get(entity.dxf.layer)
        if layer and hasattr(layer.dxf, "lineweight") and layer.dxf.lineweight > 0:
            return max(0.3, min(3.0, layer.dxf.lineweight / 40))
    except Exception:
        pass
    return 0.5


BG_COLOR = "#1e1e2e"
TEXT_COLOR = "#CCCCCC"
ASCII_TEXT_RE = re.compile(r"^[\d\.\-\+\s\*/=\(\)a-zA-Z°'\"]+$")


def _draw_entity(e, doc, center, radius, ax, segments, seg_colors, seg_widths, is_detail):
    """Draw one entity onto ax / segment list. Returns 1 if drawn, 0 otherwise."""
    try:
        col = get_entity_color(e, doc)
        w = get_entity_lineweight(e, doc)
        et = e.dxftype()

        if et == "LINE":
            s = (e.dxf.start[0], e.dxf.start[1])
            en = (e.dxf.end[0], e.dxf.end[1])
            mid = ((s[0] + en[0]) / 2, (s[1] + en[1]) / 2)
            if distance(mid, center) > radius * 1.3:
                return 0
            segments.append([s, en]); seg_colors.append(col); seg_widths.append(w)
            return 1

        if et == "LWPOLYLINE":
            pts = list(e.get_points(format="xy"))
            if len(pts) < 2:
                return 0
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            if distance((cx, cy), center) > radius * 1.3:
                return 0
            if e.closed and len(pts) >= 3:
                ax.add_patch(MplPolygon(pts, closed=True, facecolor=col + "15",
                                        edgecolor=col, linewidth=w * 1.2, zorder=5))
                return 1
            for i in range(len(pts) - 1):
                segments.append([pts[i], pts[i + 1]])
                seg_colors.append(col); seg_widths.append(w)
            return 1

        if et == "ARC":
            cx, cy = e.dxf.center[0], e.dxf.center[1]
            r = e.dxf.radius
            if distance((cx, cy), center) > radius * 1.3 + r:
                return 0
            sa = math.radians(e.dxf.start_angle)
            ea = math.radians(e.dxf.end_angle)
            if ea < sa:
                ea += 2 * math.pi
            steps = max(int((ea - sa) / math.radians(2)), 8)
            pts = [(cx + r * math.cos(sa + (ea - sa) * i / steps),
                    cy + r * math.sin(sa + (ea - sa) * i / steps))
                   for i in range(steps + 1)]
            for i in range(len(pts) - 1):
                segments.append([pts[i], pts[i + 1]])
                seg_colors.append(col); seg_widths.append(w)
            return 1

        if et == "CIRCLE":
            cx, cy = e.dxf.center[0], e.dxf.center[1]
            r = e.dxf.radius
            if distance((cx, cy), center) > radius * 1.3:
                return 0
            ax.add_patch(MplCircle((cx, cy), r, fill=False, edgecolor=col, linewidth=w, zorder=3))
            return 1

        if et == "INSERT":
            px, py = e.dxf.insert[0], e.dxf.insert[1]
            if distance((px, py), center) > radius * 1.3:
                return 0
            ax.plot(px, py, "+", color=col, markersize=2.5, markeredgewidth=0.4, zorder=3)
            return 1

        if et in ("TEXT", "MTEXT"):
            txt = e.dxf.text if et == "TEXT" else e.text
            pos = e.dxf.insert
            if not txt or not txt.strip():
                return 0
            if distance((pos[0], pos[1]), center) > radius * 1.1:
                return 0
            txt_s = txt.strip()
            # Skip unicode/Hebrew that matplotlib may not render nicely.
            if any(0xD800 <= ord(c) <= 0xDFFF for c in txt_s):
                return 0
            if not ASCII_TEXT_RE.match(txt_s):
                return 0
            max_len = 12 if is_detail else 6
            if len(txt_s) <= max_len:
                fs = 4.0 if is_detail else 3.0
                ax.text(pos[0], pos[1], txt_s, fontsize=fs, color=col,
                        ha="center", va="center", zorder=8,
                        path_effects=[pe.withStroke(linewidth=1.0, foreground=BG_COLOR)])
                return 1
            return 0

        if et == "HATCH":
            for path in e.paths:
                if hasattr(path, "vertices"):
                    pts = [(v[0], v[1]) for v in path.vertices]
                    if len(pts) >= 3:
                        mid = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
                        if distance(mid, center) > radius * 1.3:
                            continue
                        ax.add_patch(MplPolygon(pts, closed=True, facecolor=col + "30",
                                                edgecolor=col, linewidth=0.3, zorder=1))
            return 1

        if et == "SOLID":
            pts = [(e.dxf.vtx0[0], e.dxf.vtx0[1]),
                   (e.dxf.vtx1[0], e.dxf.vtx1[1]),
                   (e.dxf.vtx2[0], e.dxf.vtx2[1])]
            try:
                pts.append((e.dxf.vtx3[0], e.dxf.vtx3[1]))
            except Exception:
                pass
            mid = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            if distance(mid, center) > radius * 1.3:
                return 0
            ax.add_patch(MplPolygon(pts, closed=True, facecolor=col + "60",
                                    edgecolor=col, linewidth=0.2, zorder=1))
            return 1

        if et == "ELLIPSE":
            cx, cy = e.dxf.center[0], e.dxf.center[1]
            if distance((cx, cy), center) > radius * 1.3:
                return 0
            major = math.sqrt(e.dxf.major_axis[0] ** 2 + e.dxf.major_axis[1] ** 2)
            minor = major * e.dxf.ratio
            angle = math.degrees(math.atan2(e.dxf.major_axis[1], e.dxf.major_axis[0]))
            ax.add_patch(MplEllipse((cx, cy), major * 2, minor * 2, angle=angle,
                                    fill=False, edgecolor=col, linewidth=w, zorder=3))
            return 1

        if et == "SPLINE":
            pts = list(e.control_points)
            if len(pts) < 2:
                return 0
            mid = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
            if distance(mid, center) > radius * 1.3:
                return 0
            for i in range(len(pts) - 1):
                segments.append([(pts[i][0], pts[i][1]), (pts[i + 1][0], pts[i + 1][1])])
                seg_colors.append(col); seg_widths.append(w)
            return 1
    except Exception:
        return 0
    return 0


def _bbox_from_entities(entities):
    xs, ys = [], []
    for e in entities:
        try:
            et = e.dxftype()
            if et == "LINE":
                xs += [e.dxf.start[0], e.dxf.end[0]]
                ys += [e.dxf.start[1], e.dxf.end[1]]
            elif et == "INSERT":
                xs.append(e.dxf.insert[0]); ys.append(e.dxf.insert[1])
            elif et in ("TEXT", "MTEXT"):
                xs.append(e.dxf.insert[0]); ys.append(e.dxf.insert[1])
            elif et == "CIRCLE" or et == "ARC":
                xs.append(e.dxf.center[0]); ys.append(e.dxf.center[1])
            elif et == "LWPOLYLINE":
                for p in e.get_points(format="xy"):
                    xs.append(p[0]); ys.append(p[1])
        except Exception:
            continue
    if not xs or not ys:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def render_source(entities, doc, out_path, figsize, dpi, title, is_detail, center=None, radius=None):
    """Render a sequence of entities into a PNG file."""
    bbox = _bbox_from_entities(entities)
    if not bbox:
        return False
    if center is None or radius is None:
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        size = max(bbox[2] - bbox[0], bbox[3] - bbox[1])
        center = (cx, cy)
        radius = (size / 2) * 1.1 if not is_detail else (size / 2) * 0.4

    fig, ax = plt.subplots(figsize=figsize)
    segments, seg_colors, seg_widths = [], [], []
    count = 0
    for e in entities:
        count += _draw_entity(e, doc, center, radius, ax, segments, seg_colors, seg_widths, is_detail)

    if count == 0 and not segments:
        plt.close(fig)
        return False

    if segments:
        ax.add_collection(LineCollection(segments, colors=seg_colors, linewidths=seg_widths, zorder=2))

    ax.set_xlim(center[0] - radius, center[0] + radius)
    ax.set_ylim(center[1] - radius, center[1] + radius)
    ax.set_aspect("equal")
    ax.set_facecolor(BG_COLOR)
    fig.patch.set_facecolor(BG_COLOR)
    ax.tick_params(labelsize=5, colors="#666666")
    for spine in ax.spines.values():
        spine.set_color("#333333")
    ax.set_title(title, fontsize=9, color=TEXT_COLOR, pad=8)

    fig.savefig(out_path, dpi=dpi, bbox_inches="tight", facecolor=BG_COLOR)
    plt.close(fig)
    log(f"  saved {out_path} ({count} entities)")
    return True


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: python dxf_render.py <dxf> <out_dir>"}))
        sys.exit(1)

    dxf_path = sys.argv[1]
    out_dir = sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)

    try:
        doc = ezdxf.readfile(dxf_path)
    except Exception as e:
        print(json.dumps({"error": f"readfile failed: {e}"}))
        sys.exit(1)

    msp = list(doc.modelspace())
    generated = []

    # Modelspace overview + detail (v2 style)
    if len(msp) > 20:
        if render_source(msp, doc, os.path.join(out_dir, "plan_overview.png"),
                         figsize=(16, 12), dpi=150, title="Overview", is_detail=False):
            generated.append("plan_overview.png")
        if render_source(msp, doc, os.path.join(out_dir, "plan_detail.png"),
                         figsize=(14, 14), dpi=300, title="Detail", is_detail=True):
            generated.append("plan_detail.png")

    # If modelspace is sparse, render classified viewport blocks (up to 8).
    if len(generated) < 2:
        vp_rendered = 0
        for block in doc.blocks:
            name = block.name
            if not name.startswith("VIEWPORT") or name.startswith("VIEWPORT_"):
                continue
            entities = list(block)
            if len(entities) < 20:
                continue
            fname = f"{name}.png"
            if render_source(entities, doc, os.path.join(out_dir, fname),
                             figsize=(12, 10), dpi=150, title=name, is_detail=False):
                generated.append(fname)
                vp_rendered += 1
                if vp_rendered >= 8:
                    break

    print(json.dumps(generated))


if __name__ == "__main__":
    main()
