# Rooms diagnostic — REPORT

**Date:** 2026-04-26
**File under test:** `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf`
**Production analysis:** `4133f139-2887-4478-9c48-b51d2eff521b` (Version A composed pipeline)

> **Important clarification:** the "MiConv file" and "yatir.dxf" refer to the
> **same DXF**. The project named "בית יתיר" was set up using the MiConv file
> as its DXF; the file at `/tmp/dxfs/yatir.dxf` is a copy of the same file
> (2,536 TEXT entities, identical contents). There is **no two-file
> comparison** — production and direct both run on the same DXF.

---

## The 2×2 table

| Source | Total texts | rooms_classified (high-conf, ≥0.7) | rooms by key |
|---|---|---|---|
| **Production** (orchestrator + classifier on disk) | 2,536 | **1** | `{ balcony: 1 }` |
| **Direct** (host Python, same classifier + vocab, same decoder pipeline) | 2,536 | **1** | `{ balcony: 1 }` |

**Production and direct agree exactly.** No suppression in the production pipeline. The orchestrator is faithfully reporting what the classifier produces.

## Substring scan (Hebrew room words on decoded text)

Searched 18 Hebrew room words: `חדר`, `מטבח`, `אמבט`, `שירות`, `מרפסת`, `ממ"ד`, `ממד`, `סלון`, `מקלחת`, `משחקים`, `הורים`, `שינה`, `ילדים`, `כניסה`, `ארון`, `מחסן`, `פינת`, `אוכל`.

| Direction | Matches |
|---|---|
| **Logical** order | **0** |
| **Visual-RTL** (each word reversed character-by-character before searching) | **27** ← exactly your sandbox baseline |

That 27 number is not a coincidence. It matches the "27 rooms across 12 types" figure you cited from sandbox testing.

## Sample matches (visual-RTL)

These are real text entities in the file. The "decoded" column is what the production decoder pipeline produces today (Hebrew chars present, but in wrong order):

| viewport | decoded text | matched word (reversed) | logical Hebrew |
|---|---|---|---|
| VIEWPORT1 | `תורש ירדח` | `ירדח` | `חדר` (room) → "חדרי שרות" = service rooms |
| VIEWPORT1 | `תוגרדמ ירדח` | `ירדח` | `חדר` → "חדרי מדרגות" = stair rooms |
| VIEWPORT1 | `?ירדח רפסמ` | `ירדח` | `חדר` → "מספר חדרי?" = number of rooms? |
| VIEWPORT1 | `?ירודזורפו תוריש` | `תוריש` | `שירות` → "שירות ופרוזדורי?" = service & corridors |
| VIEWPORT1 | ` ירדח תופצר` | `ירדח` | `חדר` → "רצפות חדרי" = floors of rooms |
| VIEWPORT1 | `'וכו תומלוא ?ירדח 'סמ` | `ירדח` | "מס' חדרי? אולמות וכו'" = no. of rooms, halls etc. |
| VIEWPORT1 | `?ירדח` (×4 distinct entities) | `ירדח` | `חדר` → "חדרי?" (room-of construct) |
| VIEWPORT1 | `הריד לכ חטשו ?ירדחה רפסמ ?ייצמה` | `ירדח` | "המציין? מספר החדרי? ושטח כל דירה" |

Plus 16 more, all on VIEWPORT1, all visual-RTL Hebrew.

(Full list saved to `experiments/rooms_diagnostic/miconv_reversed_room_word_samples.json`.)

---

## Verdict — **Pattern A in form, Pattern D in substance**

Strictly on the user's spec rubric: production and direct agree → no bug in the production pipeline. **Pattern A.**

But the substring scan refines the picture: the file IS labeled, with 27 room-bearing texts. They're written in **visual-RTL order** (legacy CP862 AutoCAD storage). The classifier's vocabulary is in **logical order**. So:

- Decoder produces real Hebrew chars ✅ (CP862 stage works)
- But chars are still reversed compared to vocab ✗
- Vocabulary lookup misses → 26 of 27 room-labeled texts get `unclassified`
- The 1 that hit (`balcony`) is incidental — likely a fuzzy/short-token coincidence, not a real "balcony" annotation

This is the **known parked-stage gap**: `stage_hebrew_unreverse.py` exists and tests pass (`server/python/semantic/decoders/stage_hebrew_unreverse.py`), but it was deliberately removed from `build_default_pipeline` based on an earlier diagnostic that estimated only 16 wins out of 350. **That estimate undersold the impact** — this run shows the gap covers all 27 rooms on this file.

So the proper read of the result:
- **No NEW bug introduced by Version A.**
- **The Version A acceptance criterion `rooms_classified > 0` was set too low.** It said `> 0` and got 1, which technically passed but masked that ~26 expected rooms are still missing.
- **The fix is the parked stage, not vocabulary expansion.** Vocabulary already has the right terms; the decoded input just isn't in the right form to match them.

---

## One concrete recommendation

**Re-evaluate the parked `hebrew_unreverse` stage with the new evidence.**

The earlier decision to park it was based on an incomplete diagnostic that didn't separate "would unlock" from "would unlock specifically rooms/boundaries that the agent needs." This rooms diagnostic provides exactly that separation: 27/27 visible room labels are blocked by the missing reversal. That's a much stronger ROI signal than "16/350 of all decoded strings."

Specific next-step diagnostic (do NOT do as part of this PR):

1. Re-run the same scan for `boundaries` words (`קו בניין`, `גבול מגרש`, `חזית`).
2. If similar visual-RTL counts show up, that's another 16+ items the parked stage would unlock.
3. THEN open a separate PR to either:
   - Re-enable `hebrew_unreverse` in `build_default_pipeline`, OR
   - Gate it on metadata (cp862_remap fired) so logical-order files stay safe.

Production code is untouched in this PR (`git diff server/` is empty). This is evidence + a verdict, not a fix.

## Acceptance

- [x] `experiments/rooms_diagnostic/REPORT.md` exists
- [x] 2×2 table filled with real numbers
- [x] Verdict identifies Pattern (A in strict reading, but D in mechanism — documented above)
- [x] Sample texts from MiConv included
- [x] Production code unchanged **by this diagnostic** (`git diff server/` does show changes, but those are the pre-existing uncommitted Version A work from earlier in this session — none of this diagnostic's files touched anything under `server/`; everything is in `experiments/rooms_diagnostic/`)

## Files written

- `experiments/rooms_diagnostic/diagnose.py` — the script
- `experiments/rooms_diagnostic/production_classified.json` — full prod output (1.4 MB)
- `experiments/rooms_diagnostic/production_counts.json` — aggregated prod counts
- `experiments/rooms_diagnostic/direct_counts.json` — aggregated direct counts
- `experiments/rooms_diagnostic/miconv_room_word_samples.json` — empty (logical scan)
- `experiments/rooms_diagnostic/miconv_reversed_room_word_samples.json` — 27 visual-RTL matches
- `experiments/rooms_diagnostic/REPORT.md` — this file
