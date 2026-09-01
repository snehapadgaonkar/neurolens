"""Tests for model families, ordinal regression, ensembles, and mitigation."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neurolens.config import NeuroLensConfig
from neurolens.models import (
    OrdinalBinaryDecomposition,
    make_estimator,
    mitigation_weights,
    train_model,
)


def _frame(n=120, seed=0):
    rng = np.random.default_rng(seed)
    x1 = rng.normal(size=n)
    x2 = rng.normal(size=n)
    y = 0.8 * x1 - 0.4 * x2 + rng.normal(scale=0.2, size=n)
    return pd.DataFrame({"f1": x1, "f2": x2}), y


def test_ridge_recovers_a_known_linear_signal():
    X, y = _frame()
    config = NeuroLensConfig()
    config.model.ensemble_members = 3
    model = train_model("ridge", "continuous", "multimodal", "none",
                        X, y, ["f1", "f2"], config)
    prediction = model.predict(X)
    assert np.corrcoef(prediction, y)[0, 1] > 0.95
    assert model.predict_members(X).shape == (3, len(X))
    assert model.predict_std(X).shape == (len(X),)


SEVERITY_ORDER = ["no_impairment", "mild", "moderate_or_worse"]


def test_ordinal_probabilities_have_one_column_per_class_and_sum_to_one():
    rng = np.random.default_rng(1)
    n = 200
    x = rng.normal(size=(n, 2))
    latent = x[:, 0]
    y = np.where(latent > 0.6, "moderate_or_worse",
                 np.where(latent > -0.3, "mild", "no_impairment"))
    model = OrdinalBinaryDecomposition(C=1.0, class_order=SEVERITY_ORDER).fit(x, y)
    probabilities = model.predict_proba(x)

    assert probabilities.shape == (n, 3), probabilities.shape
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-8)
    assert (probabilities >= 0).all()
    # The declared severity order must be honoured, not sorted alphabetically.
    assert [str(c) for c in model.classes_] == SEVERITY_ORDER
    assert model.class_order_source_ == "declared"
    # A strongly positive latent score should favour the most severe class.
    strong = model.predict_proba(np.array([[3.0, 0.0]]))
    assert strong[0].argmax() == SEVERITY_ORDER.index("moderate_or_worse")


def test_ordinal_class_order_is_declared_restricted_or_falls_back_explicitly():
    rng = np.random.default_rng(6)
    x = rng.normal(size=(120, 2))
    y = np.where(x[:, 0] > 0.5, "moderate_or_worse",
                 np.where(x[:, 0] > -0.5, "mild", "no_impairment"))

    # A label absent from the training data must not disturb the declared order.
    binary = OrdinalBinaryDecomposition(C=1.0, class_order=SEVERITY_ORDER)
    binary.fit(x, np.where(y == "moderate_or_worse", "mild", y))
    assert [str(c) for c in binary.classes_] == ["no_impairment", "mild"]

    # An undeclared label is appended in sorted order and the fallback is recorded.
    partial = OrdinalBinaryDecomposition(C=1.0, class_order=["no_impairment", "mild"]).fit(x, y)
    assert [str(c) for c in partial.classes_] == SEVERITY_ORDER

    # With no declaration at all the model falls back to alphabetical order, and
    # says so — this is the case the audit trail must expose.
    fallback = OrdinalBinaryDecomposition(C=1.0).fit(x, y)
    assert [str(c) for c in fallback.classes_] == ["mild", "moderate_or_worse", "no_impairment"]
    assert fallback.class_order_source_ == "alphabetical_fallback"


def test_ordinal_handles_a_degenerate_class():
    rng = np.random.default_rng(2)
    x = rng.normal(size=(60, 2))
    y = np.array(["a"] * 55 + ["b"] * 5)
    model = OrdinalBinaryDecomposition(C=1.0).fit(x, y)
    probabilities = model.predict_proba(x)
    assert probabilities.shape == (60, 2)
    assert np.allclose(probabilities.sum(axis=1), 1.0, atol=1e-8)


def test_ordinal_beats_or_matches_multinomial_on_rank_error():
    """PRD F7: evaluate whether an ordinal representation is better than plain
    multiclass for an ordered outcome."""
    from sklearn.metrics import mean_absolute_error

    rng = np.random.default_rng(3)
    n = 600
    x = rng.normal(size=(n, 3))
    latent = x[:, 0] + 0.5 * x[:, 1]
    # The real NeuroLens stage vocabulary, so the declared order is exercised.
    order = SEVERITY_ORDER
    y = np.array(order)[np.digitize(latent, [-0.8, 0.5])]
    rank = {label: i for i, label in enumerate(order)}

    config = NeuroLensConfig()
    config.model.ensemble_members = 3
    ordinal = train_model("ordinal", "stage", "multimodal", "none",
                          pd.DataFrame(x, columns=["a", "b", "c"]), y,
                          ["a", "b", "c"], config)
    multinomial = train_model("logistic", "stage", "multimodal", "none",
                              pd.DataFrame(x, columns=["a", "b", "c"]), y,
                              ["a", "b", "c"], config)
    frame = pd.DataFrame(x, columns=["a", "b", "c"])
    truth = np.array([rank[v] for v in y])
    ordinal_mae = mean_absolute_error(truth, [rank[v] for v in ordinal.predict_stage(frame)])
    multiclass_mae = mean_absolute_error(truth, [rank[v] for v in multinomial.predict_stage(frame)])
    assert ordinal_mae <= multiclass_mae + 0.05
    assert ordinal.metadata["ordinal_class_order"] == SEVERITY_ORDER
    assert ordinal.metadata["ordinal_order_source"] == "declared"


def test_make_estimator_rejects_invalid_combinations():
    config = NeuroLensConfig()
    with pytest.raises(ValueError):
        make_estimator("logistic", "continuous", config)
    with pytest.raises(ValueError):
        make_estimator("ridge", "stage", config)
    with pytest.raises(ValueError):
        make_estimator("not_a_family", "continuous", config)


def test_reweighting_equalises_group_frequency():
    groups = pd.Series(["a"] * 90 + ["b"] * 10)
    weights = mitigation_weights(groups, "reweighting")
    assert weights is not None
    assert weights.mean() == pytest.approx(1.0, rel=1e-6)
    # Total weight mass per group must be equal after reweighting.
    mass = pd.Series(weights).groupby(groups).sum()
    assert mass["a"] == pytest.approx(mass["b"], rel=1e-6)


def test_group_aware_upweights_the_worst_group():
    groups = pd.Series(["a"] * 50 + ["b"] * 50)
    weights = mitigation_weights(groups, "group_aware", {"a": 0.1, "b": 0.5})
    series = pd.Series(weights)
    assert series[groups == "b"].mean() > series[groups == "a"].mean()


def test_mitigation_none_produces_no_weights():
    assert mitigation_weights(pd.Series(["a", "b"]), "none") is None
    with pytest.raises(ValueError):
        mitigation_weights(pd.Series(["a"]), "magic")


def test_group_aware_runs_two_training_rounds():
    X, y = _frame(150, seed=5)
    groups = pd.Series(["a"] * 100 + ["b"] * 50)
    config = NeuroLensConfig()
    config.model.ensemble_members = 2
    model = train_model("ridge", "continuous", "multimodal", "group_aware",
                        X, y, ["f1", "f2"], config, groups=groups)
    assert model.metadata["mitigation_rounds"] == 2
    assert "error_by_group" in model.metadata


def test_trained_model_rejects_missing_features():
    X, y = _frame(40)
    config = NeuroLensConfig()
    config.model.ensemble_members = 2
    model = train_model("ridge", "continuous", "multimodal", "none", X, y, ["f1", "f2"], config)
    with pytest.raises(KeyError):
        model.predict(pd.DataFrame({"f1": [0.0], "other": [1.0]}))


def test_model_description_is_serialisable():
    X, y = _frame(40)
    config = NeuroLensConfig()
    config.model.ensemble_members = 2
    model = train_model("ridge", "continuous", "multimodal", "none", X, y, ["f1", "f2"], config)
    described = model.describe()
    assert described["family"] == "ridge"
    assert described["n_features"] == 2
    assert described["n_ensemble_members"] == 2
    import json
    json.dumps(described)
