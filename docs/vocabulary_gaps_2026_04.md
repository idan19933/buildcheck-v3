# Vocabulary gaps — empirical findings, 2026-04-25

This file is the **seed spec for the next vocabulary-coverage PR**. It captures
what the encoding-pipeline diagnostic on the יתיר file revealed: once Hebrew is
correctly decoded (CP862) and reversed (visual-RTL → logical), the bottleneck
moves upstream. The classifier's vocabulary doesn't recognize 95% of the
correctly-decoded Hebrew that appears in real permit DXFs.

Do not start the next PR from imagination. Start from this list.

---

## How this list was produced

`server/python/tests/reversal_diagnostic.py` was run against the post-pipeline
output of analysis #865dcdbf (file `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf`,
the יתיר plan). It bucketed all 350 strings that contain ≥2 Hebrew characters
into four categories:

| Bucket | Meaning | Count |
|---|---|---|
| A | Reversal stage fired | 0 (diagnostic only sees skipped) |
| **B** | Reversed form **does** match vocabulary (detector too narrow) | **16** (4.6%) |
| C | Original form is a coincidence fuzzy match (noise) | 2 (0.6%) |
| **D** | **Neither form classifies — vocabulary doesn't cover** | **332** (94.9%) |

Bucket D is the gap this PR closes.

---

## Bucket B (16) — would unlock with reversal alone

Already-supported categories the detector misses because of word-form variance:

```
changes/existing_to_demolish: 3       (להריסה, הריסה plural/inflection forms)
rooms/stairs:                 3       (חדרי מדרגות, מדרגות)
rooms/balcony:                2       (מרפסות plural)
rooms/storage:                1
sheet_labels/roof_plan:       1       (גג)
rooms/laundry:                1       (כיסה — likely false positive)
rooms/living_room:            1
rooms/safe_room:              1       (ממ"ד)
construction_elements/wall_new: 1
construction_elements/beam:   1       (likely false positive)
finishes/brick_silicate:      1
```

Two of these (`רפסמ` matching balcony, `וחרה` matching beam) are coincidental
fuzzy distance noise, not real wins.

---

## Bucket D (332) — sample strings the vocabulary needs

From the diagnostic's 30-string random sample, here are the categories the
vocabulary doesn't model:

### New construction-element terms

| Hebrew (logical) | English | Suggested category |
|---|---|---|
| `קו חשמל` | electricity line | construction_elements / utility_line |
| `גדר רשת` | chain-link fence | boundaries / fence_chain_link (or alias of fence) |
| `חזית 4` | facade 4 | sheet_labels / facade_N (needs pattern match) |
| `מסחר` | commerce | rooms / commercial |
| `חדרי שירות נוספים` | additional service rooms | rooms / service_extra |
| `מדרגות` | stairs | rooms / stairs (already exists) |
| `חדרי מדרגות` | stair rooms (plural construct) | morphological coverage of stairs |

### Permit-metadata terms (currently not modelled at all)

| Hebrew (logical) | English | Suggested category |
|---|---|---|
| `חותמת הוועדה המקומית` | local committee stamp | permit_metadata / committee_stamp |
| `אישורי של רשויות חוץ` | external authority approvals | permit_metadata / external_approvals |
| `לשימוש הועדה המקומית לד` | for local committee use | permit_metadata / committee_use |
| `מס' ההיתר` | permit number | permit_metadata / permit_number |
| `תאריך ההיתר` | permit date | permit_metadata / permit_date |
| `תאריך תחילה` | start date | permit_metadata / start_date |
| `תאריך גמר` | end date | permit_metadata / end_date |
| `הראשו שרשימת עורכי הקשה...` | request signers list | permit_metadata / signer_list |

### Pattern / morphological coverage

The current vocabulary uses canonical-exact and alias matching. Real DXFs use:

1. **Construct state forms**: `חדרי` (rooms-of) where vocab has `חדר` (room).
   Need to either add inflected forms or add suffix-stripping during normalization.
2. **Plural forms**: `מרפסות` vs `מרפסת`, `הריסה` vs `להריסה`.
3. **Numbered patterns**: `חזית N`, `קומה N`, `דירה N` — should match by template.
4. **Compound phrases**: `חדרי שרות`, `חדרי מדרגות`, `חדרי וספי` — vocabulary
   has the head noun but not the compound.
5. **Long sentences containing vocab terms**: `7 חדרי ויותר` ("7+ rooms"),
   `125.05 - 12.00 = 113.05 :____ ירקיע חטש כ"הס` (calculation row containing
   `שטח עיקרי` = "main area"). Currently exact-match-only; needs `contains`
   matching with high precision.

---

## Design conversation for the next PR

When this gets picked up, the design conversation is:

1. **Just add more terms** (simple, safe, immediate ROI). Costs: vocabulary file
   bloat, no morphological generalization.
2. **Add term-pattern matching** (e.g. `חזית N`, `קומה N`). Medium cost, broad
   coverage of numbered annotations.
3. **Add substring/contains matching** for long sentences. Highest ROI but
   highest false-positive risk — needs precision guards (minimum match length,
   word-boundary check, etc.).
4. **Add lightweight Hebrew morphological normalization** (strip plural suffixes
   `-ות`/`-ים`, strip construct-state `-י`, drop the `ה-` prefix). Compact, but
   risky on technical terms.

Most likely answer is some combination of 1+2 first, save 3 for after measurement.

---

## What's NOT in scope for the next PR

These came up during the diagnostic but belong to other PRs:

- **Re-enabling `hebrew_unreverse` in the default pipeline.** Parked because
  metadata-gated activation is a non-trivial design and bucket-B impact is small
  (≤16 strings). See `pipeline.py` docstring.
- **Wiring the decoder pipeline into `dxf_viewport_extractor.py`.** That extractor
  feeds `parsed.labels` in the legacy compliance prompt. It does its own decoding
  today. Bringing it onto the pipeline would let the agent see real Hebrew in the
  legacy summary too — separate measurement-justified PR.
- **Sheet-classifier upgrade** (mis-labeled "other_construction" / "other_details"
  viewports) — different PR, mentioned in the original orchestrator-fix spec.
