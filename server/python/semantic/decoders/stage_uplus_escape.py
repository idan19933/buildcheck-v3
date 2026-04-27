r"""
Stage: Expand AutoCAD ``\U+XXXX`` escape sequences into real codepoints.

Input:  ``\U+05E7\U+05D5 \U+05D1\U+05E0\U+05D9\U+05D9\U+05DF``
Output: ``קו בניין``

This is the common case for files saved from modern AutoCAD versions
that encode non-ASCII text through Unicode escapes.
"""
import re

from .pipeline import DecoderStage

_UPLUS = re.compile(r"\\U\+([0-9A-Fa-f]{4})")


def _detect(s: str) -> bool:
    return bool(_UPLUS.search(s))


def _transform(s: str) -> str:
    return _UPLUS.sub(lambda m: chr(int(m.group(1), 16)), s)


stage = DecoderStage(
    name="uplus_escape",
    detect=_detect,
    transform=_transform,
    description=r"Expand \U+XXXX → codepoint",
)
