"""Model families, ensembles for uncertainty, and fairness mitigation.

Families implemented (PRD F5):

``ridge``
    Regularised linear regression — the interpretable continuous baseline.
``logistic``
    Multinomial logistic regression for disease stage, plus an ordinal
    cumulative-link variant evaluated alongside it (PRD F7 asks whether an
    ordinal representation beats plain multiclass).
``gradient_boosting``
    HistGradientBoosting — the nonlinear comparator.

Every model is trained as a bootstrap **deep ensemble** so that predictive
spread is available for the uncertainty analysis without relying on a raw
"confidence score" (PRD F10).

Mitigation methods (PRD F9) are applied only through training weights, so the
evaluation data is never touched:

``none``          standard training.
``reweighting``   inverse group frequency over a predeclared subgroup axis.
``group_aware``   two rounds of worst-group upweighting (a group-DRO step).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from neurolens.config import NeuroLensConfig

__all__ = [
    "TrainedModel",
    "OrdinalBinaryDecomposition",
    "make_estimator",
    "mitigation_weights",
    "train_model",
]


# --------------------------------------------------------------------------- #
# Ordinal regression by cumulative binary decomposition
# --------------------------------------------------------------------------- #
class OrdinalBinaryDecomposition(BaseEstimator, ClassifierMixin):
    """Cumulative-link ordinal classifier built from binary logistic models.

    For ordered classes ``c_0 < c_1 < ... < c_{K-1}`` it fits ``K-1`` binary
    models for ``P(Y > c_k)`` and recombines them into a monotone probability
    vector. This preserves the ordering information that plain multinomial
    logistic regression discards, which is what PRD F7 asks to be evaluated.

    The ordering is the model: pass ``class_order`` in ascending severity.
    Without it the labels fall back to an alphabetical sort, which is only
    correct if the label strings happen to sort into the intended order — so
    the resolved order is always recorded in :attr:`class_order_` and surfaced
    in ``describe()`` for the audit trail.
    """

    def __init__(self, C: float = 0.5, max_iter: int = 2000,
                 class_order: Optional[Sequence[Any]] = None) -> None:
        self.C = C
        self.max_iter = max_iter
        self.class_order = class_order

    def fit(self, X: np.ndarray, y: np.ndarray, sample_weight: Optional[np.ndarray] = None):
        y = np.asarray(y)
        observed = {str(v) for v in pd.unique(y)}
        declared = [str(v) for v in (self.class_order or [])]
        # Keep the declared relative order, restricted to the labels that are
        # actually present; any label outside the declaration is appended in
        # sorted order so the estimator degrades predictably rather than failing.
        ordered = [label for label in declared if label in observed]
        extra = sorted(observed - set(declared))
        self.classes_ = np.array(ordered + extra)
        self.class_order_ = list(self.classes_)
        self.class_order_source_ = "declared" if ordered else "alphabetical_fallback"
        order = {value: i for i, value in enumerate(self.classes_)}
        ranks = np.array([order[str(value)] for value in y])
        self.models_: List[LogisticRegression] = []
        for k in range(len(self.classes_) - 1):
            target = (ranks > k).astype(int)
            if target.sum() == 0 or target.sum() == len(target):
                self.models_.append(None)  # type: ignore[arg-type]
                continue
            model = LogisticRegression(C=self.C, max_iter=self.max_iter)
            model.fit(X, target, sample_weight=sample_weight)
            self.models_.append(model)
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """Monotone class probabilities from the cumulative-link models.

        The survival vector has ``K+1`` entries — ``S_0 = 1``, ``S_k = P(Y > c_{k-1})``,
        and ``S_K = 0`` — so that differencing yields exactly ``K`` probability
        masses, one per class.
        """
        n = X.shape[0]
        n_classes = len(self.classes_)
        survival = np.ones((n, n_classes + 1))
        survival[:, -1] = 0.0
        for k, model in enumerate(self.models_):
            if model is None:
                survival[:, k + 1:] = 0.0
                continue
            probability = model.predict_proba(X)
            column = int(np.flatnonzero(model.classes_ == 1)[0])
            survival[:, k + 1] = probability[:, column]
        # Enforce a non-increasing survival curve, then re-anchor the ends.
        survival = np.minimum.accumulate(survival, axis=1)
        survival[:, 0] = 1.0
        survival[:, -1] = 0.0
        survival = np.clip(survival, 0.0, 1.0)
        probabilities = -np.diff(survival, axis=1)
        probabilities = np.clip(probabilities, 1e-6, None)
        return probabilities / probabilities.sum(axis=1, keepdims=True)

    def predict(self, X: np.ndarray) -> np.ndarray:
        return self.classes_[np.argmax(self.predict_proba(X), axis=1)]


# --------------------------------------------------------------------------- #
# Estimator factory
# --------------------------------------------------------------------------- #
def make_estimator(family: str, task: str, cfg: NeuroLensConfig) -> Any:
    """Return an unfitted estimator for a family/task pair."""
    spec = cfg.model
    if task == "continuous":
        if family == "ridge":
            return Pipeline([
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=spec.ridge_alpha)),
            ])
        if family == "gradient_boosting":
            return HistGradientBoostingRegressor(
                max_depth=spec.gbt_max_depth, max_iter=spec.gbt_max_iter,
                learning_rate=spec.gbt_learning_rate,
                min_samples_leaf=spec.gbt_min_samples_leaf,
                l2_regularization=1.0, random_state=cfg.seed,
            )
        raise ValueError(f"family '{family}' does not support the continuous task")

    if family == "logistic":
        return Pipeline([
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=spec.logistic_C, max_iter=3000)),
        ])
    if family == "ordinal":
        # cfg.target.stage_labels is declared in cutpoint order (lowest score
        # first), so ascending severity is its reverse. An ordinal model is
        # defined by that order; alphabetical label sorting would silently fit
        # the cumulative thresholds on the wrong ranking.
        return Pipeline([
            ("scale", StandardScaler()),
            ("model", OrdinalBinaryDecomposition(
                C=spec.logistic_C,
                class_order=list(reversed(cfg.target.stage_labels)))),
        ])
    if family == "gradient_boosting":
        return HistGradientBoostingClassifier(
            max_depth=spec.gbt_max_depth, max_iter=spec.gbt_max_iter,
            learning_rate=spec.gbt_learning_rate,
            min_samples_leaf=spec.gbt_min_samples_leaf,
            l2_regularization=1.0, random_state=cfg.seed,
        )
    raise ValueError(f"family '{family}' does not support the stage task")


# --------------------------------------------------------------------------- #
# Mitigation weights
# --------------------------------------------------------------------------- #
def mitigation_weights(groups: pd.Series, mitigation: str,
                       error_by_group: Optional[Dict[Any, float]] = None,
                       power: float = 1.0) -> Optional[np.ndarray]:
    """Training weights for a mitigation strategy. Never uses outcome data."""
    values = groups.astype("object").fillna("<missing>")
    n = len(values)
    if n == 0:
        return None
    if mitigation == "none":
        return None

    if mitigation == "reweighting":
        frequencies = values.value_counts()
        weights = values.map(lambda g: 1.0 / max(1, int(frequencies.get(g, 1)))).astype(float)
        return (weights / weights.mean()).to_numpy()

    if mitigation == "group_aware":
        if not error_by_group:
            return mitigation_weights(groups, "reweighting")
        errors = {g: max(float(e), 1e-6) for g, e in error_by_group.items()}
        weights = values.map(lambda g: errors.get(g, np.median(list(errors.values()))) ** power)
        weights = weights.astype(float)
        return (weights / weights.mean()).to_numpy()

    raise ValueError(f"unknown mitigation '{mitigation}'")


# --------------------------------------------------------------------------- #
# Trained model
# --------------------------------------------------------------------------- #
@dataclass
class TrainedModel:
    family: str
    task: str
    comparison: str
    mitigation: str
    seed: int
    features: List[str]
    estimators: List[Any] = field(default_factory=list)
    classes_: Optional[np.ndarray] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    # -- prediction ------------------------------------------------------ #
    def _matrix(self, X: pd.DataFrame) -> np.ndarray:
        missing = [f for f in self.features if f not in X.columns]
        if missing:
            raise KeyError(f"model expects features absent from the frame: {missing[:5]}")
        return X[self.features].to_numpy(dtype=float)

    def predict_members(self, X: pd.DataFrame) -> np.ndarray:
        matrix = self._matrix(X)
        return np.vstack([
            np.asarray(estimator.predict(matrix), dtype=float).ravel()
            for estimator in self.estimators
        ])

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self.predict_members(X).mean(axis=0)

    def predict_std(self, X: pd.DataFrame) -> np.ndarray:
        members = self.predict_members(X)
        return members.std(axis=0, ddof=1) if members.shape[0] > 1 else np.zeros(len(X))

    def predict_proba(self, X: pd.DataFrame) -> np.ndarray:
        matrix = self._matrix(X)
        stack = [estimator.predict_proba(matrix) for estimator in self.estimators]
        return np.mean(stack, axis=0)

    def predict_stage(self, X: pd.DataFrame) -> np.ndarray:
        classes = self.classes_ if self.classes_ is not None else self.estimators[0].classes_
        return np.asarray(classes)[np.argmax(self.predict_proba(X), axis=1)]

    def describe(self) -> Dict[str, Any]:
        return {
            "family": self.family,
            "task": self.task,
            "comparison": self.comparison,
            "mitigation": self.mitigation,
            "seed": self.seed,
            "n_features": len(self.features),
            "features": self.features,
            "n_ensemble_members": len(self.estimators),
            "classes": [str(c) for c in (self.classes_ if self.classes_ is not None else [])],
            "metadata": self.metadata,
        }


def train_model(
    family: str,
    task: str,
    comparison: str,
    mitigation: str,
    X: pd.DataFrame,
    y: np.ndarray,
    features: Sequence[str],
    cfg: NeuroLensConfig,
    groups: Optional[pd.Series] = None,
    seed: Optional[int] = None,
    n_members: Optional[int] = None,
) -> TrainedModel:
    """Fit a bootstrap ensemble for one family/task/comparison/mitigation cell."""
    seed = int(seed if seed is not None else cfg.seed)
    n_members = int(n_members if n_members is not None else cfg.model.ensemble_members)
    X = X[list(features)]
    y = np.asarray(y)
    rng = np.random.default_rng(seed)

    if groups is None:
        groups = pd.Series(["all"] * len(X), index=X.index)

    base_weights = mitigation_weights(groups, mitigation) if mitigation != "group_aware" else None
    metadata: Dict[str, Any] = {"mitigation_rounds": 1, "bootstrap": True}

    estimators: List[Any] = []
    for member in range(n_members):
        estimator = make_estimator(family, task, cfg)
        index = rng.integers(0, len(X), size=len(X))
        # Guarantee both classes survive the bootstrap when there are only two.
        if task == "stage" and len(np.unique(y)) > 1:
            for label in np.unique(y):
                positions = np.flatnonzero(y == label)
                if len(positions) and label not in y[index]:
                    index[member % len(index)] = positions[0]
        weights = None if base_weights is None else base_weights[index]
        fit_args: Dict[str, Any] = {}
        if weights is not None:
            fit_args["sample_weight" if not isinstance(estimator, Pipeline) else "model__sample_weight"] = weights
        try:
            estimator.fit(X.to_numpy(dtype=float)[index], y[index], **fit_args)
        except TypeError:
            estimator.fit(X.to_numpy(dtype=float)[index], y[index])
        estimators.append(estimator)

    classes = None
    if task == "stage":
        classes = estimators[0].classes_ if hasattr(estimators[0], "classes_") else np.unique(y)
        if isinstance(estimators[0], Pipeline) and hasattr(estimators[0].named_steps["model"], "classes_"):
            classes = estimators[0].named_steps["model"].classes_
        step = estimators[0].named_steps["model"] if isinstance(estimators[0], Pipeline) else estimators[0]
        if hasattr(step, "class_order_"):
            # The ordering is part of the model definition, so it belongs in the
            # audit trail next to the seed and the hyperparameters.
            metadata["ordinal_class_order"] = [str(v) for v in step.class_order_]
            metadata["ordinal_order_source"] = step.class_order_source_

    model = TrainedModel(
        family=family, task=task, comparison=comparison, mitigation=mitigation,
        seed=seed, features=list(features), estimators=estimators,
        classes_=classes, metadata=metadata,
    )

    # Group-aware mitigation: one worst-group upweighting round (group DRO).
    if mitigation == "group_aware" and groups is not None and len(np.unique(groups)) > 1:
        predictions = model.predict(X) if task == "continuous" else None
        error_by_group: Dict[Any, float] = {}
        if predictions is not None:
            residual = np.abs(np.asarray(y, dtype=float) - predictions)
            for label, position in pd.Series(range(len(y))).groupby(groups.to_numpy()):
                error_by_group[label] = float(residual[position.to_numpy()].mean())
        else:
            predicted_stage = model.predict_stage(X)
            incorrect = (np.asarray(predicted_stage, dtype=str) != np.asarray(y, dtype=str)).astype(float)
            for label, position in pd.Series(range(len(y))).groupby(groups.to_numpy()):
                error_by_group[label] = float(incorrect[position.to_numpy()].mean())

        second = mitigation_weights(groups, "group_aware", error_by_group)
        model.metadata.update(mitigation_rounds=2, error_by_group={str(k): v for k, v in error_by_group.items()})
        rng2 = np.random.default_rng(seed + 991)
        estimators2: List[Any] = []
        for _ in range(n_members):
            estimator = make_estimator(family, task, cfg)
            index = rng2.integers(0, len(X), size=len(X))
            weights = second[index]
            fit_args = {}
            if weights is not None:
                fit_args["sample_weight" if not isinstance(estimator, Pipeline)
                           else "model__sample_weight"] = weights
            try:
                estimator.fit(X.to_numpy(dtype=float)[index], y[index], **fit_args)
            except TypeError:
                estimator.fit(X.to_numpy(dtype=float)[index], y[index])
            estimators2.append(estimator)
        model.estimators = estimators2

    return model
