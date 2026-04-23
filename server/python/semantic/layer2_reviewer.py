"""
Layer 2 reviewer — sends unclassified text batches to Claude and stages
suggestions for human approval. Suggestions never auto-merge into the
vocabulary; the curator CLI does that.

Designed to run as a nightly cron job over all unclassified items collected
during the day, NOT inline with each upload (Claude calls are slow + expensive).

CLI usage:
    python -m semantic.layer2_reviewer <classified_texts.json> [--max 50]

Programmatic usage:
    from semantic.layer2_reviewer import review_batch, drain_unclassified

Output:
    Appends one JSON record per suggestion to suggestions_queue.jsonl.
    Each record carries status="pending_review" until the curator approves.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

QUEUE_PATH = Path(__file__).parent / "suggestions_queue.jsonl"

PROMPT_TEMPLATE = """You are reviewing Hebrew text annotations from an Israeli
residential building permit DXF file. A deterministic classifier was unable
to match these terms to its controlled vocabulary.

For each unclassified term, suggest:
- category: one of {categories}
- If it's a variant of an existing term, give the canonical Hebrew form.
- If it's a new legitimate term, suggest a canonical English key (snake_case).
- If it's encoding garbage, irrelevant metadata, or a text fragment (the
  start of a phrase whose continuation was split into another TEXT entity),
  mark as category="noise" or "fragment".

Context:
  - Document type: {doc_type}
  - File characteristics: {file_info}

Unclassified terms (with surrounding context):
{items}

Respond with a JSON array ONLY. Each object has:
  {{"id": int, "category": str, "suggested_canonical_he": str|null,
    "suggested_key": str|null, "reasoning": str, "confidence": float}}
"""

CATEGORIES = (
    "rooms boundaries construction_elements changes sheet_labels "
    "code_references finishes dimension_modifiers noise unknown"
).split()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_fence(text: str) -> str:
    """Strip ```json fences if Claude wraps its response."""
    t = text.strip()
    if t.startswith("```"):
        # Drop opening fence (with optional language tag)
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        if t.endswith("```"):
            t = t[: -3]
    return t.strip()


def review_batch(
    unclassified_items: list[dict[str, Any]],
    context: dict[str, Any] | None = None,
    api_key: str | None = None,
    model: str = "claude-opus-4-5",
) -> list[dict[str, Any]]:
    """Send a batch of unclassified items to Claude and append suggestions
    to the local queue. Returns the parsed suggestions for inspection."""
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise RuntimeError(
            "anthropic SDK not installed — run `pip install anthropic`"
        ) from e

    context = context or {}
    items_with_context = [
        {
            "id": i,
            "text": item.get("text") or item.get("decoded") or "",
            "block": item.get("block"),
            "nearby_texts": item.get("nearby_texts", []),
        }
        for i, item in enumerate(unclassified_items)
    ]

    prompt = PROMPT_TEMPLATE.format(
        categories=", ".join(CATEGORIES),
        doc_type=context.get("doc_type", "permit_request"),
        file_info=json.dumps(context.get("file_info", {}), ensure_ascii=False),
        items=json.dumps(items_with_context, ensure_ascii=False, indent=2),
    )

    client = Anthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))
    res = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = "".join(b.text for b in res.content if getattr(b, "type", None) == "text")
    suggestions = json.loads(_strip_fence(raw))
    if not isinstance(suggestions, list):
        raise ValueError("Claude did not return a JSON array")

    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with QUEUE_PATH.open("a", encoding="utf-8") as fh:
        for s in suggestions:
            sid = s.get("id")
            if sid is None or sid >= len(unclassified_items):
                continue
            original = unclassified_items[sid]
            record = {
                "original_text": items_with_context[sid]["text"],
                "original_context": original,
                "suggestion": s,
                "model": model,
                "timestamp": _now_iso(),
                "status": "pending_review",
            }
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    return suggestions


def drain_unclassified(
    classified_path: str | Path,
    *,
    batch_size: int = 50,
    max_items: int | None = None,
    context: dict[str, Any] | None = None,
) -> int:
    """Read a classified_texts.json, batch the unclassified items, send each
    batch to Claude. Returns the total number of items reviewed."""
    records = json.loads(Path(classified_path).read_text(encoding="utf-8"))
    unclassified = [
        {"text": r["decoded"], "block": r.get("block")}
        for r in records
        if r.get("classification", {}).get("match_type") == "unclassified"
    ]
    if max_items:
        unclassified = unclassified[:max_items]

    reviewed = 0
    for i in range(0, len(unclassified), batch_size):
        batch = unclassified[i : i + batch_size]
        review_batch(batch, context=context)
        reviewed += len(batch)
    return reviewed


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("classified_path", help="Path to classified_texts.json")
    p.add_argument("--max", type=int, default=None, help="Cap items reviewed")
    p.add_argument("--batch", type=int, default=50)
    args = p.parse_args()
    n = drain_unclassified(
        args.classified_path,
        batch_size=args.batch,
        max_items=args.max,
    )
    print(f"reviewed {n} unclassified items → {QUEUE_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
