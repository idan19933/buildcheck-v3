# Boundaries diagnostic — REPORT

**Date:** 2026-04-26
**File under test:** `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf` (same DXF as the rooms diagnostic)
**Production analysis:** `4133f139-2887-4478-9c48-b51d2eff521b` (Version A composed pipeline)

## Counts

| Category | Logical matches | Visual-RTL matches | Production high-conf (≥0.7) |
|---|---|---|---|
| **boundaries**           | 0 | **25** | 0 |
| **construction_elements**| 1 | **10** | 1 |
| **changes**              | 0 | 2     | 0 |

Per-word breakdown (visual-RTL):

- **boundaries**: `חזית: 19`, `מגרש: 4`, `דרך: 2` (no hits on `קו בניין`, `גבול מגרש`, `מדרכה`, `שכן` — those terms aren't physically in the file)
- **construction_elements**: `עמוד: 3`, `קיר: 3`, `מדרגות: 3`, `גג: 1`
- **changes**: `להריסה: 1`, `חדש: 1`

For comparison from yesterday's rooms diagnostic on the same file:
- **rooms**: logical 0, visual-RTL 27, production 1

## Sample matches (visual-RTL, by category)

### Boundaries

| viewport | decoded text | matched (reversed) | logical Hebrew |
|---|---|---|---|
| VIEWPORT1 | `שרגמ` | `שרגמ` | `מגרש` (plot) |
| VIEWPORT1 | `: הקלחה/שרגמה` | `שרגמ` | `מגרש` → "המגרש/החלקה:" (the plot/parcel:) |
| VIEWPORT3 | `שרגמ` | `שרגמ` | `מגרש` |
| VIEWPORT3 | `.ע.?.ת שרגמ` | `שרגמ` | `מגרש` → "מגרש ת.?.ע." (plot T.B.A.) |
| VIEWPORT3 | `רפע ךרד` | `ךרד` | `דרך` → "דרך עפר" (dirt road) |
| VIEWPORT? | `תיזח` (×many) | `תיזח` | `חזית` (facade) — these are the elevation-sheet headings |

### Construction

| viewport | decoded text | matched (reversed) | logical Hebrew |
|---|---|---|---|
| VIEWPORT1 | `?ידומע תמוק` | `דומע` | `עמוד` → "קומת עמודי?" (column-floor) |
| VIEWPORT1 | `?יי?וציח תוריק` | `ריק` | `קיר` → "קירות חיצוני??" (external walls) |
| VIEWPORT1 | `גג` | `גג` | `גג` (roof) — palindromic, matches both directions |
| VIEWPORT1 | `תוגרדמ` | `תוגרדמ` | `מדרגות` (stairs) |
| VIEWPORT1 | `תוגרדמ ירדח` | `תוגרדמ` | `מדרגות` → "חדרי מדרגות" (stair-rooms) |

### Changes

| viewport | decoded text | matched (reversed) | logical Hebrew |
|---|---|---|---|
| VIEWPORT1 | `הסירהל` | `הסירהל` | `להריסה` (to demolish) |
| VIEWPORT1 | `שדח ?י??` | `שדח` | `חדש` → likely "??י? חדש" (new ???) |

(Full sample lists in `experiments/boundaries_diagnostic/samples.json`.)

## Verdict — **STRONG**

Per the spec's rule: STRONG = "visual-RTL counts ≥ 15 in at least two categories." Combining this diagnostic with the rooms diagnostic on the same file:

| Category | Visual-RTL | Threshold |
|---|---|---|
| **rooms** (from rooms diagnostic) | **27** | ≥15 ✅ |
| **boundaries** (this diagnostic)  | **25** | ≥15 ✅ |
| construction_elements             | 10 | mid |
| changes                           | 2  | low |

Two compliance-critical categories cleanly clear the 15-mark; combined ≈ 52 unrecovered classifications on this single file. Construction and changes add another ~12 on top of that. The mechanism in every case is identical to rooms: the file stores Hebrew as visual-RTL CP862; the decoder pipeline correctly emits Hebrew chars but doesn't reverse them; the vocabulary is in logical order; vocabulary lookup misses.

The script's auto-heuristic ran on only the 3 categories in this PR's word list and printed MODERATE — that's a narrower view. Combined with rooms (a separate diagnostic with its own concrete evidence), the correct read is STRONG.

## Recommendation

**The gated `hebrew_unreverse` re-enable is justified.** Specifically:

The earlier "park it" decision rested on a global-average ROI metric ("16 vocabulary hits out of 350 candidates"). That metric averaged compliance-critical Hebrew with file-metadata strings, addresses, and form text. The two diagnostics now show the 16+ hits cluster on the categories the agent needs:

- ~27 rooms unrecovered → 26 of them blocking room-area / room-count requirements
- ~25 boundaries unrecovered → blocking setback / facade / plot-size requirements
- ~10 construction elements unrecovered → blocking element-presence checks
- ~2 changes (renovation indicators) unrecovered → small but interpretation-changing

That's >60 unrecovered compliance-relevant classifications on **one** file. Re-enabling is high ROI.

**Suggested gate criteria** (write the actual PR separately, not in this diagnostic):

1. Detector requires Hebrew chars present AND no real Hebrew word matched the vocabulary in the un-reversed form (i.e. only fire when normal lookup failed).
2. Activation also requires `cp862_remap` fired in the pipeline (couples reversal to its known cause — legacy CP862 storage). Modern UTF-8 / `\U+XXXX` files won't trigger.
3. Per-string trace logged so future diagnostics can audit false positives.

Do NOT just flip the existing detector back to `True` — the original detector fired on all Hebrew with sofit-letter signals, which produced false-positive risk on modern files. The gated form is what makes this safe.

## Files written

- `experiments/boundaries_diagnostic/diagnose.py`
- `experiments/boundaries_diagnostic/counts.json`
- `experiments/boundaries_diagnostic/samples.json`
- `experiments/boundaries_diagnostic/REPORT.md` (this file)

`git diff server/` shows pre-existing uncommitted Version A changes from earlier in this session — none of this diagnostic touched anything under `server/`.
