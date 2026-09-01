"""Fairness audit with explicit adequacy and PASS / WARN / INSUFFICIENT DATA.

PRD F8 forbids collapsing every subgroup into a binary fair/unfair label. Each
subgroup therefore carries three independent judgements:

**adequacy** — is there enough data to say anything at all?
    ``ADEQUATE`` (n >= ``min_subgroup_n``), ``EXPLORATORY`` (n >=
    ``min_reportable_n``), or ``INSUFFICIENT DATA``.
**status** — is the estimate concerning?
    ``PASS``, ``WARN``, or ``INSUFFICIENT DATA``.
**gap** — the difference from a predeclared reference group, with a bootstrap
    confidence interval on the gap itself, not just on the point estimate.

The reference group is the largest level of the axis, chosen before evaluation.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from neurolens.config import NeuroLensConfig
from neurolens.evaluation import bootstrap_ci

__all__ = [
    "ADEQUATE", "EXPLORATORY", "INSUFFICIENT",
    "PASS", "WARN",
    "adequacy_for",
    "audit_axis",
    "intersectional_audit",
    "worst_group_summary",
    "select_preferred_model",
]

ADEQUATE = "ADEQUATE"
EXPLORATORY = "EXPLORATORY"
INSUFFICIENT = "INSUFFICIENT DATA"

PASS = "PASS"
WARN = "WARN"


def adequacy_for(n: int, cfg: NeuroLensConfig) -> str:
    if n >= cfg.fairness.min_subgroup_n:
        return ADEQUATE
    if n >= cfg.fairness.min_reportable_n:
        return EXPLORATORY
    return INSUFFICIENT


def _metric_fn(task: str):
    if task == "continuous":
        return lambda truth, prediction: float(np.mean(np.abs(truth - prediction)))
    return lambda truth, prediction: float(1.0 - np.mean(np.asarray(truth) == np.asarray(prediction)))


def audit_axis(
    axis: str,
    groups: pd.Series,
    y_true: np.ndarray,
    y_pred: np.ndarray,
    task: str,
    cfg: NeuroLensConfig,
    calibration_gap: Optional[pd.Series] = None,
    n_boot: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Per-level audit rows for one fairness axis."""
    n_boot = int(n_boot if n_boot is not None else cfg.fairness.n_bootstrap)
    metric = _metric_fn(task)
    metric_name = "mae" if task == "continuous" else "error_rate"

    frame = pd.DataFrame({"group": np.asarray(groups, dtype=object),
                          "truth": np.asarray(y_true), "pred": np.asarray(y_pred)})
    frame["group"] = frame["group"].where(frame["group"].notna(), "<missing>")
    frame["group"] = frame["group"].astype(str)

    sizes = frame["group"].value_counts()
    if sizes.empty:
        return []
    reference = str(sizes.idxmax())

    rows: List[Dict[str, Any]] = []
    for level, count in sizes.items():
        block = frame[frame["group"] == level]
        adequacy = adequacy_for(int(count), cfg)
        if adequacy == INSUFFICIENT:
            rows.append({
                "axis": axis, "subgroup": level, "n": int(count), "metric": metric_name,
                "estimate": float("nan"), "ci": [float("nan"), float("nan")],
                "reference": reference, "gap": float("nan"),
                "gap_ci": [float("nan"), float("nan")], "relative_gap": float("nan"),
                "adequacy": adequacy, "status": INSUFFICIENT,
                "note": f"n={int(count)} is below the predeclared reportable minimum of "
                        f"{cfg.fairness.min_reportable_n}; no estimate is reported.",
            })
            continue

        estimate = metric(block["truth"].to_numpy(), block["pred"].to_numpy())
        low, high = bootstrap_ci(
            np.abs(block["truth"].to_numpy(dtype=float) - block["pred"].to_numpy(dtype=float))
            if task == "continuous"
            else (block["truth"].astype(str) != block["pred"].astype(str)).astype(float),
            np.mean, n_boot, cfg.fairness.bootstrap_seed,
        )

        reference_block = frame[frame["group"] == reference]
        reference_estimate = metric(reference_block["truth"].to_numpy(),
                                    reference_block["pred"].to_numpy())
        if level == reference:
            gap = 0.0
            gap_ci = [0.0, 0.0]
        else:
            if task == "continuous":
                own = np.abs(block["truth"].to_numpy(dtype=float) - block["pred"].to_numpy(dtype=float))
                other = np.abs(reference_block["truth"].to_numpy(dtype=float)
                               - reference_block["pred"].to_numpy(dtype=float))
            else:
                own = (block["truth"].astype(str) != block["pred"].astype(str)).astype(float).to_numpy()
                other = (reference_block["truth"].astype(str)
                         != reference_block["pred"].astype(str)).astype(float).to_numpy()
            rng = np.random.default_rng(cfg.fairness.bootstrap_seed)
            draws = np.empty(n_boot, dtype=float)
            for i in range(n_boot):
                draws[i] = (own[rng.integers(0, len(own), len(own))].mean()
                            - other[rng.integers(0, len(other), len(other))].mean())
            gap = float(estimate - reference_estimate)
            gap_ci = [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))]

        relative = gap / reference_estimate if reference_estimate else float("nan")
        # Only an adverse gap — worse than the reference group — is a fairness
        # concern. A large favourable gap is reported but not flagged as WARN,
        # since flagging better performance would misrepresent the finding.
        if np.isnan(relative):
            status = INSUFFICIENT
        elif adequacy == EXPLORATORY:
            status = WARN if relative > cfg.fairness.relative_gap_warn else PASS
        else:
            adverse = relative > cfg.fairness.relative_gap_warn and gap_ci[0] > 0
            status = WARN if adverse else PASS

        note = ""
        if np.isnan(relative):
            # A status with no stated reason is not evidence, so name the reason:
            # the reference group's error is zero, which makes a *relative* gap
            # undefined even though this subgroup is large enough to report.
            note = (f"reference-group {metric_name} is zero, so a relative gap is "
                    "undefined; the absolute estimate and its CI are still reported.")
        if adequacy == EXPLORATORY:
            note = (note + f" n={int(count)} is exploratory (below "
                    f"{cfg.fairness.min_subgroup_n}); do not treat as definitive.").strip()
        if not np.isnan(relative) and relative < -cfg.fairness.relative_gap_warn:
            note = (note + " Estimate is better than the reference group; not flagged as a "
                           "disparity.").strip()
        row = {
            "axis": axis, "subgroup": level, "n": int(count), "metric": metric_name,
            "estimate": float(estimate), "ci": [low, high], "reference": reference,
            "reference_estimate": float(reference_estimate),
            "gap": float(gap), "gap_ci": [float(gap_ci[0]), float(gap_ci[1])],
            "relative_gap": float(relative), "adequacy": adequacy, "status": status,
            "note": note,
        }
        if calibration_gap is not None:
            values = calibration_gap[block.index].to_numpy(dtype=float)
            values = values[~np.isnan(values)]
            if len(values):
                row["calibration_gap"] = float(np.mean(values))
                if abs(float(np.mean(values))) > cfg.fairness.calibration_gap_warn and status == PASS:
                    row["status"] = WARN
                    row["note"] = (row["note"] + " Calibration differs from the reference group.").strip()
        rows.append(row)
    return rows


