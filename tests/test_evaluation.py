"""Tests for metrics, calibration, conformal intervals, and reliability."""

from __future__ import annotations

import numpy as np
import pytest

from neurolens.evaluation import (
    ConformalCalibrator,
    bootstrap_ci,
    calibration_classification_from_labels,
    calibration_regression,
    classification_metrics,
    interval_metrics,
    regression_metrics,
    risk_coverage,
    uncertainty_error_association,
)


def test_bootstrap_ci_brackets_the_true_mean():
    rng = np.random.default_rng(0)
    values = rng.normal(loc=2.0, scale=1.0, size=4000)
    low, high = bootstrap_ci(values, np.mean, n_boot=400, seed=1)
    assert low < 2.0 < high
    assert low < values.mean() < high


def test_bootstrap_ci_is_degenerate_for_tiny_samples():
    low, high = bootstrap_ci(np.array([1.0, 2.0]), np.mean, n_boot=50)
    assert low == high


def test_regression_metrics_are_internally_consistent():
    truth = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    prediction = truth + 0.5
    metrics = regression_metrics(truth, prediction, n_boot=200, seed=2)
    assert metrics["mae"] == pytest.approx(0.5)
    assert metrics["rmse"] == pytest.approx(0.5)
    assert metrics["bias"] == pytest.approx(0.5)
    assert metrics["mae_ci"][0] <= metrics["mae"] <= metrics["mae_ci"][1]
    assert metrics["n"] == 5


def test_regression_metrics_ignore_nan_pairs():
    metrics = regression_metrics(np.array([1.0, np.nan, 3.0]), np.array([1.0, 2.0, np.nan]))
    assert metrics["n"] == 1


def test_calibration_regression_detects_shrinkage():
    rng = np.random.default_rng(4)
    truth = rng.normal(size=500)
    calibrated = calibration_regression(truth, truth + rng.normal(scale=0.05, size=500))
    assert calibrated["slope"] == pytest.approx(1.0, abs=0.1)
    assert calibrated["interpretation"] == "calibrated"

    # Convention: the calibration slope regresses the observed outcome on the
    # prediction. Shrunk predictions (truth * 0.5) therefore give slope 2.
    shrunk = calibration_regression(truth, truth * 0.5)
    assert shrunk["slope"] == pytest.approx(2.0, abs=0.05)
    assert "under-dispersed" in shrunk["interpretation"]

    # Over-dispersed predictions run the other way: slope below 1.
    stretched = calibration_regression(truth, truth * 2.0)
    assert stretched["slope"] == pytest.approx(0.5, abs=0.05)
    assert "over-dispersed" in stretched["interpretation"]

    # A predictor with no spread at all cannot be calibrated against anything.
    flat = calibration_regression(truth, np.zeros_like(truth))
    assert flat["interpretation"] == "insufficient data"
    assert np.isnan(flat["slope"])


def test_classification_metrics_report_everything_the_prd_requires():
    classes = ["a", "b", "c"]
    truth = np.array(["a", "a", "b", "b", "c", "c"])
    prediction = np.array(["a", "b", "b", "b", "c", "a"])
    probabilities = np.array([
        [0.7, 0.2, 0.1], [0.4, 0.5, 0.1], [0.1, 0.8, 0.1],
        [0.2, 0.6, 0.2], [0.1, 0.1, 0.8], [0.5, 0.3, 0.2],
    ])
    metrics = classification_metrics(truth, prediction, probabilities, classes)
    for key in ("macro_f1", "balanced_accuracy", "accuracy", "confusion_matrix",
                "per_class", "auroc_ovr_macro", "auroc_per_class", "brier_per_class"):
        assert key in metrics, f"missing {key}"
    assert metrics["confusion_matrix"] == [[1, 1, 0], [0, 2, 0], [1, 0, 1]]
    assert metrics["per_class"]["b"]["support"] == 2
    assert metrics["per_class"]["a"]["recall"] == pytest.approx(0.5)
    assert metrics["per_class"]["c"]["recall"] == pytest.approx(0.5)
    assert metrics["per_class"]["c"]["precision"] == pytest.approx(1.0)

    # With a skewed class prior, balanced accuracy must diverge from accuracy.
    skewed_truth = np.array(["a"] * 18 + ["b"] * 2)
    skewed_pred = np.array(["a"] * 20)
    skewed_proba = np.tile(np.array([[0.8, 0.2]]), (20, 1))
    skewed = classification_metrics(skewed_truth, skewed_pred, skewed_proba, ["a", "b"])
    assert skewed["accuracy"] == pytest.approx(0.9)
    assert skewed["balanced_accuracy"] == pytest.approx(0.5)
    assert skewed["macro_f1"] < skewed["accuracy"]


def test_binary_auroc_is_computed():
    classes = ["neg", "pos"]
    truth = np.array(["neg", "neg", "pos", "pos"])
    probabilities = np.array([[0.9, 0.1], [0.6, 0.4], [0.3, 0.7], [0.2, 0.8]])
    metrics = classification_metrics(truth, np.array(["neg", "neg", "pos", "pos"]),
                                     probabilities, classes)
    assert metrics["auroc_ovr_macro"] == pytest.approx(1.0)


