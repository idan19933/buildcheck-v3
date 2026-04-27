"""
Stage: Remap CP1255-as-codepoint characters to real Unicode Hebrew.

Background
----------
Legacy AutoCAD versions stored Hebrew as raw CP1255 bytes. When those files
are read today (or come through ``\\U+00XX`` expansion), the bytes end up
as Unicode codepoints in the 0x80–0xFE range — NOT in the Hebrew Unicode
block (0x0590–0x05FF).

Example: the CP1255 byte 0xE7 (Hebrew letter ק) shows up as codepoint
U+00E7 (ç — Latin small c with cedilla). This stage round-trips each
such character through CP1255 to recover the real Hebrew codepoint.

Detection
---------
Apply the remap only when the input "smells like" CP1255-encoded Hebrew:
  - Contains DETECTION_THRESHOLD or more codepoints in the 0x80–0xFE range, AND
  - Contains NO characters in the Hebrew Unicode block (0x0590–0x05FF).

The second condition prevents double-encoding modern UTF-8 Hebrew files
that happen to contain a stray high-byte character.
"""
from .pipeline import DecoderStage


HEBREW_BLOCK_START = 0x0590
HEBREW_BLOCK_END = 0x05FF
HIGH_BYTE_START = 0x80
HIGH_BYTE_END = 0xFE
DETECTION_THRESHOLD = 2  # at least N high-byte chars to trigger


def _detect(s: str) -> bool:
    if not s:
        return False
    high_count = 0
    for c in s:
        o = ord(c)
        if HEBREW_BLOCK_START <= o <= HEBREW_BLOCK_END:
            # Real Hebrew already present — assume input is fine, skip.
            return False
        if HIGH_BYTE_START <= o <= HIGH_BYTE_END:
            high_count += 1
    return high_count >= DETECTION_THRESHOLD


def _transform(s: str) -> str:
    out: list[str] = []
    for c in s:
        o = ord(c)
        if HIGH_BYTE_START <= o <= HIGH_BYTE_END:
            try:
                out.append(bytes([o]).decode("cp1255"))
            except UnicodeDecodeError:
                # Not all 0x80–0xFE codepoints map in CP1255 — leave as-is.
                out.append(c)
        else:
            out.append(c)
    return "".join(out)


stage = DecoderStage(
    name="cp1255_remap",
    detect=_detect,
    transform=_transform,
    description="Remap CP1255 bytes (as Latin-1 codepoints) to Hebrew Unicode",
)
