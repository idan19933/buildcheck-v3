"""
hints.py
========

Hint dataclass + categorical scoring system for the spatial reasoning layer.

Architecture
------------
Each hygiene helper emits zero or more `Hint` objects. A hint is a bounded
piece of evidence about a single hypothesis (e.g. "polygon:X:is_room:kitchen")
with a `strength` ∈ [0,1], a `category` (positional / geometric / semantic /
statistical / structural), and a `supports` flag (True = supporting,
False = contradicting).

`rank_hypotheses(hints)` aggregates all hints by hypothesis and produces a
ranked list of `ScoredHypothesis` objects. The scoring formula prefers
hypotheses with diverse supporting evidence (different categories) over a
single category piling on, and penalizes contradicting evidence linearly.

Categories — what they each mean
--------------------------------
  POSITIONAL   — text-inside-polygon, text-near-polygon, point coincidence
  GEOMETRIC    — bbox overlap, aspect ratio, edge length
  SEMANTIC     — vocabulary match, label resolution
  STATISTICAL  — area prior, frequency prior, dimension chain
  STRUCTURAL   — containment, adjacency, sheet membership
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


class HintCategory(str, Enum):
    POSITIONAL = "positional"
    GEOMETRIC = "geometric"
    SEMANTIC = "semantic"
    STATISTICAL = "statistical"
    STRUCTURAL = "structural"


@dataclass
class Hint:
    """One bounded piece of evidence about one hypothesis."""
    hint_type: str           # e.g. "text_inside_polygon"
    category: HintCategory
    hypothesis: str          # e.g. "polygon:e123:is_room:kitchen"
    supports: bool           # True = supporting, False = contradicting
    strength: float          # 0.0 — 1.0
    evidence: str            # human-readable explanation
    source_entities: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["category"] = self.category.value
        return d


@dataclass
class ScoredHypothesis:
    """Aggregated score for one hypothesis across all its hints."""
    hypothesis: str
    confidence: float              # 0.0 — 1.0
    supporting: list[Hint]
    contradicting: list[Hint]
    category_breakdown: dict[str, float]   # per-category contribution to score

    def to_dict(self) -> dict[str, Any]:
        return {
            "hypothesis": self.hypothesis,
            "confidence": round(self.confidence, 3),
            "category_breakdown": {k: round(v, 3) for k, v in self.category_breakdown.items()},
            "supporting": [h.to_dict() for h in self.supporting],
            "contradicting": [h.to_dict() for h in self.contradicting],
        }

    def explanation(self) -> str:
        """Human-readable audit trail."""
        lines = [
            f"Hypothesis: {self.hypothesis}",
            f"Confidence: {self.confidence:.3f}",
            f"Categories: {', '.join(f'{k}={v:.2f}' for k, v in self.category_breakdown.items())}",
        ]
        if self.supporting:
            lines.append(f"Supporting evidence ({len(self.supporting)}):")
            for h in sorted(self.supporting, key=lambda x: -x.strength):
                lines.append(f"  ✓ [{h.category.value}] {h.evidence} (strength {h.strength:.2f})")
        if self.contradicting:
            lines.append(f"Contradicting evidence ({len(self.contradicting)}):")
            for h in sorted(self.contradicting, key=lambda x: -x.strength):
                lines.append(f"  ✗ [{h.category.value}] {h.evidence} (strength {h.strength:.2f})")
        return "\n".join(lines)


# ─────────────────────────────────────────────────────── scoring

def score_hypothesis(hints: list[Hint]) -> ScoredHypothesis:
    """Aggregate one hypothesis's hints into a ScoredHypothesis.

    Rules:
      - Within a single category, the supporting hint with the highest strength
        wins (categorical max), but additional supporting hints add a small
        bonus (×0.15 of their strength) for redundancy.
      - Diverse categories all stack additively (multi-modal evidence is the
        strongest signal that we got the answer right).
      - Contradicting evidence subtracts the supporting category-max
        proportionally to its own strength.
      - Final confidence is squashed into [0, 1] via a soft cap.
    """
    if not hints:
        return ScoredHypothesis(
            hypothesis="", confidence=0.0,
            supporting=[], contradicting=[], category_breakdown={},
        )
    hypothesis = hints[0].hypothesis
    supporting = [h for h in hints if h.supports]
    contradicting = [h for h in hints if not h.supports]

    # Category-keyed contribution to score
    by_cat: dict[HintCategory, list[Hint]] = defaultdict(list)
    for h in supporting:
        by_cat[h.category].append(h)

    category_breakdown: dict[str, float] = {}
    base_score = 0.0
    for cat, lst in by_cat.items():
        max_strength = max(h.strength for h in lst)
        # Each additional hint in the same category adds a smaller bonus
        bonus = sum(h.strength for h in lst) - max_strength
        cat_score = max_strength + bonus * 0.15
        category_breakdown[cat.value] = cat_score
        base_score += cat_score

    # Subtract contradictions
    penalty = 0.0
    for h in contradicting:
        # If we have ANY support in any category, contradicting hints chip away
        penalty += h.strength * 0.5
    category_breakdown["contradiction_penalty"] = -penalty

    raw = base_score - penalty
    # Soft cap into [0, 1]: smooth-ish saturation
    if raw <= 0:
        confidence = 0.0
    elif raw >= 2.0:
        confidence = 0.99
    else:
        # Map [0, 2] → [0, 0.99] with mild diminishing returns
        confidence = min(0.99, raw / 2.0 + (raw / 2.0) * (1 - raw / 2.0) * 0.4)

    return ScoredHypothesis(
        hypothesis=hypothesis,
        confidence=confidence,
        supporting=supporting,
        contradicting=contradicting,
        category_breakdown=category_breakdown,
    )


def rank_hypotheses(hints: list[Hint]) -> list[ScoredHypothesis]:
    """Group all hints by hypothesis, score each one, return sorted by
    confidence DESC."""
    by_hyp: dict[str, list[Hint]] = defaultdict(list)
    for h in hints:
        by_hyp[h.hypothesis].append(h)
    scored = [score_hypothesis(hint_list) for hint_list in by_hyp.values()]
    scored.sort(key=lambda s: -s.confidence)
    return scored
