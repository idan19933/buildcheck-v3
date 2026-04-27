"""
Read-only rooms diagnostic.

Compares:
  A) Production classified_texts.json (already on disk).
  B) Fresh direct classifier run on the same DXF (bypasses the
     orchestrator but uses the SAME classifier + vocabulary the
     production pipeline uses).
  C) Substring scan for Hebrew room words.

Goal: determine if rooms_classified=1 on this file is genuine or a bug.
"""
from __future__ import annotations
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server" / "python"))

from semantic.semantic_classifier import SemanticClassifier  # noqa: E402
from semantic.decoders.pipeline import build_default_pipeline  # noqa: E402

import ezdxf  # noqa: E402

DXF_PATH = "C:/Users/idans/AppData/Local/Temp/dxfs/yatir.dxf"
VOCAB = ROOT / "server" / "python" / "semantic" / "vocabulary.yaml"
PRODUCTION = Path(__file__).parent / "production_classified.json"
OUT_DIR = Path(__file__).parent

PIPELINE = build_default_pipeline()
ROOM_WORDS = [
    "חדר", "מטבח", "אמבט", "שירות", "מרפסת", 'ממ"ד', "ממד",
    "סלון", "מקלחת", "משחקים", "הורים", "שינה", "ילדים", "כניסה",
    "ארון", "מחסן", "פינת", "אוכל",
]


def decode(s: str) -> str:
    """Match the decoder pipeline used by production."""
    return PIPELINE.decode(s or "").decoded


# ─── A) Production counts ───────────────────────────────────────────────
def production_counts() -> dict:
    raw = json.loads(PRODUCTION.read_text(encoding="utf-8"))
    records = raw["records"] if isinstance(raw, dict) else raw

    rooms_by_key: Counter[str] = Counter()
    rooms_high_conf = 0
    rooms_low_conf = 0
    noise = 0
    unclassified = 0
    for r in records:
        c = r["classification"]
        if c["match_type"] == "noise":
            noise += 1
            continue
        if c["match_type"] == "unclassified":
            unclassified += 1
            continue
        if c.get("category") == "rooms":
            if (c.get("confidence") or 0) >= 0.7:
                rooms_high_conf += 1
                rooms_by_key[c.get("key") or "unknown"] += 1
            else:
                rooms_low_conf += 1
    return {
        "total_records": len(records),
        "rooms_high_conf": rooms_high_conf,
        "rooms_low_conf": rooms_low_conf,
        "rooms_by_key_high_conf": dict(rooms_by_key),
        "noise": noise,
        "unclassified": unclassified,
    }


# ─── B) Direct classifier run ───────────────────────────────────────────
def direct_counts() -> tuple[dict, list[dict]]:
    clf = SemanticClassifier.from_yaml(VOCAB)
    doc = ezdxf.readfile(DXF_PATH)
    rooms_by_key: Counter[str] = Counter()
    rooms_high_conf = 0
    rooms_low_conf = 0
    total = 0
    classified_records: list[dict] = []
    for block in doc.blocks:
        if block.name.startswith("*Paper_Space"):
            continue
        for e in block:
            if e.dxftype() not in ("TEXT", "MTEXT"):
                continue
            try:
                raw = e.dxf.text if e.dxftype() == "TEXT" else getattr(e, "text", e.dxf.text)
                if not raw or not str(raw).strip():
                    continue
                total += 1
                decoded = decode(str(raw))
                d = clf.classify(decoded).to_dict()
                classified_records.append({"block": block.name, "raw": str(raw),
                                           "decoded": decoded, "classification": d})
                if d.get("category") == "rooms":
                    if (d.get("confidence") or 0) >= 0.7:
                        rooms_high_conf += 1
                        rooms_by_key[d.get("key") or "unknown"] += 1
                    else:
                        rooms_low_conf += 1
            except Exception:
                pass
    return {
        "total_texts": total,
        "rooms_high_conf": rooms_high_conf,
        "rooms_low_conf": rooms_low_conf,
        "rooms_by_key_high_conf": dict(rooms_by_key),
    }, classified_records


