#!/usr/bin/env python3
"""
semantic_classify.py — classify every TEXT/MTEXT in a DXF using the
three-layer SemanticClassifier.

Output:
  - Writes a JSON file with per-entity records to argv[2].
  - Prints a summary JSON object to stdout (consumed by the Node.js caller).

Each output record has: block, raw, decoded, position {x,y}, height, layer,
classification {category, key, canonical_he, confidence, match_type, ...}.

Usage:
    python3 semantic_classify.py <input.dxf> <output.json>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import ezdxf

# Allow `from semantic.semantic_classifier import ...` when run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from semantic.semantic_classifier import SemanticClassifier  # noqa: E402


_UNICODE_ESCAPE_RE = re.compile(r"\\U\+([0-9A-Fa-f]{4})")


def _scrub_surrogates(s: str) -> str:
    """Drop lone UTF-16 surrogates and combine matched pairs."""
    if not s:
        return ""
    out, i, n = [], 0, len(s)
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


def decode_hebrew(s: str) -> str:
    """Decode AutoCAD \\U+XXXX escapes to Hebrew + scrub broken surrogates."""
    return _scrub_surrogates(_UNICODE_ESCAPE_RE.sub(
        lambda m: chr(int(m.group(1), 16)), s or ""
    ))


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
                    if any("\u0590" <= c <= "\u05FF" for c in decode_hebrew(raw)):
                        return True
                except Exception:
                    pass
                checked += 1
    return False


def _load_dxf(path: str):
    """Try Hebrew encodings if the default doesn't yield Hebrew text."""
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


def extract_text_entities(doc):
    """Yield every TEXT/MTEXT in the file with its block + position context."""
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
                pos = e.dxf.insert
                yield {
                    "block": block.name,
                    "raw": str(raw),
                    "decoded": decode_hebrew(str(raw)),
                    "position": {"x": float(pos[0]), "y": float(pos[1])},
                    "height": float(getattr(e.dxf, "height", 0) or 0),
                    "layer": getattr(e.dxf, "layer", "0"),
                }
            except Exception:
                continue


def _clean_for_json(x):
    """Recursively strip lone surrogates so json.dumps doesn't choke."""
    if isinstance(x, str):
        return _scrub_surrogates(x)
    if isinstance(x, list):
        return [_clean_for_json(v) for v in x]
    if isinstance(x, dict):
        return {k: _clean_for_json(v) for k, v in x.items()}
    return x


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: semantic_classify.py <input.dxf> <output.json>", file=sys.stderr)
        return 1

    dxf_path, out_path = sys.argv[1], sys.argv[2]

    vocab_path = Path(__file__).resolve().parent / "semantic" / "vocabulary.yaml"
    clf = SemanticClassifier.from_yaml(vocab_path)

    try:
        doc = _load_dxf(dxf_path)
    except Exception as e:
        print(json.dumps({"error": f"readfile failed: {e}"}))
        return 1

    records: list[dict] = []
    for item in extract_text_entities(doc):
        result = clf.classify(item["decoded"])
        records.append({**item, "classification": result.to_dict()})

    cleaned = _clean_for_json(records)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(
        json.dumps(cleaned, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = {
        "total": len(records),
        "vocabulary_version": clf.vocabulary_version,
        "by_match_type": {},
        "by_category": {},
        "unclassified_count": 0,
        "high_confidence_semantic_count": 0,
    }
    for r in records:
        c = r["classification"]
        mt = c["match_type"]
        cat = c.get("category") or "unknown"
        summary["by_match_type"][mt] = summary["by_match_type"].get(mt, 0) + 1
        summary["by_category"][cat] = summary["by_category"].get(cat, 0) + 1
        if mt == "unclassified":
            summary["unclassified_count"] += 1
        if c.get("confidence", 0) >= 0.7 and cat in (
            "rooms", "boundaries", "construction_elements", "changes",
            "sheet_labels", "code_references", "finishes",
        ):
            summary["high_confidence_semantic_count"] += 1

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
