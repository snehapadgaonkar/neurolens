"""Metrics, calibration, conformal intervals, and reliability analysis.

Every headline number in NeuroLens carries a bootstrap confidence interval and
a sample size, because PRD guardrail #2 forbids a fairness or performance claim
without them.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.metrics import (
    balanced_accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)

__all__ = [
    "bootstrap_ci",
    "regression_metrics",
    "classification_metrics",
    "calibration_regression",
    "calibration_classification_from_labels",
    "ConformalCalibrator",
    "interval_metrics",
    "risk_coverage",
    "uncertainty_error_association",
]


def bootstrap_ci(values: np.ndarray, statistic=np.mean, n_boot: int = 1000,
                 seed: int = 12345, alpha: float = 0.05) -> Tuple[float, float]:
    """Percentile bootstrap CI for an arbitrary statistic."""
    values = np.asarray(values, dtype=float)
    values = values[~np.isnan(values)]
    if len(values) < 3:
        point = float(statistic(values)) if len(values) else float("nan")
        return point, point
    rng = np.random.default_rng(seed)
    draws = np.empty(n_boot, dtype=float)
    for i in range(n_boot):
        sample = values[rng.integers(0, len(values), size=len(values))]
        draws[i] = statistic(sample)
    low = float(np.nanpercentile(draws, 100 * alpha / 2))
    high = float(np.nanpercentile(draws, 100 * (1 - alpha / 2)))
    return low, high


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray, n_boot: int = 1000,
                       seed: int = 12345) -> Dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = ~(np.isnan(y_true) | np.isnan(y_pred))
    y_true, y_pred = y_true[mask], y_pred[mask]
    n = int(len(y_true))
    if n == 0:
        return {"n": 0}
    absolute = np.abs(y_true - y_pred)
    mae_low, mae_high = bootstrap_ci(absolute, np.mean, n_boot, seed)
    squared = (y_true - y_pred) ** 2
    rmse_low, rmse_high = bootstrap_ci(squared, lambda v: float(np.sqrt(np.mean(v))), n_boot, seed + 1)
    return {
        "n": n,
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mae_ci": [mae_low, mae_high],
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "rmse_ci": [rmse_low, rmse_high],
        "r2": float(r2_score(y_true, y_pred)) if n > 1 else float("nan"),
        "bias": float(np.mean(y_pred - y_true)),
        "sd_true": float(np.std(y_true, ddof=1)) if n > 1 else float("nan"),
    }


def classification_metrics(y_true: np.ndarray, y_pred: np.ndarray,
                           probabilities: Optional[np.ndarray],
                           classes: Sequence[Any]) -> Dict[str, Any]:
    classes = list(classes)
    y_true = np.asarray(y_true, dtype=str)
    y_pred = np.asarray(y_pred, dtype=str)
    labels = [str(c) for c in classes]
    n = int(len(y_true))
    out: Dict[str, Any] = {"n": n, "classes": labels}
    if n == 0:
        return out
    out["macro_f1"] = float(f1_score(y_true, y_pred, labels=labels, average="macro",
                                     zero_division=0))
    out["balanced_accuracy"] = float(balanced_accuracy_score(y_true, y_pred))
    # Accuracy is reported but never presented as the primary metric (PRD F7).
    out["accuracy"] = float(np.mean(y_true == y_pred))
    out["confusion_matrix"] = confusion_matrix(y_true, y_pred, labels=labels).tolist()
    out["confusion_labels"] = labels

    per_class: Dict[str, Dict[str, float]] = {}
    for label in labels:
        support = int(np.sum(y_true == label))
        correct = int(np.sum((y_true == label) & (y_pred == label)))
        predicted = int(np.sum(y_pred == label))
        true_pos = int(np.sum((y_pred == label) & (y_true == label)))
        precision = true_pos / predicted if predicted else float("nan")
        recall = correct / support if support else float("nan")
        f1 = (2 * precision * recall / (precision + recall)
              if support and predicted and (precision + recall) > 0 else 0.0)
        per_class[label] = {"support": support, "predicted": predicted,
                            "precision": float(precision), "recall": float(recall), "f1": float(f1)}
    out["per_class"] = per_class

    if probabilities is not None and len(labels) > 1:
        probabilities = np.asarray(probabilities, dtype=float)
        if probabilities.shape[1] != len(labels):
            # Fail loudly in the artifact rather than silently reporting a wrong AUROC.
            out["auroc_ovr_macro"] = float("nan")
            out["auroc_note"] = (
                f"probability matrix has {probabilities.shape[1]} columns for "
                f"{len(labels)} classes; AUROC not computed"
            )
            return out
        try:
            if len(labels) == 2:
                # Binary: OvR macro-AUROC degenerates; score the positive class
                # directly, which is also what the per-class block reports.
                out["auroc_ovr_macro"] = float(roc_auc_score(
                    (y_true == labels[1]).astype(int), probabilities[:, 1]
                ))
            else:
                out["auroc_ovr_macro"] = float(roc_auc_score(
                    y_true, probabilities, multi_class="ovr", average="macro", labels=labels
                ))
        except ValueError:
            out["auroc_ovr_macro"] = float("nan")
        try:
            binary = [
                float(roc_auc_score((y_true == label).astype(int), probabilities[:, i]))
                for i, label in enumerate(labels)
                if 0 < np.sum(y_true == label) < n
            ]
            out["auroc_per_class"] = {
                label: value for label, value in zip(labels, [float("nan")] * len(labels))
            }
            index = 0
            for i, label in enumerate(labels):
                if 0 < np.sum(y_true == label) < n:
                    out["auroc_per_class"][label] = binary[index]
                    index += 1
        except ValueError:
            out["auroc_per_class"] = {}
        for i, label in enumerate(labels):
            mask = y_true == label
            if mask.sum() > 0:
                out.setdefault("brier_per_class", {})[label] = float(
                    brier_score_loss(mask.astype(int), probabilities[:, i])
                )
    return out


def calibration_regression(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, Any]:
    """Reliability of a continuous predictor: regress truth on prediction.

    A slope of 1 and intercept of 0 means predictions are neither over- nor
    under-dispersed relative to the observed outcome.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    mask = ~(np.isnan(y_true) | np.isnan(y_pred))
    y_true, y_pred = y_true[mask], y_pred[mask]
    if len(y_true) < 3 or np.std(y_pred) == 0:
        return {"n": int(len(y_true)), "slope": float("nan"), "intercept": float("nan"),
                "interpretation": "insufficient data"}
    slope, intercept, _r, _p, _se = stats.linregress(y_pred, y_true)
    if abs(slope - 1) < 0.15 and abs(intercept) < 0.15 * max(1e-9, np.std(y_true)):
        verdict = "calibrated"
    elif slope < 0.85:
        verdict = "over-dispersed (predictions more extreme than outcomes)"
    elif slope > 1.15:
        verdict = "under-dispersed (predictions shrunk toward the mean)"
    else:
        verdict = "mildly miscalibrated"
    return {"n": int(len(y_true)), "slope": float(slope), "intercept": float(intercept),
            "interpretation": verdict}