def intersectional_audit(frame: pd.DataFrame, axes: Sequence[str], y_true: np.ndarray,
                         y_pred: np.ndarray, task: str, cfg: NeuroLensConfig
                         ) -> List[Dict[str, Any]]:
    """Intersectional cells, reported only where cell size permits."""
    metric = _metric_fn(task)
    available = [axis for axis in axes if axis in frame.columns]
    if len(available) < 2:
        return []
    keys = frame[available].astype(str).agg(" × ".join, axis=1)
    rows: List[Dict[str, Any]] = []
    for level, position in pd.Series(range(len(frame))).groupby(keys.to_numpy()):
        index = position.to_numpy()
        count = len(index)
        adequacy = adequacy_for(count, cfg)
        if adequacy == INSUFFICIENT:
            rows.append({"axes": " × ".join(available), "subgroup": str(level), "n": count,
                         "estimate": float("nan"), "adequacy": adequacy, "status": INSUFFICIENT,
                         "note": "cell too small to report"})
            continue
        rows.append({
            "axes": " × ".join(available), "subgroup": str(level), "n": count,
            "estimate": float(metric(np.asarray(y_true)[index], np.asarray(y_pred)[index])),
            "adequacy": adequacy,
            "status": WARN if adequacy == EXPLORATORY else PASS,
            "note": "" if adequacy == ADEQUATE else "exploratory cell size",
        })
    return sorted(rows, key=lambda row: -row["n"])


