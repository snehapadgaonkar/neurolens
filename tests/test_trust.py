"""Tests for OOD detection and the fairness audit."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neurolens.config import NeuroLensConfig
from neurolens.fairness import (
    ADEQUATE,
    EXPLORATORY,
    INSUFFICIENT,
    PASS,
    WARN,
    adequacy_for,
    audit_axis,
    intersectional_audit,
    select_preferred_model,
    worst_group_summary,
)
from neurolens.ood import OodDetector, evaluate_ood


def _real_volume_matrix(bids_fixture_dir):
    """Real regional volumes from the committed aseg.stats fixtures."""
    from neurolens.datasets import load_cohort

    tables = load_cohort("bids-freesurfer", bids_fixture_dir)
    wide = tables.mri_features.pivot_table(
        index="patient_id", columns="region", values="normalized_volume", aggfunc="first")
    return wide.fillna(wide.median())


def test_ood_detector_flags_a_shifted_sample(bids_fixture_dir):
    training = _real_volume_matrix(bids_fixture_dir)
    detector = OodDetector(knn_k=2, threshold_quantile=0.8).fit(training)

    scores = detector.score(training)
    assert scores.shape == (len(training),)
    assert ((scores >= 0) & (scores <= 1)).all()

    # A grossly displaced sample must score higher than every real subject.
    displaced = training.iloc[[0]].copy()
    displaced.iloc[0] = displaced.iloc[0] * 50
    assert detector.score(displaced)[0] > scores.max()
    assert bool(detector.flag(displaced)[0]) is True
    assert detector.describe()["n_train"] == len(training)


def test_ood_detector_methods_are_selectable(bids_fixture_dir):
    training = _real_volume_matrix(bids_fixture_dir)
    mahalanobis = OodDetector(method="mahalanobis", knn_k=2).fit(training)
    knn = OodDetector(method="knn", knn_k=2).fit(training)
    assert not np.allclose(mahalanobis.score(training), knn.score(training))


def test_ood_detector_requires_fitting():
    detector = OodDetector()
    with pytest.raises(RuntimeError):
        detector.score(pd.DataFrame({"a": [1.0]}))


def test_evaluate_ood_reports_separation_and_reliability():
    rng = np.random.default_rng(0)
    n = 200
    shift = np.array([False] * 150 + [True] * 50)
    scores = np.where(shift, rng.uniform(0.6, 1.0, n), rng.uniform(0.0, 0.5, n))
    error = np.where(shift, rng.uniform(1.0, 2.0, n), rng.uniform(0.2, 0.6, n))
    result = evaluate_ood(scores, shift, absolute_error=error, n_boot=200, seed=3)
    assert result["auroc_shift_detection"] == pytest.approx(1.0)
    assert result["absolute_error"]["shift_is_worse"] is True
    assert result["absolute_error"]["difference_ci"][0] > 0
    assert "separates" in result["verdict"]


def test_evaluate_ood_handles_a_degenerate_shift_cohort():
    scores = np.array([0.1, 0.2, 0.3, 0.4])
    result = evaluate_ood(scores, np.array([False, False, False, False]))
    assert "cannot evaluate" in result["verdict"]


# ------------------------------------------------------------------ fairness
def test_adequacy_thresholds_are_predeclared():
    config = NeuroLensConfig()
    assert adequacy_for(30, config) == ADEQUATE
    assert adequacy_for(29, config) == EXPLORATORY
    assert adequacy_for(10, config) == EXPLORATORY
    assert adequacy_for(9, config) == INSUFFICIENT


def _audit(groups, truth, prediction, config=None, axis="g"):
    return audit_axis(axis, pd.Series(groups), np.asarray(truth), np.asarray(prediction),
                      "continuous", config or NeuroLensConfig(), n_boot=200)


def test_small_subgroup_reports_insufficient_data_with_its_n():
    groups = ["big"] * 60 + ["tiny"] * 5
    truth = np.zeros(65)
    prediction = np.zeros(65)
    rows = {row["subgroup"]: row for row in _audit(groups, truth, prediction)}
    tiny = rows["tiny"]
    assert tiny["adequacy"] == INSUFFICIENT
    assert tiny["status"] == INSUFFICIENT
    assert tiny["n"] == 5
    assert np.isnan(tiny["estimate"])
    assert "5" in tiny["note"]


def test_adverse_gap_is_flagged_and_favourable_gap_is_not():
    rng = np.random.default_rng(1)
    n_each = 80
    groups = ["ref"] * n_each + ["worse"] * n_each + ["better"] * n_each
    truth = np.zeros(3 * n_each)
    prediction = np.concatenate([
        rng.normal(scale=0.1, size=n_each),
        rng.normal(scale=1.0, size=n_each),
        rng.normal(scale=0.01, size=n_each),
    ])
    rows = {row["subgroup"]: row for row in _audit(groups, truth, prediction)}
    assert rows["worse"]["status"] == WARN
    assert rows["worse"]["relative_gap"] > 0.2
    assert rows["better"]["status"] == PASS
    assert rows["better"]["relative_gap"] < 0
    assert "better than the reference" in rows["better"]["note"]
    # The reference group's gap is zero by construction.
    assert rows["ref"]["gap"] == 0.0


def test_gap_carries_its_own_confidence_interval():
    rng = np.random.default_rng(2)
    groups = ["a"] * 100 + ["b"] * 100
    truth = np.zeros(200)
    prediction = np.concatenate([rng.normal(scale=0.2, size=100),
                                 rng.normal(scale=0.8, size=100)])
    rows = {row["subgroup"]: row for row in _audit(groups, truth, prediction)}
    for row in rows.values():
        if row["subgroup"] == row["reference"]:
            assert row["gap_ci"] == [0.0, 0.0]
        else:
            low, high = row["gap_ci"]
            assert low < high
            assert low <= row["gap"] <= high


def test_every_row_carries_n_estimate_and_status():
    rows = _audit(["a"] * 40 + ["b"] * 40, np.zeros(80), np.zeros(80) + 0.1)
    assert rows
    for row in rows:
        assert "n" in row and "estimate" in row and "status" in row and "adequacy" in row
        assert row["status"] in {PASS, WARN, INSUFFICIENT}


def test_worst_group_summary_marks_underpowered_axes():
    rows = _audit(["a"] * 60 + ["b"] * 40 + ["tiny"] * 3, np.zeros(103),
                  np.concatenate([np.full(60, 0.1), np.full(40, 0.5), np.full(3, 9.0)]))
    summary = worst_group_summary(rows)
    assert summary["worst_group"] == "b"
    assert summary["n_insufficient"] == 1
    assert summary["n_reportable"] == 2


def test_worst_group_summary_with_nothing_reportable():
    rows = _audit(["tiny"] * 3 + ["tiny2"] * 2, np.zeros(5), np.zeros(5))
    summary = worst_group_summary(rows)
    assert summary["worst_group"] is None
    assert summary["note"]


def test_intersectional_cells_are_only_reported_when_adequate():
    cells = [("f", "young", 40), ("f", "old", 40), ("m", "young", 40), ("m", "old", 4)]
    frame = pd.DataFrame([entry for sex, age, count in cells for entry in [(sex, age)] * count],
                         columns=["sex", "age_strata"])
    truth = np.zeros(len(frame))
    prediction = np.zeros(len(frame)) + 0.2
    rows = intersectional_audit(frame, ["sex", "age_strata"], truth, prediction,
                                "continuous", NeuroLensConfig())
    by_cell = {row["subgroup"]: row for row in rows}
    assert len(by_cell) == len(cells)

    tiny = by_cell["m \u00d7 old"]
    assert tiny["n"] == 4
    assert tiny["status"] == INSUFFICIENT
    assert np.isnan(tiny["estimate"])

    reportable = by_cell["f \u00d7 young"]
    assert reportable["n"] == 40
    assert reportable["status"] != INSUFFICIENT
    assert not np.isnan(reportable["estimate"])


def test_intersectional_audit_needs_two_axes():
    frame = pd.DataFrame({"sex": ["f"] * 40 + ["m"] * 40})
    assert intersectional_audit(frame, ["sex", "age_strata"], np.zeros(80),
                                np.zeros(80), "continuous", NeuroLensConfig()) == []


def test_selection_rule_refuses_a_mitigation_that_costs_too_much():
    config = NeuroLensConfig()
    config.model.max_overall_degradation = 0.05
    candidates = [
        {"name": "none", "mitigation": "none", "overall": 0.20, "worst_group": 0.30},
        {"name": "reweighting", "mitigation": "reweighting", "overall": 0.30, "worst_group": 0.22},
    ]
    preferred, rationale = select_preferred_model(candidates, config)
    assert preferred == "none"
    assert "does not improve" in rationale or "retaining" in rationale


def test_selection_rule_accepts_a_free_improvement():
    config = NeuroLensConfig()
    candidates = [
        {"name": "none", "mitigation": "none", "overall": 0.20, "worst_group": 0.30},
        {"name": "group_aware", "mitigation": "group_aware", "overall": 0.198, "worst_group": 0.24},
    ]
    preferred, rationale = select_preferred_model(candidates, config)
    assert preferred == "group_aware"
    assert "lowers worst-group" in rationale


def test_calibration_gap_can_escalate_a_pass_to_warn():
    config = NeuroLensConfig()
    groups = ["ref"] * 60 + ["drift"] * 60
    # Identical per-sample errors in both groups, so the pointwise gap is exactly
    # zero and only the calibration gap can change a verdict.
    rng = np.random.default_rng(20)
    errors = rng.normal(scale=0.5, size=60)
    truth = np.concatenate([errors, errors])
    prediction = np.zeros(120)
    calibration_gap = pd.Series(np.concatenate([np.zeros(60), np.full(60, 0.5)]))
    rows = {row["subgroup"]: row for row in audit_axis(
        "g", pd.Series(groups), truth, prediction, "continuous", config,
        calibration_gap=calibration_gap, n_boot=100)}

    assert rows["ref"]["status"] == PASS
    assert rows["drift"]["gap"] == 0.0
    assert rows["drift"]["status"] == WARN
    assert "Calibration differs" in rows["drift"]["note"]
    assert rows["drift"]["calibration_gap"] == pytest.approx(0.5)


def test_zero_reference_error_yields_insufficient_status_with_a_stated_reason():
    config = NeuroLensConfig()
    groups = ["ref"] * 60 + ["other"] * 60
    truth = np.zeros(120)
    prediction = np.zeros(120)
    rows = {row["subgroup"]: row for row in audit_axis(
        "g", pd.Series(groups), truth, prediction, "continuous", config, n_boot=100)}
    # The reference group is exactly accurate, so a relative gap is undefined.
    assert rows["other"]["adequacy"] == ADEQUATE
    assert rows["other"]["status"] == INSUFFICIENT
    assert "relative gap is undefined" in rows["other"]["note"]
    # The absolute estimate is still reported rather than dropped.
    assert rows["other"]["estimate"] == pytest.approx(0.0)
