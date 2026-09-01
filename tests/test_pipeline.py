"""End-to-end pipeline tests on real data, including the MRI-only pathway."""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import pytest

from neurolens.config import NeuroLensConfig
from neurolens.cohort import build_feature_builder, derive_groups, make_splits
from neurolens.datasets import load_cohort
from neurolens.models import train_model
from neurolens.schema import QCLedger


pytestmark = pytest.mark.slow


# --------------------------------------------------------------------------- #
# The MRI-only pathway, exercised on real FreeSurfer volumes
# --------------------------------------------------------------------------- #
def test_mri_only_model_trains_on_real_freesurfer_volumes(bids_fixture_dir):
    """The imaging pathway must work on real data even though the default DLBS
    run has no imaging derivative available."""
    tables = load_cohort("bids-freesurfer", bids_fixture_dir)
    wide = tables.mri_features.pivot_table(
        index="patient_id", columns="region", values="normalized_volume", aggfunc="first")
    wide.columns = [f"mri_norm_{c}" for c in wide.columns]
    frame = wide.reset_index()

    config = NeuroLensConfig()
    config.features.demographic_variables = ["age"]
    analysis = frame.merge(tables.patients[["patient_id", "sex", "age"]], on="patient_id")
    analysis["age_at_index"] = pd.to_numeric(analysis["age"], errors="coerce")
    analysis["target_continuous"] = analysis["age_at_index"]
    analysis = derive_groups(analysis, config)
    features = build_feature_builder(analysis, config)

    mri_columns = features.names_for(["mri"])
    assert len(mri_columns) >= 20, f"expected the real aseg regions, got {len(mri_columns)}"
    assert all(column.startswith("mri_norm_") for column in mri_columns)
    assert features.available_families()["mri"] is True

    X = features.matrix(["mri"])
    y = analysis["target_continuous"].to_numpy(dtype=float)
    config.model.ensemble_members = 3
    model = train_model("ridge", "continuous", "mri_only", "none", X, y, mri_columns, config)

    prediction = model.predict(X)
    assert prediction.shape == y.shape
    assert np.isfinite(prediction).all()
    # Real caudate/ventricle volumes do carry age signal in this cohort.
    assert np.corrcoef(prediction, y)[0, 1] > 0.3
    assert model.describe()["comparison"] == "mri_only"


def test_mri_only_and_multimodal_are_comparable_on_identical_features(bids_fixture_dir):
    tables = load_cohort("bids-freesurfer", bids_fixture_dir)
    wide = tables.mri_features.pivot_table(
        index="patient_id", columns="region", values="normalized_volume", aggfunc="first")
    wide.columns = [f"mri_norm_{c}" for c in wide.columns]
    analysis = wide.reset_index().merge(
        tables.patients[["patient_id", "sex", "age"]], on="patient_id")
    analysis["age_at_index"] = pd.to_numeric(analysis["age"], errors="coerce")
    analysis["target_continuous"] = analysis["age_at_index"]

    config = NeuroLensConfig()
    config.features.demographic_variables = ["age_at_index", "sex"]
    analysis = derive_groups(analysis, config)
    features = build_feature_builder(analysis, config)

    mri_only = features.names_for(["mri"])
    multimodal = features.names_for(["mri", "demographic"])
    assert set(mri_only).issubset(set(multimodal))
    assert len(multimodal) > len(mri_only)

    y = analysis["target_continuous"].to_numpy(dtype=float)
    config.model.ensemble_members = 3
    a = train_model("ridge", "continuous", "mri_only", "none",
                    features.matrix(["mri"]), y, mri_only, config)
    b = train_model("ridge", "continuous", "multimodal", "none",
                    features.matrix(["mri", "demographic"]), y, multimodal, config)
    assert a.describe()["n_features"] < b.describe()["n_features"]
    assert np.isfinite(a.predict(features.matrix(["mri"]))).all()
    assert np.isfinite(b.predict(features.matrix(["mri", "demographic"]))).all()


