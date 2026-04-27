"""
Read-only boundaries / construction / changes diagnostic.

Same structure as the rooms diagnostic — different word lists.
Counts how many texts contain each category's words in:
  - logical Hebrew order (what the vocabulary expects)
  - visual-RTL order (each word reversed character-by-character)

Also pulls the production high-confidence count for each category from
the existing production_classified.json captured by the rooms diagnostic.
"""
from __future__ import annotations
import io
import json
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server" / "python"))

from semantic.decoders.pipeline import build_default_pipeline  # noqa: E402

import ezdxf  # noqa: E402

DXF_PATH = "C:/Users/idans/AppData/Local/Temp/dxfs/yatir.dxf"
PRODUCTION = ROOT / "experiments" / "rooms_diagnostic" / "production_classified.json"
OUT_DIR = Path(__file__).parent

PIPELINE = build_default_pipeline()


def decode(s: str) -> str:
    return PIPELINE.decode(s or "").decoded


CATEGORIES: dict[str, list[str]] = {
    "boundaries": [
        "קו בניין",   # building line
        "גבול מגרש",  # plot boundary
        "חזית",        # facade
        "גבול",        # boundary (broader)
        "קו בנין",    # building line (alt spelling)
        "מגרש",        # plot
        "דרך",         # road
        "מדרכה",      # sidewalk
        "שכן",         # neighbour
    ],
    "construction_elements": [
        "קיר",   # wall
        "חלון",  # window
        "דלת",   # door
        "מעקה",  # railing/parapet
        "גג",    # roof
        "תקרה",  # ceiling
        "רצפה",  # floor
        "מדרגות",# stairs
        "עמוד",  # column
        "קורה",  # beam
    ],
    "changes": [
        "להריסה",  # to demolish
        "קיים",     # existing
        "חדש",      # new
        "לסגירה",  # to close
        "להגדלה",  # to enlarge
    ],
}

# Production-side category names used in classified_texts.json
PROD_CATEGORY_KEYS = {
    "boundaries": "boundaries",
    "construction_elements": "construction_elements",
    "changes": "changes",
}


# ─── Production high-conf counts (from classified_texts.json) ──────────
def production_counts() -> dict[str, int]:
    raw = json.loads(PRODUCTION.read_text(encoding="utf-8"))
    records = raw["records"] if isinstance(raw, dict) else raw
    counts: dict[str, int] = {k: 0 for k in PROD_CATEGORY_KEYS.values()}
    for r in records:
        c = r["classification"]
        cat = c.get("category")
        if cat in counts and (c.get("confidence") or 0) >= 0.7:
            counts[cat] += 1
    return counts


# ─── Substring scans on the live DXF ───────────────────────────────────
def scan_dxf() -> tuple[dict[str, dict[str, int]], dict[str, list[dict]]]:
    """Returns (counts, samples) where:
      counts[category] = {logical: N, visual_rtl: N, by_word: {...}}
      samples[category] = list of up to 15 visual-RTL matches.
    """
    doc = ezdxf.readfile(DXF_PATH)

    counts: dict[str, dict] = {
        cat: {"logical": 0, "visual_rtl": 0,
              "by_word_logical": Counter(), "by_word_visual": Counter()}
        for cat in CATEGORIES
    }
    samples: dict[str, list[dict]] = {cat: [] for cat in CATEGORIES}

    rev_lookup = {
        cat: [(w, w[::-1]) for w in words] for cat, words in CATEGORIES.items()
    }

    for block in doc.blocks:
        if block.name.startswith("*Paper_Space"):
            continue
        for e in block:
            if e.dxftype() not in ("TEXT", "MTEXT"):
                continue
            try:
                raw = e.dxf.text if e.dxftype() == "TEXT" else getattr(e, "text", e.dxf.text)
                if not raw:
                    continue
                decoded = decode(str(raw))
                # Scrub for safe storage / printing
                decoded_safe = decoded.encode("utf-8", "replace").decode("utf-8")

                for cat, pairs in rev_lookup.items():
                    matched_logical = next((w for w, _ in pairs if w in decoded), None)
                    matched_visual = next(((w, rw) for w, rw in pairs if rw in decoded), None)
                    if matched_logical:
                        counts[cat]["logical"] += 1
                        counts[cat]["by_word_logical"][matched_logical] += 1
                    if matched_visual:
                        w, rw = matched_visual
                        counts[cat]["visual_rtl"] += 1
                        counts[cat]["by_word_visual"][w] += 1
                        if len(samples[cat]) < 15:
                            samples[cat].append({
                                "viewport": block.name,
                                "raw": str(raw),
                                "decoded": decoded_safe,
                                "matched_word_logical": w,
                                "matched_word_visual": rw,
                            })
            except Exception:
                continue

    # Convert Counters → dicts for JSON
    for cat in counts:
        counts[cat]["by_word_logical"] = dict(counts[cat]["by_word_logical"])
        counts[cat]["by_word_visual"] = dict(counts[cat]["by_word_visual"])
    return counts, samples


def main() -> None:
    print("=" * 70)
    print("BOUNDARIES / CONSTRUCTION / CHANGES DIAGNOSTIC")
    print("=" * 70)
    print(f"DXF: {DXF_PATH}")
    print()

    prod = production_counts()
    print("--- Production high-conf counts (≥0.7) per category ---")
    print(json.dumps(prod, ensure_ascii=False, indent=2))
    print()

    counts, samples = scan_dxf()
    print("--- Substring scan counts ---")
    for cat, c in counts.items():
        print(f"  {cat}:")
        print(f"    logical:    {c['logical']:>4}   {c['by_word_logical']}")
        print(f"    visual_rtl: {c['visual_rtl']:>4}   {c['by_word_visual']}")
    print()

    # Save artifacts
    full_counts = {
        "production_high_conf": prod,
        "substring_scan": counts,
    }
    (OUT_DIR / "counts.json").write_text(
        json.dumps(full_counts, ensure_ascii=False, indent=2), encoding="utf-8")
    def _scrub(x):
        if isinstance(x, str): return x.encode("utf-8", "replace").decode("utf-8")
        if isinstance(x, list): return [_scrub(v) for v in x]
        if isinstance(x, dict): return {k: _scrub(v) for k, v in x.items()}
        return x
    (OUT_DIR / "samples.json").write_text(
        json.dumps(_scrub(samples), ensure_ascii=False, indent=2), encoding="utf-8")

    # Print 5 samples per category
    print("--- Sample visual-RTL matches (up to 5 per category) ---")
    for cat, ss in samples.items():
        print(f"  {cat}:")
        for s in ss[:5]:
            print(f"    [{s['viewport']}] '{s['decoded'][:60]}' (matched reversed {s['matched_word_logical']!r})")
    print()

    # Verdict heuristic
    vrtl = {cat: counts[cat]["visual_rtl"] for cat in counts}
    big = sum(1 for v in vrtl.values() if v >= 15)
    mid = sum(1 for v in vrtl.values() if 5 <= v < 15)
    if big >= 2:
        print("→ STRONG: visual-RTL counts ≥15 in 2+ categories")
    elif big + mid >= 2:
        print("→ MODERATE: visual-RTL counts 5–15 in 2+ categories")
    else:
        print("→ WEAK: visual-RTL counts <5 across all categories (rooms is primary beneficiary)")


if __name__ == "__main__":
    main()
