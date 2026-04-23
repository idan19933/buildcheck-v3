"""
SemanticClassifier — three-layer text classifier for Hebrew DXF annotations.

Layers (per the spec):
  1a CANONICAL_EXACT  — exact match against `canonical_he` field.
  1b ALIAS            — exact match against any `aliases` entry.
  1c NUMERIC_PATTERN  — pure dimension/elevation/scale/radius numbers.
  1d NOISE            — mojibake, lone punctuation, single-letter fragments.
   2 FUZZY            — Levenshtein/Damerau distance ≤ length-aware budget.
   ∅ UNCLASSIFIED     — fallback; eligible for Layer 2 (Claude) review.

Returns a `ClassificationResult` carrying confidence + match_type so downstream
code can decide whether to trust the label.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any

import yaml


# ────────────────────────────────────────────── enums + result type ──

class MatchType(str, Enum):
    CANONICAL_EXACT = "canonical_exact"
    ALIAS = "alias"
    NUMERIC_PATTERN = "numeric_pattern"
    NOISE = "noise"
    FUZZY = "fuzzy"
    UNCLASSIFIED = "unclassified"


@dataclass
class ClassificationResult:
    text: str                        # original input (post-decode, pre-normalize)
    match_type: MatchType
    category: str | None = None      # e.g. "rooms", "boundaries", "noise"
    key: str | None = None           # canonical English key, e.g. "kitchen"
    canonical_he: str | None = None  # canonical Hebrew form, e.g. "מטבח"
    confidence: float = 0.0          # 0.0 – 1.0
    matched_alias: str | None = None # which alias hit (for ALIAS / FUZZY)
    edit_distance: int | None = None # for FUZZY only

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["match_type"] = self.match_type.value
        return d


# ────────────────────────────────────────────── numeric patterns ──
# Order matters — most specific first.
_NUMERIC_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("scale",       re.compile(r"^\s*1\s*:\s*\d+\s*$")),
    ("radius",      re.compile(r"^\s*R\s*=\s*\d+(?:\.\d+)?\s*$", re.I)),
    ("percent",     re.compile(r"^\s*\d+(?:\.\d+)?\s*%\s*$")),
    ("elevation",   re.compile(r"^\s*[+\-±]\s*\d+(?:\.\d+)?\s*$")),
    ("ground_zero", re.compile(r"^\s*[±+\-]?\s*0\.00\s*$")),
    ("dimension",   re.compile(r"^\s*\d+(?:\.\d+)?\s*$")),
    ("dim_pair",    re.compile(r"^\s*\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?\s*$")),
    ("eq_value",    re.compile(r"^\s*\d+(?:\.\d+)?\s*=\s*\d+(?:\.\d+)?\s*$")),
]


def _classify_numeric(s: str) -> str | None:
    for label, rx in _NUMERIC_PATTERNS:
        if rx.match(s):
            return label
    return None


# ────────────────────────────────────────────── noise detection ──

_HEBREW_RANGE = (0x0590, 0x05FF)
_LATIN_RANGE = (0x0020, 0x007E)
_PUNCT_ONLY = re.compile(r"^[\s\.\,\:\;\-\_\=\*\#\@\!\?\"\'\\/\(\)\[\]\{\}<>·•—\|]+$")


def _has_surrogate(s: str) -> bool:
    return any(0xD800 <= ord(c) <= 0xDFFF for c in s)


def _mojibake_ratio(s: str) -> float:
    """Heuristic: portion of chars that are neither Hebrew, ASCII printable,
    common digits/punct, nor whitespace. >0.4 strongly suggests garbage."""
    if not s:
        return 0.0
    bad = 0
    for c in s:
        o = ord(c)
        if _HEBREW_RANGE[0] <= o <= _HEBREW_RANGE[1]:
            continue
        if _LATIN_RANGE[0] <= o <= _LATIN_RANGE[1]:
            continue
        if c in "\n\r\t\u00A0":
            continue
        # Common Hebrew punctuation
        if c in "״׳":
            continue
        bad += 1
    return bad / len(s)


def _is_noise(s: str) -> bool:
    """True if string clearly carries no semantic content."""
    if not s or not s.strip():
        return True
    if _has_surrogate(s):
        return True
    if _PUNCT_ONLY.match(s):
        return True
    # Single Hebrew/Latin char alone is almost always a fragment marker.
    stripped = s.strip()
    if len(stripped) == 1 and (stripped.isalpha() or stripped in "@#$"):
        return True
    if _mojibake_ratio(stripped) > 0.4:
        return True
    return False


# ────────────────────────────────────────────── normalization ──

# Hebrew "geresh"/"gershayim" punctuation styles vary across architects.
# Normalize them (and similar ASCII apostrophes) to a single canonical form
# so 'ממ"ד' / 'ממ״ד' / 'ממד' all collapse into one comparable shape.
_NORM_TRANSLATE = {
    ord("\u05F3"): "'",   # ׳ Hebrew geresh → ASCII '
    ord("\u05F4"): '"',   # ״ Hebrew gershayim → ASCII "
    ord("\u2019"): "'",   # ’ right single quote
    ord("\u201D"): '"',   # ” right double quote
    ord("\u2032"): "'",   # ′ prime
    ord("\u2033"): '"',   # ″ double prime
}


def _normalize(s: str) -> str:
    """Lowercase + strip + collapse whitespace + canonicalize punctuation.
    Hebrew has no case so .lower() only affects mixed-Latin, which is fine."""
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(_NORM_TRANSLATE)
    s = re.sub(r"\s+", " ", s).strip().lower()
    # Strip a *trailing* punctuation run (very common at line endings)
    s = re.sub(r"[\.,;:]+$", "", s).strip()
    return s


# ────────────────────────────────────────────── fuzzy distance ──

def _damerau_levenshtein(a: str, b: str, max_dist: int) -> int:
    """Returns the edit distance between a and b, capped at max_dist+1.
    Pure Python — small inputs only (Hebrew DXF terms rarely exceed 30 chars).
    Returns max_dist+1 as a sentinel if exceeded; lets callers short-circuit."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if abs(la - lb) > max_dist:
        return max_dist + 1
    # Single row + previous distance trick (Wagner-Fischer with diagonal track)
    prev_prev = list(range(lb + 1))
    prev = [0] * (lb + 1)
    cur = [0] * (lb + 1)
    for i in range(1, la + 1):
        prev, cur = cur, prev
        cur[0] = i
        row_min = cur[0]
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            cur[j] = min(
                prev[j] + 1,        # deletion
                cur[j - 1] + 1,     # insertion
                prev[j - 1] + cost, # substitution
            )
            # Damerau transposition
            if (i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]):
                cur[j] = min(cur[j], prev_prev[j - 2] + 1)
            row_min = min(row_min, cur[j])
        if row_min > max_dist:
            return max_dist + 1
        prev_prev = prev[:]
    return cur[lb]


