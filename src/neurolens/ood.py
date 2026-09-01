"""Out-of-distribution detection.

Two complementary, well-understood feature-space methods (PRD F10 asks for "a
validated feature-space/density/distance method"):

* **Mahalanobis distance** to the training distribution under a regularised
  Gaussian fit — sensitive to global multivariate displacement.
* **k-nearest-neighbour distance** in standardised feature space — sensitive to
  local sparsity that a Gaussian fit can miss.

Each score is converted to a percentile against the *training* distribution so
the two are commensurable, then averaged. The flag threshold is a predeclared
training quantile, so no test information is used to set it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

__all__ = ["OodDetector", "evaluate_ood"]


class OodDetector:
    def __init__(self, method: str = "mahalanobis_knn", knn_k: int = 10,
                 threshold_quantile: float = 0.95, ridge: float = 1e-3) -> None:
        self.method = method
        self.knn_k = int(knn_k)
        self.threshold_quantile = float(threshold_quantile)
        self.ridge = float(ridge)
        self.mean_: Optional[np.ndarray] = None
        self.precision_: Optional[np.ndarray] = None
        self.neighbours_: Optional[NearestNeighbors] = None
        self.feature_names_: List[str] = []
        self._train_maha: Optional[np.ndarray] = None
        self._train_knn: Optional[np.ndarray] = None
        self.threshold_: float = float("nan")

    # -- fitting --------------------------------------------------------- #
    def fit(self, X: pd.DataFrame) -> "OodDetector":
        self.feature_names_ = list(X.columns)
        matrix = X.to_numpy(dtype=float)
        matrix = np.nan_to_num(matrix, nan=0.0)
        self.mean_ = matrix.mean(axis=0)
        centred = matrix - self.mean_
        covariance = np.cov(centred, rowvar=False)
        covariance = np.atleast_2d(covariance)
        scale = np.trace(covariance) / max(covariance.shape[0], 1)
        covariance = covariance + self.ridge * max(scale, 1e-9) * np.eye(covariance.shape[0])
        self.precision_ = np.linalg.pinv(covariance)

        neighbours = NearestNeighbors(n_neighbors=min(self.knn_k + 1, len(matrix)))
        neighbours.fit(matrix)
        self.neighbours_ = neighbours

        self._train_maha = self._mahalanobis(matrix)
        self._train_knn = self._knn_distance(matrix)
        combined = self._combine(self._train_maha, self._train_knn)
        self.threshold_ = float(np.quantile(combined, self.threshold_quantile))
        self.n_train_ = int(len(matrix))
        return self

    # -- internals ------------------------------------------------------- #
    def _mahalanobis(self, matrix: np.ndarray) -> np.ndarray:
        centred = matrix - self.mean_
        left = centred @ self.precision_
        return np.sqrt(np.maximum(np.einsum("ij,ij->i", left, centred), 0.0))

    def _knn_distance(self, matrix: np.ndarray) -> np.ndarray:
        distances, _ = self.neighbours_.kneighbors(matrix)
        k = min(self.knn_k, distances.shape[1] - 1)
        return distances[:, 1:k + 1].mean(axis=1)

    @staticmethod
    def _percentile_against_train(values: np.ndarray, train: np.ndarray) -> np.ndarray:
        ordered = np.sort(train)
        positions = np.searchsorted(ordered, values, side="right")
        return positions / max(len(ordered), 1)

    def _combine(self, maha: np.ndarray, knn: np.ndarray) -> np.ndarray:
        if self.method == "mahalanobis":
            return self._percentile_against_train(maha, self._train_maha)
        if self.method == "knn":
            return self._percentile_against_train(knn, self._train_knn)
        return 0.5 * (
            self._percentile_against_train(maha, self._train_maha)
            + self._percentile_against_train(knn, self._train_knn)
        )

    # -- scoring --------------------------------------------------------- #
    def score(self, X: pd.DataFrame) -> np.ndarray:
        if self.precision_ is None:
            raise RuntimeError("OodDetector.score called before fit")
        matrix = X[self.feature_names_].to_numpy(dtype=float)
        matrix = np.nan_to_num(matrix, nan=0.0)
        return self._combine(self._mahalanobis(matrix), self._knn_distance(matrix))

    def flag(self, X: pd.DataFrame) -> np.ndarray:
        return self.score(X) > self.threshold_

    def describe(self) -> Dict[str, Any]:
        return {
            "method": self.method,
            "knn_k": self.knn_k,
            "threshold_quantile": self.threshold_quantile,
            "threshold": self.threshold_,
            "n_train": getattr(self, "n_train_", 0),
            "n_features": len(self.feature_names_),
            "interpretation": (
                "Score is the average percentile rank of Mahalanobis and kNN distance "
                "against the training distribution. Values above the predeclared "
                f"{self.threshold_quantile:.0%} training quantile are flagged OOD."
            ),
        }


def evaluate_ood(scores: np.ndarray, shift_flag: np.ndarray,
                 absolute_error: Optional[np.ndarray] = None,
                 uncertainty: Optional[np.ndarray] = None,
                 interval_width: Optional[np.ndarray] = None,
                 n_boot: int = 1000, seed: int = 12345) -> Dict[str, Any]:
    """Does OOD detection actually identify less reliable cases?

    Compares in-distribution against flagged/shift cases on error, uncertainty,
    and interval width, and reports the AUROC of the score against the shift
    label. All comparisons carry sample sizes.
    """
    from sklearn.metrics import roc_auc_score

    scores = np.asarray(scores, dtype=float)
    shift = np.asarray(shift_flag).astype(bool)
    out: Dict[str, Any] = {
        "n": int(len(scores)),
        "n_flagged_shift": int(shift.sum()),
        "n_in_distribution": int((~shift).sum()),
    }
    if shift.sum() == 0 or (~shift).sum() == 0:
        out["verdict"] = "shift cohort empty or full — cannot evaluate OOD detection"
        return out

    out["auroc_shift_detection"] = float(roc_auc_score(shift.astype(int), scores))
    rng = np.random.default_rng(seed)
    for name, values in (("absolute_error", absolute_error), ("uncertainty", uncertainty),
                         ("interval_width", interval_width)):
        if values is None:
            continue
        values = np.asarray(values, dtype=float)
        shifted = values[shift]
        in_dist = values[~shift]
        shifted = shifted[~np.isnan(shifted)]
        in_dist = in_dist[~np.isnan(in_dist)]
        if len(shifted) == 0 or len(in_dist) == 0:
            continue
        # Bootstrap the difference of group means: the two groups differ in size,
        # so an element-wise difference would be meaningless.
        draws = np.array([
            shifted[rng.integers(0, len(shifted), len(shifted))].mean()
            - in_dist[rng.integers(0, len(in_dist), len(in_dist))].mean()
            for _ in range(n_boot)
        ])
        difference = float(shifted.mean() - in_dist.mean())
        out[name] = {
            "n_shift": int(len(shifted)),
            "n_in_distribution": int(len(in_dist)),
            "mean_in_distribution": float(in_dist.mean()),
            "mean_shift": float(shifted.mean()),
            "difference": difference,
            "difference_ci": [float(np.percentile(draws, 2.5)), float(np.percentile(draws, 97.5))],
            "shift_is_worse": bool(difference > 0),
        }

    auroc = out["auroc_shift_detection"]
    error_block = out.get("absolute_error")
    if auroc >= 0.6 and error_block and error_block["shift_is_worse"]:
        out["verdict"] = (
            "OOD score separates the shift cohort and shift cases are less accurate"
        )
    elif auroc >= 0.6:
        out["verdict"] = "OOD score separates the shift cohort; error difference inconclusive"
    else:
        out["verdict"] = "OOD score does not separate the shift cohort — treat flags as advisory"
    return out
