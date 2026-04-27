"""Unit tests for the CP1255 → Hebrew remap stage."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from semantic.decoders.stage_cp1255_remap import stage  # noqa: E402


def test_detect_triggers_on_cp1255_pattern():
    # 4 high-byte chars, no real Hebrew → trigger.
    s = "\u00E7\u00E5 \u00D1\u00E0"
    assert stage.detect(s)


def test_detect_skips_if_real_hebrew_present():
    # Already has Hebrew in the proper block → don't re-encode.
    s = "\u00E7\u00E5 קו"
    assert not stage.detect(s)


def test_detect_skips_on_single_high_byte():
    # Only 1 high-byte char — likely incidental, not an encoding marker.
    s = "hello\u00E9world"
    assert not stage.detect(s)


def test_detect_skips_pure_ascii():
    assert not stage.detect("hello world")
    assert not stage.detect("VIEWPORT19")
    assert not stage.detect("")


def test_transform_recovers_hebrew_letters():
    # CP1255 mapping: 0xE7 → ח (U+05D7), 0xE5 → ו (U+05D5)
    s = "\u00E7\u00E5"
    result = stage.transform(s)
    assert "ח" in result
    assert "ו" in result


def test_transform_preserves_ascii():
    s = "abc\u00E7\u00E5def"
    result = stage.transform(s)
    assert result.startswith("abc")
    assert result.endswith("def")


def test_regression_sample_from_production():
    """The exact noise pattern the diagnostic pulled from analysis a414d098.

    VIEWPORT1 noise bucket contained CP1255 bytes that came through as
    U+0080–U+009A control codepoints. Note: chars in the 0x80–0x9F C1
    control range are undefined in CP1255 and won't map to Hebrew —
    but the production samples mixed them with mappable bytes (e.g. 0xE7).
    Verify the stage detects on the high-byte density and recovers what
    it can without crashing.
    """
    raw = "\u009A\u0085\u0098\u0083\u0082 .\u0084 \u00E7\u00E5"
    assert stage.detect(raw)
    result = stage.transform(raw)
    # The CP1255-mappable suffix must recover Hebrew.
    assert any(0x0590 <= ord(c) <= 0x05FF for c in result), \
        f"Expected at least one Hebrew codepoint in {result!r}"


def test_unmappable_cp1255_bytes_left_alone():
    """0xCA is undefined in CP1255 — must not crash, must not mangle other chars."""
    s = "\u00CA\u00E7\u00E7"
    result = stage.transform(s)
    # 0xE7 → ח; should appear twice even though 0xCA is undefined.
    assert result.count("ח") == 2


def test_full_word_recovery():
    """CP1255 0xF7 0xE5 = קו (kav, the Hebrew word for 'line')."""
    s = "\u00F7\u00E5"
    result = stage.transform(s)
    assert result == "קו"