# --------------------------------------------------------------------------- #
# Full pipeline on the real DLBS cohort
# --------------------------------------------------------------------------- #
def test_smoke_test_passes_every_check(smoke_run):
    checks = smoke_run["checks"]
    assert checks["all_passed"] is True, checks
    for key in ("cohort_non_empty", "leakage_free", "audit_report_written",
                "model_card_written", "explanations_present"):
        assert checks[key] is True, f"{key} failed"


def test_all_required_artifacts_are_written(smoke_run):
    run_dir = smoke_run["run_dir"]
    paths = os.listdir(run_dir)
    for required in ("audit_report.json", "audit_report.md", "model_card.md",
                     "predictions.csv", "fairness_audit.csv", "qc_ledger.csv",
                     "manifest.json", "config.yaml"):
        assert required in paths, f"{required} missing from {paths}"


def test_manifest_carries_full_provenance(smoke_run):
    with open(os.path.join(smoke_run["run_dir"], "manifest.json"), encoding="utf-8") as handle:
        manifest = json.load(handle)
    for key in ("run_id", "config_hash", "seed", "dataset", "dataset_version",
                "dataset_access", "split_version", "split_hash",
                "target_definition_version", "package_versions", "artifacts",
                "release_readiness"):
        assert key in manifest, f"manifest missing {key}"
    assert manifest["dataset_access"] == "open"
    assert manifest["split_hash"]
    assert manifest["release_readiness"]["release_ready"] is True

    # Every artifact the manifest names must exist on disk. It used to list
    # `figures/<semantic_key>`, which is not the file that was written.
    directory = smoke_run["run_dir"]
    missing = [name for name in manifest["artifacts"]
               if not os.path.exists(os.path.join(directory, name))]
    assert missing == [], f"manifest names artifacts that do not exist: {missing}"


def test_manifest_figure_names_resolve_to_real_files(figure_run):
    import json as _json

    run_dir = figure_run.run_dir
    manifest = _json.load(open(os.path.join(run_dir, "manifest.json"), encoding="utf-8"))
    figures = manifest["figure_keys"]
    assert len(figures) == 8
    assert figures["mitigation_tradeoff"] == "figures/mitigation.png"
    assert figures["target_distribution"] == "figures/target.png"
    for key, relative in figures.items():
        assert os.path.isfile(os.path.join(run_dir, relative)), f"{key} -> {relative}"
        assert relative in manifest["artifacts"], f"{relative} missing from the artifact list"
    # No figure is listed under its semantic name.
    assert not [name for name in manifest["artifacts"] if name.startswith("figures/")
                and not name.endswith(".png")]


