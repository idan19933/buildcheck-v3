"""
Stage: Remap CP862-as-codepoint characters to real Unicode Hebrew.

Background
----------
Pre-Unicode AutoCAD on Israeli DOS systems stored Hebrew as raw CP862
(IBM Hebrew, code page 862) bytes. When those files are read today —
or when their text comes through ``\\U+00XX`` escape expansion — the
bytes end up as Unicode codepoints in the **C1 control range**
(0x80–0x9A), where CP862 places the Hebrew alphabet:

  0x80=א  0x81=ב  0x82=ג  0x83=ד  0x84=ה  0x85=ו  0x86=ז
  0x87=ח  0x88=ט  0x89=י  0x8A=ך  0x8B=כ  0x8C=ל  0x8D=ם
  0x8E=מ  0x8F=ן  0x90=נ  0x91=ס  0x92=ע  0x93=ף  0x94=פ
  0x95=ץ  0x96=צ  0x97=ק  0x98=ר  0x99=ש  0x9A=ת

This is the dominant encoding in real-world Israeli permit DXFs that
predate AutoCAD's Unicode era — measurement on the יתיר file shows
840 Hebrew characters recovered across 149 texts using CP862, vs. zero
using CP1255.

Detection
---------
Apply the remap only when the input strongly resembles CP862-encoded
Hebrew:
  - Contains DETECTION_THRESHOLD or more codepoints in the
    **CP862 Hebrew band** (0x80–0x9A), AND
  - Contains NO characters in the Hebrew Unicode block (0x0590–0x05FF).

Sits *before* the CP1255 stage in the default pipeline because its
byte range is more specific. If it produces real Hebrew, the CP1255
detector's "skip if Hebrew already present" guard prevents double-work.
"""
from .pipeline import DecoderStage


HEBREW_BLOCK_START = 0x0590
HEBREW_BLOCK_END = 0x05FF
CP862_HEBREW_START = 0x80
CP862_HEBREW_END = 0x9A
HIGH_BYTE_START = 0x80
HIGH_BYTE_END = 0xFE
DETECTION_THRESHOLD = 2


def _detect(s: str) -> bool:
    if not s:
        return False
    in_band = 0
    for c in s:
        o = ord(c)
        if HEBREW_BLOCK_START <= o <= HEBREW_BLOCK_END:
            return False  # already-decoded Hebrew → skip
        if CP862_HEBREW_START <= o <= CP862_HEBREW_END:
            in_band += 1
    return in_band >= DETECTION_THRESHOLD


def _transform(s: str) -> str:
    out: list[str] = []
    for c in s:
        o = ord(c)
        if HIGH_BYTE_START <= o <= HIGH_BYTE_END:
            try:
                out.append(bytes([o]).decode("cp862"))
            except UnicodeDecodeError:
                out.append(c)
        else:
            out.append(c)
    return "".join(out)


stage = DecoderStage(
    name="cp862_remap",
    detect=_detect,
    transform=_transform,
    description="Remap CP862 (DOS-Hebrew) bytes to Hebrew Unicode",
)
