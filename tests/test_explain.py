"""Tests for global and patient-level explanations."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neurolens.config import NeuroLensConfig
from neurolens.explain import (
    CAUSATION_NOTICE,
    explain_case,
    kernel_shap,
    permutation_importance,
)
from neurolens.models import train_model
from neurolens.schema import anatomical_label, region_family


def _linear_problem(n=200, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(n, 4))
    y = 2.0 * x[:, 0] - 1.0 * x[:, 1] + 0.0 * x[:, 2] + rng.normal(scale=0.1, size=n)
    frame = pd.DataFrame(x, columns=["strong_pos", "strong_neg", "irrelevant", "weak"])
    return frame, y


def test_permutation_importance_ranks_a_known_signal_first():
    frame, y = _linear_problem()
    importance = permutation_importance(
        lambda X: X["strong_pos"] * 2 - X["strong_neg"], frame, y, "continuous",
        n_repeats=6, seed=1)
    ordered = list(importance["feature"])
    assert ordered[0] == "strong_pos"
    assert ordered.index("strong_neg") < ordered.index("irrelevant")
    # A shuffled irrelevant column should not appear to matter.
    irrelevant = importance.set_index("feature").loc["irrelevant", "importance"]
    assert abs(irrelevant) < 0.05
    assert importance["metric"].iloc[0] == "mae"


def test_permutation_importance_uses_error_rate_for_classification():
    frame, y = _linear_problem(120)
    labels = (y > np.median(y)).astype(str)
    importance = permutation_importance(
        lambda X: (X["strong_pos"] > 0).astype(str), frame, labels, "stage",
        n_repeats=4, seed=2)
    assert importance["metric"].iloc[0] == "error_rate"


def test_kernel_shap_satisfies_the_efficiency_identity():
    rng = np.random.default_rng(3)
    background = rng.normal(size=(40, 5))

    def predict(matrix):
        return (matrix[:, 0] * 2 - matrix[:, 1] + 0.5 * matrix[:, 2] ** 2)

    x = np.array([1.2, -0.7, 0.4, 0.1, 2.0])
    result = kernel_shap(predict, x, background, n_coalitions=200, seed=5)
    assert result["values"].shape == (5,)
    assert abs(result["residual"]) < 1e-6, result["residual"]
    assert result["prediction"] == pytest.approx(result["base"] + result["values"].sum(), abs=1e-6)
    # Attributions follow the model's response, not the sign of the coefficient:
    # feature 0 has coefficient +2 at x=+1.2 (pushes the prediction up), feature 1
    # has coefficient -1 at x=-0.7 (also pushes it up), and feature 2 sits inside
    # the background range of x^2 (pushes it down).
    assert result["values"][0] > 0
    assert result["values"][1] > 0
    assert result["values"][2] < 0
    # The two features the model does not read receive no attribution.
    assert abs(result["values"][3]) < 0.05
    assert abs(result["values"][4]) < 0.05


def test_kernel_shap_uses_exact_enumeration_for_few_features():
    rng = np.random.default_rng(4)
    background = rng.normal(size=(20, 4))
    result = kernel_shap(lambda m: m.sum(axis=1), np.array([1.0, 1.0, 1.0, 1.0]),
                         background, n_coalitions=500, seed=6)
    # 2**4 - 2 = 14 coalitions when enumerating exactly.
    assert result["n_coalitions"] == 14
    assert abs(result["residual"]) < 1e-6


def test_explain_case_payload_is_complete_and_grouped():
    frame, y = _linear_problem(160, seed=8)
    config = NeuroLensConfig()
    config.model.ensemble_members = 3
    model = train_model("ridge", "continuous", "multimodal", "none",
                        frame, y, list(frame.columns), config)
    background = frame.sample(24, random_state=0)
    row = frame.iloc[[7]].copy()
    row.insert(0, "patient_id", ["patient-7"])

    payload = explain_case(
        model=model, row=row, background=background, features=list(frame.columns),
        families={c: "clinical" for c in frame.columns},
        labels={c: c.replace("_", " ") for c in frame.columns},
        n_coalitions=128, seed=9)

    assert payload["patient_id"] == "patient-7"
    assert payload["causation_notice"] == CAUSATION_NOTICE
    assert payload["explanation_version"] == "expl-v1"
    assert payload["n_background"] == 24
    assert abs(payload["residual"]) < 1e-6
    assert [item["rank"] for item in payload["top"]] == list(range(1, len(payload["top"]) + 1))
    assert "clinical" in payload["by_family"]
    assert sum(payload["share_of_absolute_attribution"].values()) == pytest.approx(1.0, abs=1e-6)
    for item in payload["contributions"]:
        assert item["direction"]
        assert "label" in item and "family" in item and "value" in item


def test_neuroanatomical_labels_and_systems():
    assert anatomical_label("Left-Caudate") == "Caudate nucleus (left)"
    assert anatomical_label("caudate_left") == "Caudate nucleus (left)"
    assert region_family("caudate_left") == "basal ganglia"
    assert region_family("lat_ventricle_left") == "ventricular"
    assert region_family("age_at_index") == ""
    # An unknown key still renders readably rather than raising.
    assert anatomical_label("some_new_feature") == "some new feature"
