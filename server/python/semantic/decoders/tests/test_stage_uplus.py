"""Unit tests for the \\U+XXXX expansion stage."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from semantic.decoders.stage_uplus_escape import stage  # noqa: E402


def test_detect_finds_escape_sequences():
    assert stage.detect(r"\U+05E7\U+05D5")
    assert not stage.detect("plain ascii")
    assert not stage.detect("מטבח")  # already-decoded Hebrew, no escapes


def test_transform_decodes_hebrew():
    raw = r"\U+05E7\U+05D5 \U+05D1\U+05E0\U+05D9\U+05D9\U+05DF"
    assert stage.transform(raw) == "קו בניין"


def test_transform_preserves_non_escape_text():
    raw = r"VIEWPORT19 \U+05DE\U+05D8\U+05D1\U+05D7 abc"
    assert stage.transform(raw) == "VIEWPORT19 מטבח abc"


def test_malformed_escape_left_alone():
    """Not a valid \\U+XXXX shape (only 3 hex digits) — should not transform."""
    assert stage.transform(r"\U+ABC") == r"\U+ABC"


def test_lowercase_hex_handled():
    assert stage.transform(r"\U+05e7") == "ק"


def test_empty_string_safe():
    assert not stage.detect("")
    assert stage.transform("") == ""
