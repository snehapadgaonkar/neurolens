"""Global and patient-level explanations with neuroanatomical labelling.

Global explanations use permutation importance: it is model-agnostic and, unlike
gain-based importances, cannot credit a feature that carries no predictive signal
once shuffled.

Patient-level explanations use KernelSHAP — a local additive attribution solved
by weighted regression over feature coalitions, with absent features drawn from
a background sample. The attributions satisfy
``f(x) ≈ base + Σ φ_i``, and the residual of that identity is reported so a
reader can see how much of the prediction the explanation actually accounts for.

PRD F11 requires the association/causation distinction to travel with every
explanation, so :func:`explain_case` returns it as part of the payload rather
than leaving it to the view layer.
"""

from __future__ import annotations

import math
from itertools import combinations
from typing import Any, Callable, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd

from neurolens.schema import anatomical_label, region_family

__all__ = [
    "permutation_importance",
    "kernel_shap",
    "explain_case",
    "CAUSATION_NOTICE",
]

CAUSATION_NOTICE = (
    "Model association is not biological causation. These attributions describe "
    "what the fitted model used, not what causes disease progression."
)


def _score(truth: np.ndarray, prediction: np.ndarray, task: str) -> float:
    if task == "continuous":
        return float(np.mean(np.abs(np.asarray(truth, dtype=float) - prediction)))
    return float(np.mean(np.asarray(truth, dtype=str) != np.asarray(prediction, dtype=str)))


def permutation_importance(predict_fn: Callable[[pd.DataFrame], np.ndarray],
                           X: pd.DataFrame, y: np.ndarray, task: str,
                           n_repeats: int = 10, seed: int = 0) -> pd.DataFrame:
    """Model-agnostic permutation importance (lower score is better)."""
    rng = np.random.default_rng(seed)
    baseline = _score(y, predict_fn(X), task)
    rows: List[Dict[str, Any]] = []
    for column in X.columns:
        deltas: List[float] = []
        for _ in range(n_repeats):
            permuted = X.copy()
            permuted[column] = rng.permutation(permuted[column].to_numpy())
            deltas.append(_score(y, predict_fn(permuted), task) - baseline)
        deltas_array = np.asarray(deltas, dtype=float)
        rows.append({
            "feature": column,
            "importance": float(deltas_array.mean()),
            "importance_sd": float(deltas_array.std(ddof=1)) if len(deltas_array) > 1 else 0.0,
            "baseline_score": float(baseline),
            "metric": "mae" if task == "continuous" else "error_rate",
        })
    return pd.DataFrame(rows).sort_values("importance", ascending=False).reset_index(drop=True)


def kernel_shap(predict_fn: Callable[[np.ndarray], np.ndarray],
                x: np.ndarray, background: np.ndarray,
                n_coalitions: int = 256, seed: int = 777,
                exact_below: int = 10) -> Dict[str, Any]:
    """Local SHAP values by KernelSHAP with a background (interventional) sample.

    Returns ``{"values": φ, "base": E[f(background)], "prediction": f(x),
    "reconstruction": base + Σφ, "residual": prediction - reconstruction,
    "n_coalitions": n}``.
    """
    x = np.asarray(x, dtype=float).ravel()
    background = np.asarray(background, dtype=float)
    n_features = len(x)
    n_background = len(background)
    rng = np.random.default_rng(seed)

    if n_features <= exact_below:
        coalitions = []
        for size in range(1, n_features):
            for subset in combinations(range(n_features), size):
                coalitions.append(subset)
    else:
        coalitions = []
        seen = set()
        attempts = 0
        while len(coalitions) < n_coalitions and attempts < n_coalitions * 20:
            attempts += 1
            size = int(rng.integers(1, n_features))
            subset = tuple(sorted(rng.choice(n_features, size=size, replace=False).tolist()))
            if subset in seen:
                continue
            seen.add(subset)
            coalitions.append(subset)

    n_coalitions = len(coalitions)
    design = np.zeros((n_coalitions, n_features), dtype=float)
    weights = np.zeros(n_coalitions, dtype=float)
    targets = np.zeros(n_coalitions, dtype=float)

    for i, subset in enumerate(coalitions):
        design[i, list(subset)] = 1.0
        size = len(subset)
        weights[i] = (n_features - 1) / (
            math.comb(n_features, size) * size * (n_features - size)
        )
        # Interventional expectation: present features take x, absent ones are
        # drawn from the background sample.
        tiled = np.tile(background, (1, 1)).copy()
        tiled[:, list(subset)] = x[list(subset)]
        targets[i] = float(np.mean(predict_fn(tiled)))

    base_value = float(np.mean(predict_fn(background)))
    prediction = float(predict_fn(x.reshape(1, -1))[0])
    target_total = prediction - base_value

    # Weighted least squares with the efficiency constraint Σφ = f(x) - base,
    # imposed as a heavily weighted extra row.
    sqrt_w = np.sqrt(weights)
    A = design * sqrt_w[:, None]
    b = targets * sqrt_w
    constraint_weight = 1e6 * max(1.0, float(np.max(weights)))
    A = np.vstack([A, np.ones((1, n_features)) * constraint_weight])
    b = np.concatenate([b, [target_total * constraint_weight]])
    values, *_ = np.linalg.lstsq(A, b, rcond=None)

    reconstruction = base_value + float(values.sum())
    return {
        "values": values,
        "base": base_value,
        "prediction": prediction,
        "reconstruction": reconstruction,
        "residual": prediction - reconstruction,
        "n_coalitions": n_coalitions,
        "n_background": int(n_background),
    }


