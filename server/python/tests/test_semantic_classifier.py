"""Unit tests for SemanticClassifier — covers every layer per spec checklist."""
from __future__ import annotations

import sys
from pathlib import Path

# Make `from semantic.semantic_classifier import ...` work without install
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from semantic.semantic_classifier import (  # noqa: E402
    MatchType,
    SemanticClassifier,
    _damerau_levenshtein,
    _is_noise,
    _max_edit_for,
    _mojibake_ratio,
    _normalize,
)


VOCAB_PATH = Path(__file__).resolve().parent.parent / "semantic" / "vocabulary.yaml"


@pytest.fixture(scope="module")
def clf() -> SemanticClassifier:
    return SemanticClassifier.from_yaml(VOCAB_PATH)


# ───────────────────────────────────────────── Layer 1a CANONICAL_EXACT
def test_canonical_exact_room(clf):
    r = clf.classify("מטבח")
    assert r.match_type == MatchType.CANONICAL_EXACT
    assert r.category == "rooms"
    assert r.key == "kitchen"
    assert r.confidence == 1.0


def test_canonical_exact_boundary(clf):
    r = clf.classify("קו בניין")
    assert r.match_type == MatchType.CANONICAL_EXACT
    assert r.category == "boundaries"
    assert r.key == "building_line"


# ───────────────────────────────────────────── Layer 1b ALIAS
def test_alias_room_short(clf):
    r = clf.classify("שינה")
    assert r.match_type == MatchType.ALIAS
    assert r.category == "rooms"
    assert r.key == "bedroom"
    assert r.confidence >= 0.9


def test_alias_safe_room_punctuation_variant(clf):
    """The fancy-quote and ASCII-quote forms should both alias to ממ"ד."""
    for variant in ('ממ"ד', "ממד", "ממ.ד", "ממ\u05f4ד"):
        r = clf.classify(variant)
        assert r.key == "safe_room", f"failed for {variant!r}"
        # All should be CANONICAL_EXACT or ALIAS — never UNCLASSIFIED
        assert r.match_type in (MatchType.CANONICAL_EXACT, MatchType.ALIAS)


# ───────────────────────────────────────────── Layer 1c NUMERIC_PATTERN
@pytest.mark.parametrize("text,label", [
    ("+3.05", "elevation"),
    ("-0.50", "elevation"),
    ("±0.00", "elevation"),
    ("220", "dimension"),
    ("1:100", "scale"),
    ("R=112.86", "radius"),
    ("35%", "percent"),
    ("3.5%", "percent"),
])
def test_numeric_patterns(clf, text, label):
    r = clf.classify(text)
    assert r.match_type == MatchType.NUMERIC_PATTERN
    assert r.key == label
    assert r.confidence == 1.0


# ───────────────────────────────────────────── Layer 1d NOISE
def test_noise_lone_punctuation(clf):
    for s in ("·", "—", "···", ".", "*", "[]"):
        r = clf.classify(s)
        assert r.match_type == MatchType.NOISE, f"failed for {s!r}"


def test_noise_single_char(clf):
    for s in ("א", "X", "ב"):
        r = clf.classify(s)
        assert r.match_type == MatchType.NOISE, f"failed for {s!r}"


def test_noise_surrogate_pair_orphan(clf):
    # Lone high surrogate — invalid utf-16
    r = clf.classify("\ud8ff")
    assert r.match_type == MatchType.NOISE


def test_noise_mojibake():
    # >40% non-Hebrew/non-ASCII chars should classify as noise
    s = "אÄÅç§©®"
    assert _mojibake_ratio(s) > 0.4
    assert _is_noise(s)


# ───────────────────────────────────────────── Layer 2 FUZZY (length-aware)
def test_fuzzy_5char_one_edit(clf):
    """5-char term with 1 edit should match (budget = 1)."""
    # 'מטבח' = 4 chars; budget = 0. Use a 5+ char target.
    # 'אמבטיה' = 6 chars; budget = 2. Drop one char.
    r = clf.classify("אמבטיה")
    assert r.match_type == MatchType.CANONICAL_EXACT
    r2 = clf.classify("אמטיה")  # missing 'ב'
    assert r2.match_type == MatchType.FUZZY
    assert r2.key == "bathroom_main"
    assert r2.edit_distance == 1
    assert 0.5 <= r2.confidence < 1.0


def test_short_words_never_fuzzy_match(clf):
    """Spec-required false-positive guard: words ≤3 chars must be exact-only."""
    # 'תקן' (3 chars) is *not* in the vocab as canonical, but is a substring/edit
    # away from short aliases. Must NOT match.
    r = clf.classify("תקן")
    assert r.match_type == MatchType.UNCLASSIFIED, \
        f"3-char word should be UNCLASSIFIED, got {r.match_type} → {r.canonical_he!r}"


def test_max_edit_budget():
    assert _max_edit_for(2) == 0
    assert _max_edit_for(3) == 0
    assert _max_edit_for(4) == 1
    assert _max_edit_for(5) == 1
    assert _max_edit_for(7) == 2
    assert _max_edit_for(15) == 3


# ───────────────────────────────────────────── normalization
def test_normalize_collapses_whitespace_and_quotes():
    assert _normalize("  ממ\u05f4ד  ") == 'ממ"ד'
    assert _normalize("MAṬBAḤ.") == "maṭbaḥ"  # NFKC + trailing punct strip


# ───────────────────────────────────────────── Damerau-Levenshtein
def test_damerau_levenshtein_basic():
    assert _damerau_levenshtein("kitten", "sitting", 3) == 3
    assert _damerau_levenshtein("aaaa", "bbbb", 2) == 3  # exceeds budget
    # Transposition counts as 1 (Damerau)
    assert _damerau_levenshtein("ab", "ba", 1) == 1


def test_damerau_short_circuits_at_max():
    """Out-of-budget calls should return max+1 quickly."""
    assert _damerau_levenshtein("aaaaa", "zzzzz", 1) == 2


# ───────────────────────────────────────────── No false positives at confidence ≥ 0.7
def test_no_high_confidence_noise(clf):
    # Pure mojibake should never reach high confidence in any semantic category
    for garbage in ("ÿÿÿÿ", "@#$%^&*", "...."):
        r = clf.classify(garbage)
        if r.confidence >= 0.7:
            assert r.category == "noise" or r.match_type == MatchType.NOISE


# ───────────────────────────────────────────── Vocabulary sanity
def test_vocabulary_loads_and_has_meta(clf):
    assert clf.vocabulary_version != "0.0.0"
    # Spot-check: every major category has at least one entry
    for cat in ("rooms", "boundaries", "construction_elements", "changes",
                "sheet_labels", "code_references"):
        present = any(e.category == cat for e in clf._entries)
        assert present, f"vocabulary missing category: {cat}"
