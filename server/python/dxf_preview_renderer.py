#!/usr/bin/env python3
"""
DXF Preview Renderer — deterministic, fast PNG thumbnails for any DXF.

Reads the exploration.json produced by dxf_explorer.py, then renders each
logical sheet to a PNG using matplotlib. Geometry only (LINE, POLYLINE,
LWPOLYLINE, CIRCLE, ARC). No text, no Claude — runs locally in seconds so
the user gets *something* on screen while the AI codegen pipeline cooks.

Usage : python dxf_preview_renderer.py <input.dxf> <exploration.json> <out_dir>
Output: PNG files at <out_dir>/preview_<NN>.png + JSON manifest to stdout.
"""
from __future__ import annotations

import json
import os
import sys
import time

import ezdxf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


# ────────────────────────────────────────────────────────── line collection

def collect_lines_from_block(doc, block_name: str) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """Walk a block and return every renderable segment as (start, end) tuples."""
    block = doc.blocks.get(block_name)
    if block is None:
        return []

    lines: list = []
    for entity in block:
        try:
            et = entity.dxftype()
            if et == "LINE":
                lines.append((
                    (entity.dxf.start[0], entity.dxf.start[1]),
                    (entity.dxf.end[0], entity.dxf.end[1]),
                ))
            elif et == "POLYLINE":
                verts = [(v.dxf.location[0], v.dxf.location[1]) for v in entity.vertices]
                for i in range(len(verts) - 1):
                    lines.append((verts[i], verts[i + 1]))
                if entity.is_closed and len(verts) > 2:
                    lines.append((verts[-1], verts[0]))
            elif et == "LWPOLYLINE":
                pts = list(entity.get_points(format="xy"))
                for i in range(len(pts) - 1):
                    lines.append((pts[i], pts[i + 1]))
                if entity.closed and len(pts) > 2:
                    lines.append((pts[-1], pts[0]))
            elif et == "CIRCLE":
                cx, cy, r = entity.dxf.center[0], entity.dxf.center[1], entity.dxf.radius
                theta = np.linspace(0, 2 * np.pi, 64)
                pts = list(zip(cx + r * np.cos(theta), cy + r * np.sin(theta)))
                for i in range(len(pts) - 1):
                    lines.append((pts[i], pts[i + 1]))
            elif et == "ARC":
                cx, cy, r = entity.dxf.center[0], entity.dxf.center[1], entity.dxf.radius
                sa = np.radians(entity.dxf.start_angle)
                ea = np.radians(entity.dxf.end_angle)
                if ea < sa:
                    ea += 2 * np.pi
                theta = np.linspace(sa, ea, 32)
                pts = list(zip(cx + r * np.cos(theta), cy + r * np.sin(theta)))
                for i in range(len(pts) - 1):
                    lines.append((pts[i], pts[i + 1]))
        except Exception:
            continue
    return lines


