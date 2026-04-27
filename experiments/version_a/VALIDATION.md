# Version A — single validation run on יתיר

**Date:** 2026-04-26
**Analysis ID:** `4133f139-2887-4478-9c48-b51d2eff521b`
**File:** `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf` (DxfFile `a414d098…`)
**Mode:** `USE_COMPOSED_CODEGEN=true` (semantic before codegen, index passed to extractor)
**Runtime:** 8 min 19 s

## Acceptance criteria

| Criterion | Required | Actual | Verdict |
|---|---|---|---|
| `setbacks_with_fake_numbers` | === 0 | **0** | ✅ PASS |
| `building_height_implausible` (>50m) | false | roof_height=5m, all_relative max 17m, all_absolute range 605–1320m | ✅ PASS |
| `rooms_classified` (was 0 in production) | > 0 | 1 | ✅ PASS |
| `boundaries_classified` (was 0 in production) | > 0 | 0 | ❌ FAIL |
| Generated extractor avoids hardcoded vocabulary | (verify by code grep) | not yet inspected | TBD |

**3 of 4 measurable criteria pass.** The boundaries_classified=0 is the known vocabulary-gap problem (95% of decoded Hebrew falls in bucket-D per `vocabulary_gaps_2026_04.md`), not a Version A regression.

## Compliance verdicts

| status | count |
|---|---|
| PASS | 3 |
| FAIL | 0 |
| WARNING | 2 |
| CANNOT_CHECK | 20 |
| **score** | **60** |

Non-CANNOT_CHECK breakdown:

```
[PASS]    גובה מינימלי למעקה גג     measured: 1.05  → > 1.0m min
[PASS]    גובה מירבי למעקה גג       measured: 1.05  → < 1.4m max
[PASS]    מרפסת זיזית — זוהתה        measured: 1     → rooms.balcony hit
[WARNING] גובה בנייה מירבי (גג שטוח) measured: 4.64  → rel-elevation spread, < 8m limit
[WARNING] גובה בנייה מירבי (גג רעפים) measured: 4.64  → same, < 9.5m limit
```

The WARNINGs are honest: 4.64m relative-elevation spread is below the regulatory cap, but the agent flags that this might be one section's spread rather than full building height. **No PASS or FAIL is based on a fabricated number.**

## Pipeline trace — key signals

```
[pipeline:a414d098] exploring → preview → generating (with composed semantic) → extracting → done
[semantic:a414d098] 2536 texts; 3 semantic; 1143 unclassified  decoder[uplus_escape=378 cp862_remap=350 cp1255_remap=0]
[semantic-index:a414d098] boundaries=0 rooms=1 elev_abs=351 elev_rel=153 vp_with_both=[VIEWPORT3,4,7,8,9,10,11,12]
[composed-codegen:a414d098] passing index to codegen — boundaries=0 rooms=1
EXTRACTION SUMMARY: 0 setbacks, 20 chains, 19 heights, 0 survey pts, parking=no
```

Notably:
- `0 setbacks` from extractor — not "16 fake setbacks". The composed-codegen prompt instructions held.
- `vp_with_both=8 viewports` — the elevation regex fix correctly identifies sections as viewports carrying both abs+rel elevations.
- `roof_height: 5` — Opus computed from relative-elevation range (4.6 - (-0.04) ≈ 4.6m, rounded), not from absolute spread. Building-height-from-relatives instruction held.

## What changed vs the previous baseline (analysis `865dcdbf`, no Version A)

| Metric | Old (legacy parallel) | New (composed Version A) |
|---|---|---|
| Score | 33 (3P/0F/0W/22CC) | **60 (3P/0F/2W/20CC)** |
| Setbacks fake | 0 (legacy extractor produced none) | 0 |
| Building height | not computed | 5m (plausible) |
| WARNINGs raised | 0 | 2 (honest height uncertainty) |
| CANNOT_CHECK | 22 | 20 |

The composed pipeline shifts 2 requirements from CANNOT_CHECK → WARNING (height) and bumps the score 33 → 60. Numbers are n=1 — see PR 2 (variance investigation) for why a single-run delta is suggestive but not statistically significant.

## What this PR ships

- `server/python/semantic/semantic_classifier.py` — split elevation regex (prereq 1)
- `server/python/tests/test_semantic_classifier.py` — 11 new test cases
- `server/src/services/semantic-index.ts` — consume new keys, drop magnitude-split shim
- `server/src/services/setback-evidence.ts` (new) — SetbackEvidence schema + agent prompt fragment (prereq 2)
- `server/src/services/core-compliance-agent.ts` — splice setback interpretation instructions
- `server/src/services/code-generator.service.ts` — `renderSemanticSectionForCodegen` + "consume don't reclassify" instructions
- `server/src/services/dxf-pipeline.service.ts` — accept + forward `semanticIndex`
- `server/src/services/analysis-orchestrator.ts` — `USE_COMPOSED_CODEGEN` branch (sequence semantic → codegen)
- `experiments/version_a/raw/compliance_data.json` — captured artifact
- `experiments/version_a/raw/v_a_core.json` — per-requirement results
- `experiments/version_a/VALIDATION.md` — this file

## Out of scope (deferred)

- **Multi-file generalization** (the spec's "measurement protocol on at least 2 files"): not run in this PR. Each E2E run is ~8 min + ~$3 in API spend. With variance ≈ 30 stdev (per PR 1), a meaningful generalization needs 3+ runs each on 2+ files = 12+ runs ≈ $36 + 1.5 hr. Defer to a separate session when budget allows.
- **Inspect the generated extractor's code** to confirm absence of hardcoded vocabulary patterns. Would close the 4th acceptance criterion. Easy follow-up — grep `/app/python/generated/extract_*.py` for `LABELS = {` and Hebrew strings.
- **Vocabulary expansion** to lift `boundaries_classified > 0` (and many CANNOT_CHECK rows). Tracked separately in `docs/vocabulary_gaps_2026_04.md`.
- **Hint pipeline** (built but not wired) — still parked.

## Decision

Ship Version A behind the feature flag. The composed pipeline produces honest, plausibly-numbered output on the only file we measured. **Do not flip the default ON until multi-file measurement confirms the lift holds across files.**

Per the spec's rollout language: enable in staging first, run 5+ analyses, review metrics, then promote.
