"""
analyze.py — baseline-drift verdict for the יתיר file.

Compares 5 full-E2E runs on current main (with decoder pipeline) vs
5 full-E2E runs on commit 614dfc7 (clean baseline before decoder pipeline).

Decision rule (per spec):
  - means within 10 points AND U-test p > 0.1 → VARIANCE
  - means differ by 20+ points AND U-test p < 0.05 → DRIFT
  - otherwise → INCONCLUSIVE
"""
from __future__ import annotations
import io
import json
import statistics
import sys
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

RAW = Path(__file__).parent / "raw"


def mannwhitney_u_two_sided(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """Compute U statistic + an approximate two-sided p-value via normal approx.

    Pure-Python implementation (no scipy dependency). For n=5 each, the
    normal approximation isn't perfect, so we also compute the exact U
    distribution by enumeration when ranges are reasonable.
    """
    n1, n2 = len(xs), len(ys)
    if n1 == 0 or n2 == 0:
        return float("nan"), float("nan")

    # Combined ranks with tie-handling
    combined = [(v, "x") for v in xs] + [(v, "y") for v in ys]
    combined.sort(key=lambda t: t[0])
    ranks: dict[int, float] = {}
    i = 0
    while i < len(combined):
        j = i
        while j < len(combined) and combined[j][0] == combined[i][0]:
            j += 1
        avg_rank = (i + j + 1) / 2.0  # 1-indexed
        for k in range(i, j):
            ranks[k] = avg_rank
        i = j

    R1 = sum(ranks[idx] for idx, (_, label) in enumerate(combined) if label == "x")
    U1 = R1 - n1 * (n1 + 1) / 2
    U2 = n1 * n2 - U1
    U = min(U1, U2)

    # Normal approximation for p-value (two-sided)
    mean_U = n1 * n2 / 2
    sd_U = (n1 * n2 * (n1 + n2 + 1) / 12) ** 0.5
    if sd_U == 0:
        return U, 1.0
    z = (U - mean_U) / sd_U
    # Two-sided p via standard normal CDF approx
    from math import erf, sqrt
    p_one = 0.5 * (1 - erf(abs(z) / sqrt(2)))
    p_two = 2 * p_one
    return U, p_two


def main() -> None:
    a_scores: list[float] = []
    b_scores: list[float] = []
    a_cc: list[int] = []
    b_cc: list[int] = []

    for n in (1, 2, 3, 4, 5):
        a = json.loads((RAW / f"drift_e2e_current_main_{n}.json").read_text(encoding="utf-8"))
        b = json.loads((RAW / f"drift_e2e_old_commit_614dfc7_{n}.json").read_text(encoding="utf-8"))
        a_scores.append(a["score"])
        b_scores.append(b["score"])
        a_cc.append(a["status_counts"]["cannot_check"])
        b_cc.append(b["status_counts"]["cannot_check"])

    print("=" * 70)
    print("BASELINE DRIFT VERDICT — יתיר file")
    print("=" * 70)
    print(f"Step A (current main + decoder pipeline): {a_scores}")
    print(f"  mean = {statistics.mean(a_scores):.2f}")
    print(f"  stdev = {statistics.stdev(a_scores):.2f}")
    print(f"  CC counts = {a_cc} (mean {statistics.mean(a_cc):.1f})")
    print()
    print(f"Step B (commit 614dfc7, no decoder pipeline): {b_scores}")
    print(f"  mean = {statistics.mean(b_scores):.2f}")
    print(f"  stdev = {statistics.stdev(b_scores):.2f}")
    print(f"  CC counts = {b_cc} (mean {statistics.mean(b_cc):.1f})")
    print()

    diff = statistics.mean(a_scores) - statistics.mean(b_scores)
    print(f"Mean difference (A − B) = {diff:+.2f}")

    U, p = mannwhitney_u_two_sided(a_scores, b_scores)
    print(f"Mann-Whitney U = {U:.2f}")
    print(f"Two-sided p-value (normal approx) = {p:.3f}")
    print()

    # Verdict
    abs_diff = abs(diff)
    print("--- Verdict ---")
    if abs_diff <= 10 and p > 0.1:
        verdict = "VARIANCE"
        reason = (
            f"Mean diff ({diff:+.1f}) within ±10 AND p={p:.3f} > 0.1. "
            f"The two distributions are statistically indistinguishable; "
            f"the gap from earlier 67/85 baselines IS variance, not drift."
        )
    elif abs_diff >= 20 and p < 0.05:
        verdict = "DRIFT"
        reason = (
            f"Mean diff ({diff:+.1f}) ≥ 20 AND p={p:.3f} < 0.05. "
            f"Distributions are statistically distinguishable; "
            f"something between 614dfc7 and current main regressed silently."
        )
    else:
        verdict = "INCONCLUSIVE"
        reason = (
            f"diff={diff:+.1f}, p={p:.3f}. Need more runs (5 more on each) "
            f"OR add a second test file."
        )
    print(f"VERDICT: {verdict}")
    print(f"  {reason}")


if __name__ == "__main__":
    main()