def calibration_classification_from_labels(y_true: np.ndarray, probabilities: np.ndarray,
                                           classes: Sequence[Any], n_bins: int = 10
                                           ) -> Dict[str, Any]:
    """Calibration using the model's own class ordering (preferred)."""
    labels = [str(c) for c in classes]
    label_index = {label: i for i, label in enumerate(labels)}
    truth = np.array([label_index.get(str(v), -1) for v in np.asarray(y_true)])
    confidence = probabilities.max(axis=1)
    predicted = probabilities.argmax(axis=1)
    edges = np.linspace(0, 1, n_bins + 1)
    table: List[Dict[str, Any]] = []
    ece = 0.0
    for i in range(n_bins):
        low, high = edges[i], edges[i + 1]
        mask = (confidence >= low) & (confidence <= high) if i == 0 else (confidence > low) & (confidence <= high)
        count = int(mask.sum())
        if count == 0:
            continue
        bin_accuracy = float(np.mean(predicted[mask] == truth[mask]))
        bin_confidence = float(confidence[mask].mean())
        ece += count / len(truth) * abs(bin_accuracy - bin_confidence)
        table.append({"bin": f"({low:.1f},{high:.1f}]", "n": count,
                      "confidence": bin_confidence, "accuracy": bin_accuracy})
    return {"n": int(len(truth)), "ece": float(ece), "reliability": table,
            "accuracy": float(np.mean(predicted == truth)), "n_classes": len(labels)}