def worst_group_summary(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    reportable = [row for row in rows if row["status"] != INSUFFICIENT and not np.isnan(row["estimate"])]
    if not reportable:
        return {"worst_group": None, "worst_estimate": float("nan"),
                "best_group": None, "best_estimate": float("nan"),
                "spread": float("nan"), "n_reportable": 0,
                "note": "no subgroup met the reporting threshold"}
    worst = max(reportable, key=lambda row: row["estimate"])
    best = min(reportable, key=lambda row: row["estimate"])
    return {
        "worst_group": worst["subgroup"], "worst_axis": worst["axis"],
        "worst_estimate": worst["estimate"], "worst_n": worst["n"],
        "best_group": best["subgroup"], "best_axis": best["axis"],
        "best_estimate": best["estimate"], "best_n": best["n"],
        "spread": float(worst["estimate"] - best["estimate"]),
        "relative_spread": float((worst["estimate"] - best["estimate"]) / best["estimate"])
        if best["estimate"] else float("nan"),
        "n_reportable": len(reportable),
        "n_warn": sum(1 for row in reportable if row["status"] == WARN),
        "n_insufficient": sum(1 for row in rows if row["status"] == INSUFFICIENT),
    }


def select_preferred_model(candidates: Sequence[Dict[str, Any]],
                           cfg: NeuroLensConfig) -> Tuple[Optional[str], str]:
    """Apply the predeclared multi-objective selection rule (PRD F9).

    Prefer the candidate with the lowest worst-group error that does not degrade
    overall performance by more than ``max_overall_degradation`` relative to the
    unmitigated baseline.
    """
    if not candidates:
        return None, "no candidates evaluated"
    baseline = next((c for c in candidates if c.get("mitigation") == "none"), candidates[0])
    baseline_overall = float(baseline["overall"])
    tolerance = baseline_overall * (1 + cfg.model.max_overall_degradation)

    eligible = [c for c in candidates if float(c["overall"]) <= tolerance]
    if not eligible:
        return baseline.get("name"), (
            "no mitigated candidate stayed within the allowed overall degradation of "
            f"{cfg.model.max_overall_degradation:.0%}; retaining the unmitigated baseline"
        )
    preferred = min(eligible, key=lambda c: (float(c["worst_group"]), float(c["overall"])))
    improvement = float(baseline["worst_group"]) - float(preferred["worst_group"])
    cost = float(preferred["overall"]) - baseline_overall
    rationale = (
        f"'{preferred.get('name')}' lowers worst-group "
        f"{baseline.get('metric', 'error')} from {baseline['worst_group']:.4f} to "
        f"{preferred['worst_group']:.4f} ({improvement:+.4f}) at an overall cost of "
        f"{cost:+.4f}, within the predeclared {cfg.model.max_overall_degradation:.0%} budget."
    )
    if improvement <= 0:
        rationale = (
            f"'{preferred.get('name')}' does not improve the worst group over the unmitigated "
            "baseline within the allowed overall degradation; the baseline remains preferred."
        )
        preferred = baseline
    return preferred.get("name"), rationale