def test_mismatched_probability_matrix_is_reported_not_silently_wrong():
    classes = ["a", "b", "c"]
    metrics = classification_metrics(
        np.array(["a", "b", "c"]), np.array(["a", "b", "c"]),
        np.array([[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]), classes)
    assert np.isnan(metrics["auroc_ovr_macro"])
    assert "probability matrix" in metrics["auroc_note"]


def test_conformal_split_intervals_reach_nominal_coverage():
    rng = np.random.default_rng(7)
    n = 4000
    predictions = rng.normal(size=n)
    residuals = rng.normal(scale=1.0, size=n)
    calibrator = ConformalCalibrator(alpha=0.10, mode="split").fit(residuals)
    lower, upper, width = calibrator.intervals(predictions)
    coverage = interval_metrics(predictions + rng.normal(scale=1.0, size=n), lower, upper, 0.10)
    assert coverage["picp"] >= 0.88
    assert coverage["target_coverage"] == pytest.approx(0.90)
    assert (width > 0).all()
    assert calibrator.describe()["assumption"]


def test_conformal_quantile_uses_the_finite_sample_correction():
    residuals = np.arange(1, 21, dtype=float)
    calibrator = ConformalCalibrator(alpha=0.1).fit(residuals)
    # n=20, alpha=0.1 -> level = ceil(21*0.9)/20 = 19/20 = 0.95
    assert calibrator.global_quantile_ == pytest.approx(np.quantile(residuals, 0.95, method="higher"))


def test_mondrian_conformal_produces_group_specific_widths():
    rng = np.random.default_rng(8)
    groups = np.array(["a"] * 300 + ["b"] * 300)
    residuals = np.where(groups == "a", rng.normal(scale=0.5, size=600),
                         rng.normal(scale=2.0, size=600))
    calibrator = ConformalCalibrator(alpha=0.1, mode="mondrian").fit(residuals, groups)
    assert set(calibrator.quantiles_) == {"a", "b"}
    assert calibrator.quantiles_["b"] > calibrator.quantiles_["a"]
    _lower, _upper, widths = calibrator.intervals(np.zeros(4), groups=np.array(["a", "b", "a", "b"]))
    assert widths[1] > widths[0]


def test_interval_metrics_penalise_misses_via_winkler():
    truth = np.array([0.0, 0.0, 0.0, 10.0])
    lower = np.array([-1.0, -1.0, -1.0, -1.0])
    upper = np.array([1.0, 1.0, 1.0, 1.0])
    metrics = interval_metrics(truth, lower, upper, alpha=0.10)
    assert metrics["picp"] == pytest.approx(0.75)
    # A wide miss must cost more than the interval width alone.
    assert metrics["winkler_score"] > metrics["mean_interval_width"]


def test_risk_coverage_improves_when_uncertainty_is_informative():
    rng = np.random.default_rng(9)
    uncertainty = rng.uniform(size=1000)
    absolute_error = uncertainty * 2 + rng.normal(scale=0.1, size=1000)
    curve = risk_coverage(uncertainty, np.abs(absolute_error))
    assert curve["mae_at_50pct_abstention"] < curve["mae_full"]
    assert curve["aurc"] < curve["mae_full"]
    assert len(curve["curve"]) == 11


def test_risk_coverage_does_not_improve_for_uninformative_uncertainty():
    rng = np.random.default_rng(10)
    uncertainty = rng.uniform(size=2000)
    absolute_error = rng.uniform(size=2000)
    curve = risk_coverage(uncertainty, absolute_error)
    assert abs(curve["mae_at_50pct_abstention"] - curve["mae_full"]) < 0.05


def test_uncertainty_error_association_verdicts():
    rng = np.random.default_rng(11)
    uncertainty = rng.uniform(size=500)
    correlated = uncertainty + rng.normal(scale=0.15, size=500)
    result = uncertainty_error_association(uncertainty, np.abs(correlated))
    assert result["spearman"] > 0.3
    assert result["verdict"] == "uncertainty tracks error"

    noise = rng.uniform(size=500)
    flat = uncertainty_error_association(uncertainty, noise)
    assert "no reliable" in flat["verdict"] or "weak" in flat["verdict"]


def test_classification_calibration_from_labels():
    classes = ["a", "b"]
    truth = np.array(["a", "a", "b", "b"] * 50)
    probabilities = np.tile(np.array([[0.9, 0.1], [0.9, 0.1], [0.2, 0.8], [0.2, 0.8]]), (50, 1))
    calibration = calibration_classification_from_labels(truth, probabilities, classes)
    assert calibration["n"] == 200
    assert calibration["accuracy"] == pytest.approx(1.0)
    # Half the rows carry confidence 0.9 and half 0.8, all correct, so the
    # expected calibration error is 0.5*0.1 + 0.5*0.2 = 0.15.
    assert calibration["ece"] == pytest.approx(0.15, abs=0.02)
    assert len(calibration["reliability"]) == 2

    # A perfectly calibrated model has zero expected calibration error.
    rng = np.random.default_rng(12)
    p = rng.uniform(0.05, 0.95, size=20000)
    well_truth = np.where(rng.uniform(size=20000) < p, "pos", "neg")
    well_proba = np.column_stack([1 - p, p])
    well = calibration_classification_from_labels(well_truth, well_proba, ["neg", "pos"])
    assert well["ece"] < 0.02