# --------------------------------------------------------------------------- #
# Conformal prediction
# --------------------------------------------------------------------------- #
class ConformalCalibrator:
    """Split (and Mondrian/group-conditional) conformal prediction.

    Fitted on calibration residuals — never on the test set — so that the
    resulting interval has a finite-sample marginal coverage guarantee under
    exchangeability (PRD F10).
    """

    def __init__(self, alpha: float = 0.10, mode: str = "split") -> None:
        self.alpha = float(alpha)
        self.mode = mode
        self.quantiles_: Dict[Any, float] = {}
        self.global_quantile_: float = float("nan")
        self.n_calibration_ = 0

    def fit(self, residuals: np.ndarray, groups: Optional[np.ndarray] = None) -> "ConformalCalibrator":
        residuals = np.abs(np.asarray(residuals, dtype=float))
        residuals = residuals[~np.isnan(residuals)]
        self.n_calibration_ = int(len(residuals))
        self.global_quantile_ = self._quantile(residuals)
        self.quantiles_ = {}
        if self.mode == "mondrian" and groups is not None:
            groups = np.asarray(groups)
            for label in pd.unique(pd.Series(groups)):
                subset = residuals[groups == label]
                if len(subset) >= 5:
                    self.quantiles_[label] = self._quantile(subset)
        return self

    def _quantile(self, residuals: np.ndarray) -> float:
        n = len(residuals)
        if n == 0:
            return float("nan")
        level = np.ceil((n + 1) * (1 - self.alpha)) / n
        level = min(max(level, 0.0), 1.0)
        return float(np.quantile(residuals, level, method="higher"))

    def intervals(self, predictions: np.ndarray,
                  groups: Optional[np.ndarray] = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        predictions = np.asarray(predictions, dtype=float)
        if groups is not None and self.quantiles_:
            widths = np.array([
                self.quantiles_.get(label, self.global_quantile_) for label in np.asarray(groups)
            ])
        else:
            widths = np.full(len(predictions), self.global_quantile_)
        return predictions - widths, predictions + widths, widths

    def describe(self) -> Dict[str, Any]:
        return {
            "method": f"conformal-{self.mode}",
            "alpha": self.alpha,
            "target_coverage": 1 - self.alpha,
            "n_calibration": self.n_calibration_,
            "global_half_width": self.global_quantile_,
            "group_half_widths": {str(k): v for k, v in self.quantiles_.items()},
            "assumption": "exchangeability between calibration and test observations",
        }


def interval_metrics(y_true: np.ndarray, lower: np.ndarray, upper: np.ndarray,
                     alpha: float = 0.10) -> Dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float)
    lower = np.asarray(lower, dtype=float)
    upper = np.asarray(upper, dtype=float)
    mask = ~(np.isnan(y_true) | np.isnan(lower) | np.isnan(upper))
    y_true, lower, upper = y_true[mask], lower[mask], upper[mask]
    n = int(len(y_true))
    if n == 0:
        return {"n": 0}
    covered = (y_true >= lower) & (y_true <= upper)
    width = upper - lower
    z = stats.norm.ppf(1 - alpha / 2)
    winkler = float(np.mean(
        width + (2 / alpha) * np.maximum(lower - y_true, 0) + (2 / alpha) * np.maximum(y_true - upper, 0)
    ))
    return {
        "n": n,
        "target_coverage": 1 - alpha,
        "picp": float(np.mean(covered)),
        "mean_interval_width": float(np.mean(width)),
        "median_interval_width": float(np.median(width)),
        "winkler_score": winkler,
        "normal_reference_z": float(z),
    }


def risk_coverage(uncertainty: np.ndarray, absolute_error: np.ndarray,
                  steps: int = 10) -> Dict[str, Any]:
    """Selective prediction: error as a function of how much we abstain."""
    uncertainty = np.asarray(uncertainty, dtype=float)
    absolute_error = np.asarray(absolute_error, dtype=float)
    mask = ~(np.isnan(uncertainty) | np.isnan(absolute_error))
    uncertainty, absolute_error = uncertainty[mask], absolute_error[mask]
    n = len(absolute_error)
    if n == 0:
        return {"n": 0}
    order = np.argsort(uncertainty)
    sorted_error = absolute_error[order]
    curve = []
    for step in range(steps + 1):
        retained = max(1, int(round(n * (1 - step / steps))))
        curve.append({
            "abstention_fraction": round(step / steps, 3),
            "coverage": round(retained / n, 3),
            "n_retained": retained,
            "mae": float(np.mean(sorted_error[:retained])),
        })
    mae_values = [point["mae"] for point in curve]
    aurc = float(np.trapezoid(mae_values, dx=1.0 / steps)) if len(mae_values) > 1 else float("nan")
    return {
        "n": n,
        "curve": curve,
        "aurc": aurc,
        "mae_full": float(np.mean(absolute_error)),
        "mae_at_50pct_abstention": mae_values[len(mae_values) // 2],
    }


def uncertainty_error_association(uncertainty: np.ndarray,
                                  absolute_error: np.ndarray) -> Dict[str, Any]:
    """Does stated uncertainty actually track realised error? (PRD success metric)"""
    uncertainty = np.asarray(uncertainty, dtype=float)
    absolute_error = np.asarray(absolute_error, dtype=float)
    mask = ~(np.isnan(uncertainty) | np.isnan(absolute_error))
    uncertainty, absolute_error = uncertainty[mask], absolute_error[mask]
    if len(uncertainty) < 5:
        return {"n": int(len(uncertainty)), "spearman": float("nan"), "p_value": float("nan"),
                "verdict": "insufficient data"}
    rho, p_value = stats.spearmanr(uncertainty, absolute_error)
    if np.isnan(rho):
        verdict = "undefined (constant uncertainty)"
    elif rho >= 0.3 and p_value < 0.05:
        verdict = "uncertainty tracks error"
    elif rho > 0 and p_value < 0.05:
        verdict = "weak but significant association"
    else:
        verdict = "no reliable association — do not use for abstention"
    return {"n": int(len(uncertainty)), "spearman": float(rho), "p_value": float(p_value),
            "verdict": verdict}
