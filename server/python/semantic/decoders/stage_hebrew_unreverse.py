"""
Stage: Reverse visual-RTL Hebrew sequences to logical order.

Background
----------
Legacy AutoCAD versions (especially CP862-era DOS AutoCAD) store Hebrew
text as **visual-right-to-left bytes**: the rightmost letter on screen
is stored first in the byte stream. Modern Unicode-aware code reads bytes
left to right, so a word like "תאריך" comes out as "ךיראת" — every
letter reversed within the word.

Detection
---------
Hebrew writing has five **final-form letters** (sofit forms — ך ם ן ף ץ)
that, by Hebrew orthography, can ONLY appear at the **end** of a word.
If any Hebrew word in the input starts with a sofit letter, the text is
visual-RTL with certainty — those forms are physically illegal in
word-initial logical position.

This is a high-precision detector: it fires only when there is no doubt.
Visual-RTL Hebrew without sofit letters at word-start (e.g. "תורדג" =
"גדרות" reversed, no sofit) won't trigger this stage and will remain
reversed. That's an acceptable false-negative — better to miss some
than to corrupt modern logical-ordered Hebrew.

Transform
---------
Walk the string; whenever a maximal run of Hebrew letters / Hebrew-aware
punctuation is encountered, reverse the run. Non-Hebrew runs (ASCII,
digits, spaces) are emitted as-is, preserving overall layout.
"""
from .pipeline import DecoderStage


HEBREW_BLOCK_START = 0x0590
HEBREW_BLOCK_END = 0x05FF
SOFIT_LETTERS = frozenset("ךםןףץ")
# Punctuation Hebrew-language stamps glue into words: gershayim and geresh
# (used in abbreviations like ממ"ד, מס').
HEBREW_GLUE_PUNCT = frozenset("\"'\u05F3\u05F4")


def _is_hebrew_letter(c: str) -> bool:
    o = ord(c)
    return HEBREW_BLOCK_START <= o <= HEBREW_BLOCK_END


def _is_word_char(c: str) -> bool:
    """A char that belongs inside a Hebrew word for run-detection purposes."""
    return _is_hebrew_letter(c) or c in HEBREW_GLUE_PUNCT


def _detect(s: str) -> bool:
    if not s:
        return False
    # Split into whitespace-separated tokens; check first letter of each.
    for token in s.split():
        # Strip leading non-Hebrew chars (e.g. digits, punctuation prefix)
        # before looking at the first Hebrew letter of the word.
        for ch in token:
            if _is_hebrew_letter(ch):
                if ch in SOFIT_LETTERS:
                    return True
                break  # first Hebrew letter found, not sofit → check next token
    return False


def _transform(s: str) -> str:
    """Full-string reversal, with non-Hebrew non-whitespace runs re-reversed.

    Visual-RTL storage means BOTH word order AND letter order within each
    word are reversed compared to logical. Char-by-char full reversal
    inverts both at once. We then walk the reversed string and re-reverse
    any run of non-Hebrew non-whitespace chars (digits, Latin letters,
    parentheses) so they keep their original LTR orientation.
    """
    rev = s[::-1]

    def kind_of(c: str) -> str:
        if c.isspace():
            return "space"
        if _is_word_char(c):
            return "heb"
        return "other"

    out: list[str] = []
    cur: list[str] = []
    cur_kind: str | None = None
    for c in rev:
        k = kind_of(c)
        if cur_kind is None or k == cur_kind:
            cur.append(c)
            cur_kind = k
            continue
        # Flush previous run
        chunk = "".join(cur)
        if cur_kind == "other":
            chunk = chunk[::-1]
        out.append(chunk)
        cur = [c]
        cur_kind = k
    if cur:
        chunk = "".join(cur)
        if cur_kind == "other":
            chunk = chunk[::-1]
        out.append(chunk)
    return "".join(out)


stage = DecoderStage(
    name="hebrew_unreverse",
    detect=_detect,
    transform=_transform,
    description="Flip visual-RTL Hebrew runs to logical order (sofit-at-start signal)",
)
