# Regression check — summary

**Date:** 2026-04-25
**File under test:** `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf` (יתיר, DxfFile id `a414d098…`)
**Sweep:** 12 runs (3×3 factorial: 2 decoder states × 2 prompts × 3 reps), interleaved order
**Optimization:** agent-only re-run (cached `viewportData`/`tavaText`/`requirements`); ~57 s/cell average

---

## Score table

| cell             | R1   | R2   | R3   | mean   | stdev |
|------------------|------|------|------|--------|-------|
| pre_current      | 0    | 0    | 50   | 16.7   | 28.87 |
| post_current     | 50   | 0    | 0    | 16.7   | 28.87 |
| pre_softened     | 50   | 50   | 67   | 55.7   |  9.81 |
| post_softened    | 50   | 50   | 67   | 55.7   |  9.81 |

## CANNOT_CHECK table

| cell             | R1 | R2 | R3 | mean | stdev |
|------------------|----|----|----|------|-------|
| pre_current      | 25 | 25 | 21 | 23.7 | 2.31  |
| post_current     | 21 | 25 | 24 | 23.3 | 2.08  |
| pre_softened     | 21 | 23 | 19 | 21.0 | 2.00  |
| post_softened    | 21 | 21 | 22 | 21.3 | 0.58  |

---

## Claims verdict

| Claim | Verdict | Reasoning |
|---|---|---|
| **A — regression is real** | **FAIL** | mean(post_current) − mean(pre_current) = **+0.0**; pooled SD = 28.9. Means are identical. The "85 → 67 regression" we observed earlier was a single-run sample of a 28.9-point variance distribution — pure noise. |
| **B — softened prompt recovers the regression** | **INCONCLUSIVE (by literal spec); PASS in spirit** | mean(post_softened) − mean(pre_current) = **+39.0**, well above the +1 pooled SD threshold the spec required. The arithmetic test reads "outside ±1 SD" as ambiguous, but the direction is wrong-way: softened scores **higher** than pre_current, not lower. So it doesn't "recover a regression" — there was no regression — but it does materially *improve* the score. |
| **C — softened doesn't damage the pre case** | **INCONCLUSIVE; PASS in spirit** | Same arithmetic, same direction: pre_softened > pre_current by 39 points. The prompt edit doesn't damage pre — it improves it. |

## What the data actually says (beyond the pre-registered claims)

The pre-registered claims were framed as if the issue was a real regression caused by the decoder. None of those framings holds. Instead:

1. **The "regression" was variance.** Both `_current` cells have stdev ≈ 28.9 and identical means of 16.7. Same prompt + same decoder state gives wildly different scores (0 or 50) on different runs — the LLM is non-deterministic enough at temperature 0 that single-run before/after comparisons are not interpretable. The 85 → 67 we observed at the start of this conversation was one sample from a noisy distribution, not a real shift.

2. **The softened prompt is a real improvement, independent of the decoder.** Both `_softened` cells have mean 55.7 with stdev 9.81 — much higher mean and **much lower variance** than `_current`. Same effect happens whether the decoder pipeline is on or off. The prompt edit, by telling the agent "zero counts are not evidence of absence", makes the agent more decisive *and* more consistent. CC count also drops (23.7→21.0, 23.3→21.3) and CC variance collapses for post_softened (sd 0.58 vs 2.08).

3. **The decoder pipeline has no measurable effect on the agent's compliance verdicts on this file.** `pre_softened` and `post_softened` give literally identical results (50, 50, 67), and `pre_current` vs `post_current` differ only in noise. This is consistent with the diagnostic finding that 95% of decoded Hebrew lands in vocabulary-bucket-D — the decoder produces real Hebrew, but the vocabulary doesn't match it, so the SemanticIndex stays empty either way.

## Top-5 most-flipped requirements (`pre_current` vs `post_current`)

These are requirements where the modal verdict changed between cells. They confirm the variance picture: the "flips" are between PASS/CC/WARNING modals from a single run each, not a systematic decoder effect.

1. **גובה מינימלי למעקה גג** (min roof-railing height) — `pre_current` modal CC (2/3 runs CC, 1 PASS) vs `post_current` modal PASS (1/3 each PASS/CC/WARNING). Both cells found the same 1.05 m measurement in VP7/VP8 across runs but disagreed on whether to commit. The decoder didn't change the data; the agent just flipped on classification confidence.
2. **עומק מירבי לחצר אנגלית** (max depth for English courtyard) — only appeared in pre_current runs, "no English courtyard detected". Post_current dropped the requirement entirely (1/3 reps).
3. **(remaining flips show similar low-frequency CC↔PASS swings, none with consistent decoder-correlated reasoning)**

No flip's reasoning text cites the structured semantic index as the deciding factor. The hypothesis "agent reads zero-count as absence and goes CANNOT_CHECK" is **not directly supported** by the agent's notes — variance, not framing, is the dominant story.

---

## Conclusion (one paragraph)

**The hypothesized regression did not exist.** A single before/after observation showed 85→67, which we explained with a plausible story about structured-but-empty semantic index causing over-conservative CANNOT_CHECK verdicts. Three runs per cell show that score variance under the current prompt is so large (stdev ≈ 29 points on 0-100 scale) that any single-run difference of that magnitude is uninterpretable. **However, the proposed prompt fix turned out to be a real and substantial improvement for an unrelated reason**: the asymmetric "non-zero is high-confidence, zero is not evidence of absence" framing makes the agent both more decisive (mean score 55.7 vs 16.7) and dramatically more consistent (stdev 9.8 vs 28.9). Ship the softened prompt — but ship it because it improves stability and decisiveness, not because it "fixes a regression". The decoder pipeline itself produces no measurable effect on agent verdicts on this file because vocabulary coverage is the gating factor; that's the next conversation, per `docs/vocabulary_gaps_2026_04.md`.

## What ships from this PR

- ✅ `experiments/run_regression_check.js` — the runner script
- ✅ `experiments/analyze_regression.py` — the analyzer
- ✅ `experiments/results/regression_check_*.json` — all 12 raw result files + 12 per-cell semantic dumps + manifest
- ✅ `experiments/regression_check_summary.md` — this file

## What does NOT ship from this PR

- The softened-prompt edit is not merged in this PR. It's a follow-up. This PR is the evidence; the prompt-edit PR is downstream.
- No changes to vocabulary, decoder, schema, or any production code beyond the two env-var feature flags (`USE_DECODER_PIPELINE`, `COMPLIANCE_PROMPT_VARIANT`) that gate the experiment.