def test_report_states_leakage_free_and_real_cohort_sizes(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    cohort = report["cohort"]
    assert cohort["split"]["leakage_free"] is True
    assert cohort["split"]["total_overlap"] == 0
    assert cohort["n_indexed"] == 464
    assert cohort["n_analysed"] == 331
    assert cohort["dataset_access"] == "open"
    assert "CC0" in cohort["dataset_license"]


def test_report_contains_both_tasks_and_trust_sections(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    continuous = report["tasks"]["continuous"]
    stage = report["tasks"]["stage"]
    assert continuous["metrics"]["n"] > 0
    assert continuous["metrics"]["mae_ci"][0] <= continuous["metrics"]["mae"] <= continuous["metrics"]["mae_ci"][1]
    assert continuous["intervals"]["target_coverage"] == pytest.approx(0.9)
    assert 0 <= continuous["intervals"]["picp"] <= 1
    assert stage["metrics"]["macro_f1"] is not None
    assert stage["metrics"]["per_class"]
    assert report["trust"]["uncertainty_error"]["verdict"]
    assert report["trust"]["ood"]["auroc_shift_detection"] is not None
    assert report["trust"]["confident_and_wrong"]["definition"]


def test_every_fairness_row_has_n_adequacy_and_status(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    rows = report["fairness"]["rows"]
    assert rows
    insufficient = [row for row in rows if row["status"] == "INSUFFICIENT DATA"]
    assert insufficient, "the real DLBS cohort must produce underpowered subgroups"
    for row in rows:
        assert isinstance(row["n"], int) and row["n"] > 0
        assert row["adequacy"] in {"ADEQUATE", "EXPLORATORY", "INSUFFICIENT DATA"}
        assert row["status"] in {"PASS", "WARN", "INSUFFICIENT DATA"}
        if row["status"] == "INSUFFICIENT DATA":
            assert row["estimate"] is None or np.isnan(row["estimate"])
            assert str(row["n"]) in row["note"]


def test_explanations_are_traceable_for_every_released_case(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    cases = report["explainability"]["cases"]
    assert len(cases) >= 3
    for case in cases:
        assert case["patient_id"]
        assert abs(case["residual"]) < 1e-6, "SHAP attributions must reconstruct the prediction"
        assert case["top"] and case["top"][0]["rank"] == 1
        assert case["causation_notice"]
        assert case["subgroup_context"]
    frame = pd.read_csv(os.path.join(smoke_run["run_dir"], "explanations.csv"))
    assert {"patient_id", "feature", "attribution", "rank", "explanation_version"}.issubset(frame.columns)
    assert (frame["explanation_version"] == "expl-v1").all()


def test_model_card_documents_scope_and_limits(smoke_run):
    with open(os.path.join(smoke_run["run_dir"], "model_card.md"), encoding="utf-8") as handle:
        card = handle.read()
    for required in ("## Intended use", "## Out of scope", "## Training scope",
                     "## Evaluation", "## Subgroup performance",
                     "## Known failure modes", "## Limitations", "## Reproduction"):
        assert required in card, f"model card missing section {required}"
    assert "not clinically validated" in card
    assert "CC0" in card


def test_limitations_record_the_missing_imaging_modality(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    assert report["cohort"]["modalities_available"]["mri"] is False
    assert any("No MRI features were available" in item for item in report["limitations"])
    assert report["skipped_comparisons"], "the skipped MRI-only comparison must be recorded"


def test_repeated_seeds_change_results_and_are_recorded(dlbs_dir, tmp_path):
    from neurolens.pipeline import NeuroLensPipeline

    first = NeuroLensConfig()
    first.data.data_dir = dlbs_dir
    first.model.ensemble_members = 2
    first.model.families = ["ridge"]
    first.model.mitigations = ["none"]
    first.fairness.n_bootstrap = 50
    first.report.include_figures = False
    # Write to a temp dir, not the repo's `runs/`. output_dir defaults to
    # "runs", so this test used to leave real run directories behind in the
    # working tree on every pytest invocation.
    first.report.output_dir = str(tmp_path / "seedcheck")

    import copy

    second = copy.deepcopy(first)
    second.seed += 1
    second.split.seed += 1

    run_a = NeuroLensPipeline(first).run()
    run_b = NeuroLensPipeline(second).run()
    assert run_a.report["cohort"]["split"]["split_hash"] != run_b.report["cohort"]["split"]["split_hash"]
    assert run_a.report["manifest"]["config_hash"] != run_b.report["manifest"]["config_hash"]


def test_degenerate_stage_task_is_stated_rather_than_flattered(smoke_run):
    report = json.load(open(os.path.join(smoke_run["run_dir"], "audit_report.json"), encoding="utf-8"))
    stage = report["tasks"]["stage"]
    distribution = stage["outcome_distribution"]

    assert distribution["counts"] == {"no_impairment": 60, "mild": 6}
    assert distribution["n"] == 66
    assert distribution["verdict"] == "severely imbalanced"
    # The trivial baseline must be reported next to the headline accuracy.
    assert distribution["majority_class_accuracy"] == pytest.approx(60 / 66, abs=1e-6)
    assert stage["metrics"]["accuracy"] == pytest.approx(distribution["majority_class_accuracy"], abs=1e-6)
    # Balanced accuracy sits near chance while raw accuracy looks strong.
    assert stage["metrics"]["balanced_accuracy"] < 0.6
    assert stage["metrics"]["balanced_accuracy"] < stage["metrics"]["accuracy"]

    assert any("class prior" in note for note in stage["notes"])
    # With two classes the ordinal decomposition cannot differ from multinomial.
    assert len(stage["classes"]) == 2
    assert any("ordinal" in note for note in stage["notes"])
    assert any("majority-class floor" in item for item in report["limitations"])
    assert any("ordinal" in item for item in report["limitations"])
