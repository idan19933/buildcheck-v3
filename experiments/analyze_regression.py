"""
analyze_regression.py
=====================

Loads the 12 regression_check_*.json files, computes the score and
CANNOT_CHECK tables, evaluates Claims A/B/C, finds the most-flipped
requirements, and writes a one-paragraph English conclusion.

Usage:
    python analyze_regression.py [results_dir]

Default results_dir is ./results next to this script.
"""
from __future__ import annotations

import io
import json
import math
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CELLS = ["pre_current", "post_current", "pre_softened", "post_softened"]


def load_runs(results_dir: Path) -> dict[str, list[dict]]:
    by_cell: dict[str, list[dict]] = {c: [] for c in CELLS}
    for cell in CELLS:
        for rep in (1, 2, 3):
            p = results_dir / f"regression_check_{cell}_{rep}.json"
            if not p.exists():
                print(f"  MISSING: {p.name}", file=sys.stderr)
                continue
            d = json.loads(p.read_text(encoding="utf-8"))
            by_cell[cell].append(d)
    return by_cell


def stats(xs: list[float]) -> tuple[float, float]:
    if not xs:
        return float("nan"), float("nan")
    if len(xs) == 1:
        return xs[0], 0.0
    return statistics.mean(xs), statistics.stdev(xs)


def fmt_row(label: str, xs: list[float | int]) -> str:
    runs = "  ".join(f"{x:>5.1f}" for x in xs)
    mean, sd = stats([float(x) for x in xs])
    return f"  {label:<18}  {runs}    {mean:>5.1f}   {sd:>5.2f}"


def claim_verdict(
    treatment_mean: float, treatment_sd: float,
    control_mean: float, control_sd: float,
    n: int,
    direction: str,
) -> tuple[str, str]:
    """Return (PASS|FAIL|INCONCLUSIVE, explanation).

    direction: 'lower' if treatment expected below control (claim A);
               'within' if treatment expected within ±1 SD of control (B, C).
    """
    pooled = math.sqrt((treatment_sd**2 + control_sd**2) / 2) or 1e-9
    diff = treatment_mean - control_mean

    if direction == "lower":  # Claim A: post_current SHOULD be ≥2 SD below pre_current
        if diff <= -2 * pooled:
            return "PASS", f"diff={diff:+.1f} ≤ -2·pooled_sd ({2*pooled:.1f})"
        if abs(diff) <= pooled:
            return "FAIL", f"means overlap within 1 pooled_sd ({pooled:.1f}); diff={diff:+.1f}"
        return "INCONCLUSIVE", f"diff={diff:+.1f}, pooled_sd={pooled:.1f}"

    # 'within' — Claim B/C: treatment SHOULD be within ±1 SD of control
    if abs(diff) <= pooled:
        return "PASS", f"diff={diff:+.1f} within 1 pooled_sd ({pooled:.1f})"
    if abs(diff) >= 2 * pooled:
        return "FAIL", f"diff={diff:+.1f} ≥ 2 pooled_sd ({2*pooled:.1f})"
    return "INCONCLUSIVE", f"diff={diff:+.1f}, pooled_sd={pooled:.1f}"


def find_flipped_requirements(by_cell: dict[str, list[dict]]) -> list[dict]:
    """For each requirement, count how often pre_current says PASS but
    post_current says CANNOT_CHECK (or vice versa). Return top-5."""
    pre_runs = by_cell["pre_current"]
    post_runs = by_cell["post_current"]

    # Build per-requirement status frequency in each cell
    pre_status: dict[str, Counter] = defaultdict(Counter)
    post_status: dict[str, Counter] = defaultdict(Counter)
    notes: dict[str, dict[str, str]] = defaultdict(dict)

    for run in pre_runs:
        for r in run["per_requirement"]:
            pre_status[r["requirement"]][r["status"]] += 1
            if r.get("notes"):
                notes[r["requirement"]]["pre_current"] = r["notes"]
    for run in post_runs:
        for r in run["per_requirement"]:
            post_status[r["requirement"]][r["status"]] += 1
            if r.get("notes"):
                notes[r["requirement"]]["post_current"] = r["notes"]

    # Score each requirement by "flip distance"
    flips: list[dict] = []
    all_reqs = set(pre_status) | set(post_status)
    for req in all_reqs:
        pre_modal = pre_status[req].most_common(1)[0][0] if pre_status[req] else "(absent)"
        post_modal = post_status[req].most_common(1)[0][0] if post_status[req] else "(absent)"
        if pre_modal == post_modal:
            continue
        # Heuristic: flip is "interesting" if it's PASS↔CANNOT_CHECK or PASS↔FAIL
        flips.append({
            "requirement": req,
            "pre_dist": dict(pre_status[req]),
            "post_dist": dict(post_status[req]),
            "pre_modal": pre_modal,
            "post_modal": post_modal,
            "pre_note": notes[req].get("pre_current", ""),
            "post_note": notes[req].get("post_current", ""),
        })

    # Sort by interestingness: PASS→CC flips first, then count of disagreement
    def rank(f: dict) -> tuple:
        pass_cc_flip = 1 if {f["pre_modal"], f["post_modal"]} == {"PASS", "CANNOT_CHECK"} else 0
        total_runs = sum(f["pre_dist"].values()) + sum(f["post_dist"].values())
        agree = max(f["pre_dist"].get(f["pre_modal"], 0), f["post_dist"].get(f["post_modal"], 0))
        return (-pass_cc_flip, -total_runs, -agree)

    flips.sort(key=rank)
    return flips[:5]


