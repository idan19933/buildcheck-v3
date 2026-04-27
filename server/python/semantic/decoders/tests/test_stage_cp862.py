"""Unit tests for the CP862 (DOS-Hebrew) → Hebrew remap stage."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from semantic.decoders.stage_cp862_remap import stage  # noqa: E402


def test_detect_triggers_on_cp862_pattern():
    # 4 chars in the CP862 Hebrew band 0x80–0x9A → trigger.
    s = "\u0097\u0085 \u0089\u0098"  # 0x97=ק, 0x85=ו, 0x89=י, 0x98=ר
    assert stage.detect(s)


def test_detect_skips_if_real_hebrew_present():
    # Already has Hebrew → skip.
    s = "\u0097\u0085 קו"
    assert not stage.detect(s)


def test_detect_skips_on_single_band_byte():
    # Only 1 char in band — incidental noise, not an encoding marker.
    s = "hello\u0080world"
    assert not stage.detect(s)


def test_detect_skips_pure_ascii():
    assert not stage.detect("hello world")
    assert not stage.detect("VIEWPORT19")
    assert not stage.detect("")


def test_detect_skips_pure_cp1255_range():
    # Bytes 0xE0–0xFA are CP1255's Hebrew range, NOT CP862's.
    # CP862 detector must NOT claim these — let cp1255_remap handle them.
    s = "\u00E7\u00E5\u00E0"
    assert not stage.detect(s)


def test_transform_recovers_full_word():
    # CP862 0x97 = ק, 0x85 = ו → קו (the Hebrew word for "line")
    s = "\u0097\u0085"
    assert stage.transform(s) == "קו"


def test_transform_recovers_room_label():
    # "חדר" (room) = ח+ד+ר = 0x87 0x83 0x98
    s = "\u0087\u0083\u0098"
    assert stage.transform(s) == "חדר"


def test_transform_preserves_ascii():
    s = "abc\u0097\u0085def"
    result = stage.transform(s)
    assert result == "abcקוdef"


def test_regression_sample_from_production():
    """Real bytes pulled from the יתיר file's noise bucket.

    `'\\U+009A\\U+0085\\U+0098\\U+0083\\U+0082 .\\U+0084'` after uplus
    expansion = U+009A U+0085 U+0098 U+0083 U+0082 ' ' '.' U+0084
    Maps in CP862 to: ת ו ר ד ג space dot ה  →  RTL reads "ה. גדרות"
    ("ה. fences"), a real annotation from the drawing index.
    """
    raw = "\u009A\u0085\u0098\u0083\u0082 .\u0084"
    assert stage.detect(raw)
    decoded = stage.transform(raw)
    # All five Hebrew letters must come through.
    for c in "תורדגה":
        assert c in decoded, f"Missing {c!r} in {decoded!r}"


def test_unmappable_high_bytes_left_alone():
    # 0xFF is undefined in CP862 — must not crash, must not mangle others.
    s = "\u00FF\u0097\u0097"
    result = stage.transform(s)
    assert result.count("ק") == 2