def _feature_family(feature: str, families: Dict[str, str]) -> str:
    return families.get(feature, "other")


def explain_case(model: Any, row: pd.DataFrame, background: pd.DataFrame,
                 features: Sequence[str], families: Dict[str, str],
                 labels: Optional[Dict[str, str]] = None,
                 n_coalitions: int = 256, seed: int = 777,
                 top_k: int = 8) -> Dict[str, Any]:
    """Full patient-level explanation payload for one prediction."""
    labels = labels or {}
    feature_list = list(features)
    x_row = row[feature_list].to_numpy(dtype=float).ravel()
    background_matrix = background[feature_list].to_numpy(dtype=float)

    def predict_fn(matrix: np.ndarray) -> np.ndarray:
        frame = pd.DataFrame(matrix, columns=feature_list)
        return np.asarray(model.predict(frame), dtype=float).ravel()

    result = kernel_shap(predict_fn, x_row, background_matrix,
                         n_coalitions=n_coalitions, seed=seed)
    values = result["values"]

    contributions: List[Dict[str, Any]] = []
    for feature, value in zip(feature_list, values):
        contributions.append({
            "feature": feature,
            "label": labels.get(feature, anatomical_label(feature)),
            "family": _feature_family(feature, families),
            "anatomical_system": region_family(feature.replace("mri_norm_", "").replace("mri_raw_", "")),
            "attribution": float(value),
            "direction": "increases predicted progression" if value > 0
            else ("decreases predicted progression" if value < 0 else "no contribution"),
            "value": float(x_row[feature_list.index(feature)]),
        })
    contributions.sort(key=lambda item: -abs(item["attribution"]))
    for rank, item in enumerate(contributions, start=1):
        item["rank"] = rank

    by_family: Dict[str, List[Dict[str, Any]]] = {}
    for item in contributions:
        by_family.setdefault(item["family"], []).append(item)

    total_absolute = float(sum(abs(item["attribution"]) for item in contributions)) or 1.0
    return {
        "patient_id": str(row["patient_id"].iloc[0]) if "patient_id" in row.columns else "",
        "prediction": result["prediction"],
        "base_value": result["base"],
        "sum_of_attributions": float(values.sum()),
        "reconstruction": result["reconstruction"],
        "residual": result["residual"],
        "residual_fraction": abs(result["residual"]) / max(abs(result["prediction"]), 1e-9),
        "n_coalitions": result["n_coalitions"],
        "n_background": result["n_background"],
        "top": contributions[:top_k],
        "contributions": contributions,
        "by_family": {
            family: sorted(items, key=lambda item: -abs(item["attribution"]))[:top_k]
            for family, items in by_family.items()
        },
        "share_of_absolute_attribution": {
            family: float(sum(abs(i["attribution"]) for i in items) / total_absolute)
            for family, items in by_family.items()
        },
        "causation_notice": CAUSATION_NOTICE,
        "explanation_version": "expl-v1",
    }