def _max_edit_for(length: int) -> int:
    """Length-aware edit budget. Short words MUST be exact — too many false
    positives at len ≤ 3 (e.g. 'תקן' → 'ש.נ' would otherwise match)."""
    if length <= 3: return 0
    if length <= 5: return 1
    if length <= 9: return 2
    return 3


# ────────────────────────────────────────────── classifier ──

@dataclass
class _Entry:
    """One vocabulary row, normalized for fast lookup."""
    category: str
    key: str
    canonical_he: str
    aliases: list[str]
    canonical_norm: str
    aliases_norm: list[str]


class SemanticClassifier:
    """Classifies Hebrew text annotations against a controlled vocabulary."""

    def __init__(self, entries: list[_Entry], meta: dict[str, Any] | None = None):
        self._entries = entries
        self._meta = meta or {}
        # Build O(1) reverse maps
        self._canonical_index: dict[str, _Entry] = {}
        self._alias_index: dict[str, _Entry] = {}
        for e in entries:
            self._canonical_index[e.canonical_norm] = e
            for a in e.aliases_norm:
                self._alias_index.setdefault(a, e)

    # ── construction
    @classmethod
    def from_yaml(cls, path: str | Path) -> "SemanticClassifier":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        meta = data.get("meta", {}) if isinstance(data, dict) else {}
        entries: list[_Entry] = []
        for cat_name, rows in (data or {}).items():
            if cat_name == "meta" or not isinstance(rows, list):
                continue
            for row in rows:
                key = row.get("key", "")
                canonical = row.get("canonical_he", "") or ""
                aliases = list(row.get("aliases", []) or [])
                # Skip empty / malformed entries silently
                if not key:
                    continue
                entries.append(_Entry(
                    category=cat_name,
                    key=key,
                    canonical_he=canonical,
                    aliases=aliases,
                    canonical_norm=_normalize(canonical),
                    aliases_norm=[_normalize(a) for a in aliases if a],
                ))
        return cls(entries, meta)

    @property
    def vocabulary_version(self) -> str:
        return self._meta.get("version", "0.0.0")

    # ── classification
    def classify(self, text: str) -> ClassificationResult:
        # Layer 1d FAST PATH: noise (handles empty, surrogate, mojibake, lone punct)
        if _is_noise(text):
            return ClassificationResult(
                text=text, match_type=MatchType.NOISE,
                category="noise", confidence=1.0,
            )

        norm = _normalize(text)
        if not norm:
            return ClassificationResult(
                text=text, match_type=MatchType.NOISE,
                category="noise", confidence=1.0,
            )

        # Layer 1c NUMERIC_PATTERN — short-circuit before fuzzy
        nlabel = _classify_numeric(norm)
        if nlabel:
            return ClassificationResult(
                text=text, match_type=MatchType.NUMERIC_PATTERN,
                category="numeric", key=nlabel, confidence=1.0,
            )

        # Layer 1a CANONICAL_EXACT
        e = self._canonical_index.get(norm)
        if e is not None:
            return ClassificationResult(
                text=text, match_type=MatchType.CANONICAL_EXACT,
                category=e.category, key=e.key,
                canonical_he=e.canonical_he, confidence=1.0,
            )

        # Layer 1b ALIAS
        e = self._alias_index.get(norm)
        if e is not None:
            return ClassificationResult(
                text=text, match_type=MatchType.ALIAS,
                category=e.category, key=e.key,
                canonical_he=e.canonical_he, confidence=0.95,
                matched_alias=norm,
            )

        # Layer 2 FUZZY (length-aware)
        max_d = _max_edit_for(len(norm))
        if max_d == 0:
            return ClassificationResult(
                text=text, match_type=MatchType.UNCLASSIFIED, confidence=0.0,
            )

        best: tuple[int, _Entry, str] | None = None  # (distance, entry, matched_term)
        for entry in self._entries:
            for term, _is_canonical in (
                (entry.canonical_norm, True),
                *((a, False) for a in entry.aliases_norm),
            ):
                d = _damerau_levenshtein(norm, term, max_d)
                if d > max_d:
                    continue
                if best is None or d < best[0]:
                    best = (d, entry, term)
                    if d == 0:
                        break
            if best is not None and best[0] == 0:
                break

        if best is None:
            return ClassificationResult(
                text=text, match_type=MatchType.UNCLASSIFIED, confidence=0.0,
            )

        d, entry, matched = best
        # Confidence decays with edit distance & rises with length (longer
        # matches at the same distance are far more trustworthy).
        denom = max(len(norm), 1)
        confidence = max(0.5, 1.0 - (d / denom) - 0.05)
        return ClassificationResult(
            text=text, match_type=MatchType.FUZZY,
            category=entry.category, key=entry.key,
            canonical_he=entry.canonical_he,
            confidence=round(confidence, 3),
            matched_alias=matched, edit_distance=d,
        )