# ─── C) Substring scan ──────────────────────────────────────────────────
def substring_scan() -> tuple[int, list[dict]]:
    doc = ezdxf.readfile(DXF_PATH)
    matches: list[dict] = []
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
                hit = next((w for w in ROOM_WORDS if w in decoded), None)
                if hit:
                    matches.append({"word": hit, "decoded": decoded,
                                    "raw": str(raw), "block": block.name})
            except Exception:
                pass
    return len(matches), matches


def main() -> None:
    print("=" * 70)
    print("ROOMS DIAGNOSTIC")
    print("=" * 70)
    print(f"DXF: {DXF_PATH}")
    print(f"Vocab: {VOCAB}")
    print()

    print("--- A) Production counts (from /app/uploads/.../classified_texts.json) ---")
    prod = production_counts()
    print(json.dumps(prod, ensure_ascii=False, indent=2))
    (OUT_DIR / "production_counts.json").write_text(
        json.dumps(prod, ensure_ascii=False, indent=2), encoding="utf-8")
    print()

    print("--- B) Direct classifier run (bypassing orchestrator) ---")
    direct, records = direct_counts()
    print(json.dumps(direct, ensure_ascii=False, indent=2))
    (OUT_DIR / "direct_counts.json").write_text(
        json.dumps(direct, ensure_ascii=False, indent=2), encoding="utf-8")
    print()

    print("--- C) Substring scan for Hebrew room words (logical order) ---")
    n, samples = substring_scan()
    print(f"Total texts containing a Hebrew room substring (logical): {n}")
    show = samples[:20]
    for s in show:
        print(f"  [{s['block']}] '{s['decoded'][:60]}' (matched {s['word']!r})")
    (OUT_DIR / "miconv_room_word_samples.json").write_text(
        json.dumps(samples, ensure_ascii=False, indent=2), encoding="utf-8")
    print()

    # C2: same scan but in REVERSED character order — catches visual-RTL Hebrew
    print("--- C2) Substring scan for REVERSED room words (visual-RTL) ---")
    rev_words = [w[::-1] for w in ROOM_WORDS]
    rev_matches: list[dict] = []
    doc = ezdxf.readfile(DXF_PATH)
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
                hit = next((rw for rw in rev_words if rw in decoded), None)
                if hit:
                    rev_matches.append({"reversed_word": hit, "logical_word": hit[::-1],
                                        "decoded": decoded, "block": block.name})
            except Exception:
                pass
    print(f"Total texts containing a REVERSED room substring: {len(rev_matches)}")
    for s in rev_matches[:15]:
        print(f"  [{s['block']}] '{s['decoded'][:60]}' (matched reversed {s['logical_word']!r})")
    def _scrub(s: str) -> str:
        return s.encode("utf-8", "replace").decode("utf-8") if isinstance(s, str) else s
    cleaned = [{k: _scrub(v) if isinstance(v, str) else v for k, v in s.items()} for s in rev_matches]
    (OUT_DIR / "miconv_reversed_room_word_samples.json").write_text(
        json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8")
    print()

    # Verdict heuristics
    print("--- Verdict ---")
    diff = direct["rooms_high_conf"] - prod["rooms_high_conf"]
    print(f"Production rooms (high-conf): {prod['rooms_high_conf']}")
    print(f"Direct      rooms (high-conf): {direct['rooms_high_conf']}")
    print(f"Substring matches:             {n}")
    if abs(diff) <= 1:
        if n > prod["rooms_high_conf"] * 5:
            print("→ Pattern D (vocabulary or matching gap) — substring matches >> classified rooms")
        else:
            print("→ Pattern A (no bug) — production and direct agree; file genuinely lacks room labels")
    elif diff > 0:
        print("→ Pattern B (production suppressing) — direct produces more rooms than production")
    else:
        print("→ unexpected — production has MORE rooms than direct")


if __name__ == "__main__":
    main()
