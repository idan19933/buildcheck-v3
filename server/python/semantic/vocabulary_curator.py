"""
vocabulary_curator.py — interactive CLI for promoting Claude's
Layer 2 suggestions into vocabulary.yaml.

Usage:
    python -m semantic.vocabulary_curator [--queue path] [--vocab path]

Walks pending_review entries in suggestions_queue.jsonl. Per entry:
  [a]pprove — merge into vocabulary.yaml as new alias under suggested key,
              or as a new entry if no canonical exists yet
  [r]eject  — mark rejected; never shown again
  [m]odify  — edit Claude's suggestion before merging
  [s]kip    — leave pending; come back later
  [q]uit    — save state and exit

State changes are written immediately back to the queue file (atomic-ish
write to a .tmp then rename). On approve, vocabulary.yaml's meta.version
is bumped (patch) and meta.updated_at is set to today.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any

import yaml

QUEUE_PATH_DEFAULT = Path(__file__).parent / "suggestions_queue.jsonl"
VOCAB_PATH_DEFAULT = Path(__file__).parent / "vocabulary.yaml"

VALID_CATEGORIES = (
    "rooms boundaries construction_elements changes sheet_labels "
    "code_references finishes dimension_modifiers noise"
).split()


def _bump_version(v: str) -> str:
    parts = v.split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[-1] = str(int(parts[-1]) + 1)
    except ValueError:
        parts[-1] = "1"
    return ".".join(parts[:3])


def _read_queue(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _write_queue(path: Path, records: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def _read_vocab(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _write_vocab(path: Path, vocab: dict[str, Any]) -> None:
    # Bump + timestamp meta
    meta = vocab.setdefault("meta", {})
    meta["version"] = _bump_version(str(meta.get("version", "1.0.0")))
    meta["updated_at"] = date.today().isoformat()
    path.write_text(
        yaml.safe_dump(vocab, allow_unicode=True, sort_keys=False, indent=2),
        encoding="utf-8",
    )


def _find_entry(vocab: dict, category: str, key: str) -> dict | None:
    for row in vocab.get(category) or []:
        if row.get("key") == key:
            return row
    return None


def _apply_suggestion(vocab: dict, sug: dict[str, Any], original_text: str) -> str:
    """Merge a suggestion into the vocab dict (in-place). Returns a status
    string suitable for printing back to the user."""
    cat = sug.get("category")
    key = sug.get("suggested_key")
    canonical = sug.get("suggested_canonical_he") or original_text

    if cat not in VALID_CATEGORIES:
        return f"skipped — invalid category {cat!r}"
    if cat == "noise":
        # Add a noise alias so future identical text shorts to NOISE
        rows = vocab.setdefault("noise", [])
        if not rows:
            rows.append({"key": "fragment", "canonical_he": "", "aliases": []})
        rows[0].setdefault("aliases", []).append(original_text)
        return "merged → noise"

    if not key:
        return "skipped — no suggested_key"

    existing = _find_entry(vocab, cat, key)
    if existing:
        existing.setdefault("aliases", []).append(original_text)
        return f"merged → {cat}/{key} (alias added)"

    # New canonical entry
    vocab.setdefault(cat, []).append({
        "key": key,
        "canonical_he": canonical,
        "aliases": [original_text] if original_text != canonical else [],
    })
    return f"merged → {cat}/{key} (new entry)"


def _prompt(prompt: str) -> str:
    try:
        return input(prompt).strip().lower()
    except (EOFError, KeyboardInterrupt):
        return "q"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--queue", type=Path, default=QUEUE_PATH_DEFAULT)
    p.add_argument("--vocab", type=Path, default=VOCAB_PATH_DEFAULT)
    args = p.parse_args()

    records = _read_queue(args.queue)
    vocab = _read_vocab(args.vocab)
    pending = [(i, r) for i, r in enumerate(records) if r.get("status") == "pending_review"]
    if not pending:
        print("No pending suggestions to review.")
        return 0
    print(f"{len(pending)} pending suggestion(s) — review begins.\n")

    dirty_vocab = False
    for shown, (idx, rec) in enumerate(pending, 1):
        sug = rec.get("suggestion", {}) or {}
        text = rec.get("original_text", "")
        ctx = rec.get("original_context", {}) or {}

        print("─" * 64)
        print(f"  [{shown}/{len(pending)}]  {text!r}")
        print(f"    block:    {ctx.get('block', '—')}")
        print(f"    category: {sug.get('category')!r}")
        print(f"    canonical: {sug.get('suggested_canonical_he')!r}")
        print(f"    key:      {sug.get('suggested_key')!r}")
        print(f"    confidence: {sug.get('confidence')}")
        print(f"    reasoning: {sug.get('reasoning', '')[:140]}")
        ans = _prompt("\n  [a]pprove / [r]eject / [m]odify / [s]kip / [q]uit > ")
        if ans == "q":
            break
        if ans == "s":
            continue
        if ans == "r":
            records[idx]["status"] = "rejected"
            continue
        if ans == "m":
            new_cat = _prompt(f"  category [{sug.get('category')}]: ") or sug.get("category")
            new_key = _prompt(f"  key [{sug.get('suggested_key')}]: ") or sug.get("suggested_key")
            new_can = _prompt(f"  canonical_he [{sug.get('suggested_canonical_he')}]: ") or sug.get("suggested_canonical_he")
            sug = {**sug, "category": new_cat, "suggested_key": new_key, "suggested_canonical_he": new_can}
        # approve / modify both fall through to merge
        status = _apply_suggestion(vocab, sug, text)
        print(f"  → {status}")
        records[idx]["status"] = "approved"
        records[idx]["applied_suggestion"] = sug
        dirty_vocab = True

    # Always persist the queue (state changes either way)
    _write_queue(args.queue, records)
    if dirty_vocab:
        _write_vocab(args.vocab, vocab)
        print(f"\n✓ vocabulary.yaml updated → version {vocab['meta']['version']}")
    else:
        print("\n(no vocabulary changes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