def main() -> None:
    results_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (Path(__file__).parent / "results")
    by_cell = load_runs(results_dir)

    print("=" * 70)
    print("REGRESSION CHECK ANALYSIS")
    print("=" * 70)

    # Score table
    print("\n## SCORE TABLE")
    print(f"  {'cell':<18}  {'R1':>5}  {'R2':>5}  {'R3':>5}    {'mean':>5}   {'stdev':>5}")
    score_means: dict[str, float] = {}
    score_sds: dict[str, float] = {}
    for cell in CELLS:
        scores = [r["score"] for r in by_cell[cell]]
        m, sd = stats([float(s) for s in scores])
        score_means[cell] = m
        score_sds[cell] = sd
        print(fmt_row(cell, scores))

    # CC table
    print("\n## CANNOT_CHECK TABLE")
    print(f"  {'cell':<18}  {'R1':>5}  {'R2':>5}  {'R3':>5}    {'mean':>5}   {'stdev':>5}")
    cc_means: dict[str, float] = {}
    cc_sds: dict[str, float] = {}
    for cell in CELLS:
        ccs = [r["status_counts"]["cannot_check"] for r in by_cell[cell]]
        m, sd = stats([float(c) for c in ccs])
        cc_means[cell] = m
        cc_sds[cell] = sd
        print(fmt_row(cell, ccs))

    # Claims
    print("\n## CLAIMS")
    n = min(len(by_cell["pre_current"]), len(by_cell["post_current"]))

    # Claim A: post_current is at least 2 SD below pre_current (regression is real)
    a_verdict, a_note = claim_verdict(
        score_means["post_current"], score_sds["post_current"],
        score_means["pre_current"], score_sds["pre_current"],
        n, direction="lower",
    )
    print(f"  Claim A (regression is real): {a_verdict}")
    print(f"    {a_note}")

    # Claim B: post_softened recovers — within 1 SD of pre_current
    b_verdict, b_note = claim_verdict(
        score_means["post_softened"], score_sds["post_softened"],
        score_means["pre_current"], score_sds["pre_current"],
        n, direction="within",
    )
    print(f"  Claim B (softened prompt recovers regression): {b_verdict}")
    print(f"    {b_note}")

    # Claim C: pre_softened ≈ pre_current (sanity check)
    c_verdict, c_note = claim_verdict(
        score_means["pre_softened"], score_sds["pre_softened"],
        score_means["pre_current"], score_sds["pre_current"],
        n, direction="within",
    )
    print(f"  Claim C (softened doesn't damage pre case): {c_verdict}")
    print(f"    {c_note}")

    # Per-requirement flips
    print("\n## TOP 5 MOST-FLIPPED REQUIREMENTS (pre_current vs post_current)")
    flips = find_flipped_requirements(by_cell)
    for i, f in enumerate(flips, 1):
        print(f"\n  [{i}] {f['requirement'][:80]}")
        print(f"      pre_current  → modal={f['pre_modal']}  dist={f['pre_dist']}")
        print(f"      post_current → modal={f['post_modal']} dist={f['post_dist']}")
        if f["pre_note"]:
            print(f"      pre note : {f['pre_note'][:160]}")
        if f["post_note"]:
            print(f"      post note: {f['post_note'][:160]}")

    return {
        "score_means": score_means,
        "score_sds": score_sds,
        "cc_means": cc_means,
        "cc_sds": cc_sds,
        "claims": {"A": (a_verdict, a_note), "B": (b_verdict, b_note),
                   "C": (c_verdict, c_note)},
        "flips": flips,
        "by_cell_scores": {c: [r["score"] for r in by_cell[c]] for c in CELLS},
        "by_cell_cc": {c: [r["status_counts"]["cannot_check"] for r in by_cell[c]]
                       for c in CELLS},
    }


if __name__ == "__main__":
    main()
