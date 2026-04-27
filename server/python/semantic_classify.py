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
import os
import re
import sys
from pathlib import Path

import ezdxf

# Allow `from semantic.semantic_classifier import ...` when run from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from semantic.semantic_classifier import SemanticClassifier  # noqa: E402
from semantic.decoders.pipeline import (  # noqa: E402
    DecoderPipeline,
    build_default_pipeline,
)
from semantic.decoders.stage_uplus_escape import stage as _uplus_only_stage  # noqa: E402

# Experiment knob: if USE_DECODER_PIPELINE is "false", run only the
# uplus_escape stage (the pre-CP862 baseline). Default = full pipeline.
_USE_FULL = os.environ.get("USE_DECODER_PIPELINE", "true").lower() != "false"
_PIPELINE = (
    build_default_pipeline()
    if _USE_FULL
    else DecoderPipeline(stages=[_uplus_only_stage])
)


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
    """Decode raw DXF text via the encoding pipeline + surrogate scrub.

    Surrogate scrubbing is input sanitisation (malformed UTF-16 repair),
    not a decoding choice — kept outside the pipeline. The pipeline
    handles the real encoding variants (\\U+XXXX, CP1255, …).
    """
    return _scrub_surrogates(_PIPELINE.decode(s or "").decoded)


def decode_hebrew_with_trace(s: str):
    """Variant returning the full DecodeResult + scrubbed final string.

    Used by the per-text loop to count which stages fired across the corpus.
    """
    result = _PIPELINE.decode(s or "")
    result.decoded = _scrub_surrogates(result.decoded)
    return result


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
    """Yield every TEXT/MTEXT in the file with its block + position context.

    Each yielded record carries `_stages_applied` (list of stage names that
    transformed this text) so the caller can aggregate decoder hit counts.
    """
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
                trace = decode_hebrew_with_trace(str(raw))
                yield {
                    "block": block.name,
                    "raw": str(raw),
                    "decoded": trace.decoded,
                    "position": {"x": float(pos[0]), "y": float(pos[1])},
                    "height": float(getattr(e.dxf, "height", 0) or 0),
                    "layer": getattr(e.dxf, "layer", "0"),
                    "_stages_applied": trace.stages_applied,
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

    decoder_stage_hits: dict[str, int] = {n: 0 for n in _PIPELINE.stage_names()}
    records: list[dict] = []
    for item in extract_text_entities(doc):
        for stage_name in item.pop("_stages_applied", []):
            decoder_stage_hits[stage_name] = decoder_stage_hits.get(stage_name, 0) + 1
        result = clf.classify(item["decoded"])
        records.append({**item, "classification": result.to_dict()})

    cleaned = _clean_for_json(records)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    # Output schema (stable): records[] is the per-text array the
    # orchestrator already consumes; decoder_stage_hits is a sibling
    # object with per-stage hit counts. Older readers that expect a
    # bare array can fall back via JSON shape detection.
    Path(out_path).write_text(
        json.dumps(
            {"records": cleaned, "decoder_stage_hits": decoder_stage_hits},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )

    summary = {
        "total": len(records),
        "vocabulary_version": clf.vocabulary_version,
        "by_match_type": {},
        "by_category": {},
        "unclassified_count": 0,
        "high_confidence_semantic_count": 0,
        "decoder_stage_hits": decoder_stage_hits,
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
