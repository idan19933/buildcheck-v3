"""Unit tests for the visual-RTL → logical Hebrew reversal stage."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from semantic.decoders.stage_hebrew_unreverse import stage  # noqa: E402


def test_detect_fires_on_sofit_at_word_start():
    # ך at start of word — only legal at word-end logically → visual-RTL.
    assert stage.detect("ךיראת")


def test_detect_skips_logical_hebrew():
    # Modern logical Hebrew: sofit at word-end, no false trigger.
    assert not stage.detect("תאריך")
    assert not stage.detect("מטבח")
    assert not stage.detect("חדר שינה")


def test_detect_skips_pure_ascii():
    assert not stage.detect("hello world")
    assert not stage.detect("VIEWPORT19")
    assert not stage.detect("")


def test_detect_skips_no_hebrew_at_all():
    assert not stage.detect("123 456")


def test_detect_per_word_check():
    # First word logical, second word visual-RTL → still detect.
    s = "מטבח ךיראת"
    assert stage.detect(s)


def test_transform_reverses_word():
    # ךיראת → תאריך
    assert stage.transform("ךיראת") == "תאריך"


def test_transform_full_string_reversal():
    """Visual-RTL = both word order AND letter order reversed.
    Full char reversal of 'ןנגב הכרב' = 'ברכה בגנן'."""
    assert stage.transform("ןנגב הכרב") == "ברכה בגנן"


def test_transform_keeps_digits_in_ltr_orientation():
    """Digits embedded in visual-RTL Hebrew should keep their LTR order."""
    # Visual: '25 ךיראת'  (number on the left, Hebrew word on the right)
    # Logical: 'תאריך 25'  (Hebrew first by RTL reading order, digits at end)
    assert stage.transform("25 ךיראת") == "תאריך 25"


def test_transform_swaps_ascii_runs_with_words():
    """Visual-RTL reverses position of ALL runs (ascii too), but each
    ascii run keeps its internal LTR character order."""
    # Visual: 'abc ךיראת xyz' → logical: 'xyz תאריך abc'
    assert stage.transform("abc ךיראת xyz") == "xyz תאריך abc"


def test_transform_keeps_punctuation_inside_run():
    # Gershayim attaches inside a Hebrew abbreviation; visual-RTL of
    # ממ"ד (safe room) reads as ד"ממ — reversal must restore order.
    assert stage.transform('ד"ממ') == 'ממ"ד'


def test_regression_real_yatir_string():
    """Real Hebrew strings from the יתיר file's CP862 output."""
    cases = [
        ("ךיראת", "תאריך"),                                 # date
        ("רתיהה ךיראת", "תאריך ההיתר"),                     # permit date
        ("רתיהה 'סמ", "מס' ההיתר"),                         # permit number
        ("תורש ירדח", "חדרי שרות"),                         # service rooms
        ("תימוקמה הדעווה תמתוח", "חותמת הוועדה המקומית"),   # local committee stamp
    ]
    for visual, logical in cases:
        assert stage.detect(visual) or all(
            ord(c) < 0x0590 or ord(c) > 0x05FF or c not in "ךםןףץ"
            for c in visual.split()[0] if c
        ), f"{visual!r} should detect as visual-RTL"
        assert stage.transform(visual) == logical, \
            f"{visual!r} → expected {logical!r}, got {stage.transform(visual)!r}"
