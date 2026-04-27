# PR 1 — Baseline drift check

**Date:** 2026-04-25
**File under test:** `MiConv.com__תוכנית לפני הערות - 10.11.25.dxf` (יתיר, DxfFile id `a414d098…`)
**Methodology:** full E2E `runCoreAnalysis` (Phase 1 explore → Phase 2 AI codegen → Phase 3 extract → semantic classification → compliance agent), 5 runs per cell, decoder-pipeline state varied by full git checkout + docker rebuild (not env-toggle).

---

## Verdict

**VARIANCE.** No detectable baseline drift between commit `614dfc7` and current main. The earlier 67/85 readings on this file and today's readings (0–80 range) are all samples from the same wide distribution. The decoder pipeline did NOT introduce a regression.

---

## Results

| | Step A — current main (decoder pipeline) | Step B — `614dfc7` (clean baseline, no decoder) |
|---|---|---|
| Run 1 | 0 | 33 |
| Run 2 | 0 | 0 |
| Run 3 | 60 | 0 |
| Run 4 | 50 | 80 |
| Run 5 | 50 | 60 |
| **mean** | **32.00** | **34.60** |
| stdev | 29.50 | 35.72 |
| CC counts | 25, 24, 20, 21, 21 (mean 22.2) | 22, 22, 21, 20, 20 (mean 21.0) |

**Mean difference (A − B): −2.60** (current main is 2.6 points lower on average — well within noise)
**Mann-Whitney U two-sided p-value: 0.835** (distributions are statistically indistinguishable)

Decision rule:
- means within 10 points AND p > 0.1 → **VARIANCE** ✅ both conditions met (|−2.6| ≤ 10 and 0.835 > 0.1)
- means differ by 20+ points AND p < 0.05 → DRIFT ❌
- otherwise → INCONCLUSIVE ❌

---

## Methodology rigor (what was actually tested vs the agent's first attempt)

The agent initially ran step B with `USE_DECODER_PIPELINE=false` env on the **current** docker image. The user correctly pushed back: that's not the same as a real old-commit checkout because the surrounding orchestrator code, prisma schema state, and TypeScript compilation all still come from the post-decoder commit. To run the actual baseline:

1. Stashed all uncommitted decoder + experiments work (`git stash push -u`)
2. Verified working tree matched commit `614dfc7` exactly
3. Rebuilt docker image from scratch (`docker compose build server`)
4. Replaced running container (`docker compose up -d server`)
5. Ran 5 fresh full E2E sweeps on this clean image
6. Restored stashed work (`git stash pop`)

Step B numbers above come from this clean rebuild, not the env-toggle shortcut.

---

## What this means

**The "85 → 67" hypothesis we entered with is dead.** The 85 was a hardcoded inject script result (not a real agent run); the 67 was a real agent run that happened to land on the high end of a wide distribution. Neither represents a stable "before" state that anything regressed from.

Same-input score variance on this file is ~30 stdev with the full E2E pipeline. That's the dominant feature of the data. Any single-run before/after comparison on this file is uninterpretable.

**The decoder pipeline didn't break anything.** Step A and step B distributions are statistically indistinguishable. The decoder's effect on agent verdicts is below the noise floor on this file (which is consistent with the diagnostic finding that 95% of decoded Hebrew lands in vocabulary-bucket-D and the SemanticIndex stays mostly empty either way).

---

## What ships in PR 1

- `experiments/baseline_drift_check/raw/` — 10 raw run JSONs (5 step A from DB reconstruction + 5 step B from container)
- `experiments/baseline_drift_check/analyze.py` — pure-Python Mann-Whitney U + verdict
- `experiments/baseline_drift_check/run_e2e_5x.js` — the runner that produced step B (also ran step A earlier under different env)
- `experiments/baseline_drift_check/SUMMARY.md` — this file

---

## What this PR explicitly does NOT do

- Does not investigate why same-input variance is so high. **That's PR 2.**
- Does not ship the softened prompt. **That's PR 3.**
- Does not change any production code. The decoder pipeline + experiment instrumentation that's been merged stays merged.

---

## Authorization for PR 2

Per the spec sequencing: PR 1 verdict is VARIANCE → PR 2 (variance investigation) is now authorized. The variance signal is real and worth understanding before declaring any future score change "real". The hypotheses to test in PR 2 are V1–V5 from the spec; the diagnostic data in this PR's `raw/` already strongly suggests **V5 (score formula amplification)** because score 0 ↔ 50 ↔ 80 are exactly the values you'd get from 0/2/4 PASS verdicts under `score = PASS / (PASS + FAIL + WARNING) × 100`.

But that's PR 2. Do not bundle.