def compute_bbox(lines):
    if not lines:
        return None
    xs = [p[0] for seg in lines for p in seg]
    ys = [p[1] for seg in lines for p in seg]
    return {
        "min_x": min(xs), "max_x": max(xs),
        "min_y": min(ys), "max_y": max(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def render_to_png(
    lines,
    output_path: str,
    target_width: int = 1200,
    text_markers: list[dict] | None = None,
) -> bool:
    """Render geometry; optionally overlay numbered red dots at text positions.

    Each marker dict needs {x, y, index}. The number drawn matches the index
    so Claude can correlate "dot #5 lives in the kitchen → text_samples[4].raw
    is the kitchen label" — encoding-agnostic visual decoding.
    """
    bbox = compute_bbox(lines)
    if bbox is None or bbox["width"] < 1 or bbox["height"] < 1:
        return False

    w, h = bbox["width"], bbox["height"]
    aspect = w / h if h else 1.0
    fig_h = 8.0
    fig_w = float(min(24, max(6, fig_h * aspect)))

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    pad = max(w, h) * 0.03
    ax.set_xlim(bbox["min_x"] - pad, bbox["max_x"] + pad)
    ax.set_ylim(bbox["min_y"] - pad, bbox["max_y"] + pad)
    ax.set_aspect("equal")
    ax.set_facecolor("white")
    ax.axis("off")
    fig.patch.set_facecolor("white")

    ax.add_collection(LineCollection(lines, colors="black", linewidths=0.15))

    if text_markers:
        # Only label markers that fall inside the rendered bbox so the
        # drawing stays uncluttered and dot indices remain meaningful.
        x0, x1 = bbox["min_x"], bbox["max_x"]
        y0, y1 = bbox["min_y"], bbox["max_y"]
        drawn = 0
        for m in text_markers:
            x = float(m.get("x", 0))
            y = float(m.get("y", 0))
            if not (x0 <= x <= x1 and y0 <= y <= y1):
                continue
            ax.plot(x, y, "o", color="#dc2626", markersize=2.5,
                    markeredgecolor="white", markeredgewidth=0.4, zorder=10)
            ax.annotate(str(m["index"]), (x, y), fontsize=4, color="#7f1d1d",
                        ha="center", va="bottom", zorder=11,
                        xytext=(0, 1.2), textcoords="offset points")
            drawn += 1
            if drawn >= 30:
                break

    dpi = max(72, target_width / fig_w)
    fig.savefig(output_path, dpi=dpi, bbox_inches="tight",
                facecolor="white", pad_inches=0.1)
    plt.close(fig)
    return True


# ────────────────────────────────────────────────────────── strategies

def _markers_from_block(blocks: dict, *names: str) -> list[dict]:
    """Build a numbered marker list from one or more blocks' text_samples.

    The marker `index` is 1-based and maps to text_samples[index-1] in the
    SAME block, so an annotation prompt can name "block X marker N → raw text".
    """
    out: list[dict] = []
    for name in names:
        if not name:
            continue
        info = blocks.get(name) or {}
        for i, t in enumerate(info.get("text_samples", []) or []):
            out.append({
                "x": t.get("x", 0),
                "y": t.get("y", 0),
                "index": i + 1,
                "block": name,
            })
    return out


def render_dual_viewport_pairs(doc, hints: dict, blocks: dict, out_dir: str) -> list[dict]:
    out: list[dict] = []
    pairs = hints.get("viewport_pairs") or []
    for i, pair in enumerate(pairs):
        geo_vp = pair.get("geometry") or ""
        ann_vp = pair.get("annotations") or ""
        all_lines: list = []
        if geo_vp:
            all_lines.extend(collect_lines_from_block(doc, geo_vp))
        if ann_vp:
            all_lines.extend(collect_lines_from_block(doc, ann_vp))
        if len(all_lines) < 10:
            continue
        fname = f"preview_{i + 1:02d}.png"
        markers = _markers_from_block(blocks, ann_vp, geo_vp)
        if render_to_png(all_lines, os.path.join(out_dir, fname), text_markers=markers):
            out.append({
                "index": i + 1,
                "filename": fname,
                "geometry_vp": geo_vp or None,
                "annotation_vp": ann_vp or None,
                "line_count": len(all_lines),
                "marker_blocks": [b for b in (ann_vp, geo_vp) if b],
            })
    return out


def render_significant_blocks(doc, blocks: dict, out_dir: str, limit: int = 20) -> list[dict]:
    sig: list[tuple[str, int]] = []
    for name, info in blocks.items():
        total = info.get("total_entities", 0)
        line_count = info.get("entity_counts", {}).get("LINE", 0)
        if total > 50 and line_count > 20:
            sig.append((name, total))
    sig.sort(key=lambda x: -x[1])
    out: list[dict] = []
    for i, (name, _) in enumerate(sig[:limit]):
        all_lines = collect_lines_from_block(doc, name)
        if len(all_lines) < 10:
            continue
        fname = f"preview_{i + 1:02d}.png"
        markers = _markers_from_block(blocks, name)
        if render_to_png(all_lines, os.path.join(out_dir, fname), text_markers=markers):
            out.append({
                "index": i + 1,
                "filename": fname,
                "block": name,
                "marker_blocks": [name],
                "line_count": len(all_lines),
            })
    return out


def render_modelspace(doc, out_dir: str) -> list[dict]:
    msp = doc.modelspace()
    all_lines: list = []
    for entity in msp:
        try:
            if entity.dxftype() == "LINE":
                all_lines.append((
                    (entity.dxf.start[0], entity.dxf.start[1]),
                    (entity.dxf.end[0], entity.dxf.end[1]),
                ))
        except Exception:
            continue
    if not all_lines:
        return []
    fname = "preview_01.png"
    if render_to_png(all_lines, os.path.join(out_dir, fname)):
        return [{"index": 1, "filename": fname, "source": "modelspace", "line_count": len(all_lines)}]
    return []


# ────────────────────────────────────────────────────────── main

def main() -> int:
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: python dxf_preview_renderer.py <dxf> <exploration.json> <out_dir>"}))
        return 1

    dxf_path = sys.argv[1]
    exploration_path = sys.argv[2]
    out_dir = sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)

    log(f"reading {os.path.basename(dxf_path)} + exploration")
    doc = ezdxf.readfile(dxf_path)
    with open(exploration_path, "r", encoding="utf-8") as fh:
        exploration = json.load(fh)

    hints = exploration.get("analysis_hints") or {}
    blocks = exploration.get("blocks") or {}

    sheets: list[dict] = []
    if hints.get("dual_viewport_pattern") and hints.get("viewport_pairs"):
        log("strategy: dual-viewport pairs")
        sheets = render_dual_viewport_pairs(doc, hints, blocks, out_dir)
    if not sheets and blocks:
        log("strategy: significant blocks")
        sheets = render_significant_blocks(doc, blocks, out_dir)
    if not sheets:
        log("strategy: modelspace fallback")
        sheets = render_modelspace(doc, out_dir)

    log(f"wrote {len(sheets)} preview PNGs")

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(json.dumps(
        {"preview_count": len(sheets), "previews": sheets, "output_dir": out_dir},
        ensure_ascii=False, indent=2,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
