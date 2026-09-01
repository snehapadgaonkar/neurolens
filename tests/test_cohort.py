"""Tests for cohort construction, target freeze, and leakage-safe splits."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from neurolens.cohort import (
    FeatureBuilder,
    build_cohort,
    build_feature_builder,
    derive_groups,
    make_splits,
)
from neurolens.config import NeuroLensConfig


def test_cohort_is_built_from_real_data(dlbs_cohort):
    result = dlbs_cohort
    assert len(result.analysis) == 331
    assert result.audit["n_indexed"] == 464
    assert result.audit["n_excluded"] == 464 - 331
    assert result.tables.modalities_available()["clinical"] is True


def test_no_patient_appears_in_more_than_one_partition(dlbs_cohort):
    splits = dlbs_cohort.splits
    assert dlbs_cohort.split_info["leakage_free"] is True
    assert dlbs_cohort.split_info["total_overlap"] == 0
    for pair, shared in dlbs_cohort.split_info["patient_overlap"].items():
        assert shared == 0, f"{pair} shares {shared} patients"
    # Every patient has exactly one partition.
    assert not splits["patient_id"].duplicated().any()
    assert set(splits["split_name"]) == {"train", "validation", "test"}
    assert dlbs_cohort.split_info["split_hash"]


def test_split_hash_is_stable_and_changes_with_seed(dlbs_cohort, dlbs_dir):
    from neurolens.datasets import load_cohort

    config = NeuroLensConfig()
    config.data.data_dir = dlbs_dir
    tables = load_cohort(config.data.dataset, dlbs_dir)
    again = build_cohort(tables, config)
    assert again.split_info["split_hash"] == dlbs_cohort.split_info["split_hash"]

    config.split.seed += 7
    moved = build_cohort(load_cohort(config.data.dataset, dlbs_dir), config)
    assert moved.split_info["split_hash"] != dlbs_cohort.split_info["split_hash"]


def test_features_never_contain_outcome_information(dlbs_cohort):
    """The design matrix may only use index-session information."""
    forbidden_substrings = ("at_outcome", "future", "target_", "stage_at_outcome",
                            "_W2", "_W3", "followup")
    for feature in dlbs_cohort.features.names():
        lowered = feature.lower()
        for token in forbidden_substrings:
            assert token.lower() not in lowered, f"feature '{feature}' leaks '{token}'"
    # The baseline clinical measurement is allowed and expected.
    assert "mmse_at_index" in dlbs_cohort.features.names()


def test_target_is_annualised_mmse_change_with_decline_positive(dlbs_cohort, dlbs_dir):
    from neurolens.datasets import load_cohort

    tables = load_cohort("openneuro-ds004856", dlbs_dir)
    analysis = dlbs_cohort.analysis
    definition = dlbs_cohort.audit["target_definition"]
    assert definition["outcome_measure"] == "mmse"
    assert definition["annualized"] is True
    assert definition["sign_convention"] == "decline_positive"
    assert definition["units"].startswith("mmse points per year")

    recomputed = -(analysis["mmse_at_outcome"] - analysis["mmse_at_index"]) / analysis["followup_years"]
    assert np.allclose(recomputed.to_numpy(), analysis["target_continuous"].to_numpy(), atol=1e-9)
    assert analysis["followup_years"].min() >= 1.0


def test_stage_labels_follow_the_prespecified_cutpoints(dlbs_cohort):
    analysis = dlbs_cohort.analysis
    # Standard MMSE interpretation thresholds: >=27 none, 21-26 mild, <=20 moderate+.
    for _, row in analysis.iterrows():
        value = row["mmse_at_index"]
        stage = row["stage_at_index"]
        if pd.isna(value):
            continue
        if value >= 27:
            assert stage == "no_impairment"
        elif value >= 21:
            assert stage == "mild"
        else:
            assert stage == "moderate_or_worse"


def test_exclusions_are_recorded_with_reasons(dlbs_cohort):
    reasons = dlbs_cohort.audit["exclusion_reasons"]
    assert reasons, "no exclusions were logged, but 133 patients were dropped"
    assert sum(reasons.values()) >= dlbs_cohort.audit["n_excluded"]
    ledger = dlbs_cohort.qc.to_frame()
    assert {"entity_type", "entity_id", "reason", "severity"}.issubset(ledger.columns)


def test_coded_variables_are_relabelled_from_the_datasets_own_dictionary(dlbs_cohort):
    """The cohort builder applies ``participants.json`` levels; the loader does not."""
    analysis = dlbs_cohort.analysis
    assert set(analysis["sex"].dropna().unique()) == {"male", "female"}
    assert set(analysis["race"].dropna().unique()) == {
        "Asian American/Pacific Islander", "Black/African American", "Multiracial",
        "Native American", "Other", "White/Caucasian"}
    # The published Ethnicity code list (1/2) does not match the data (0/1).
    # NeuroLens must record that rather than guess a mapping or drop the axis.
    assert "coded_levels_do_not_match_data" in dlbs_cohort.qc.summary()
    ethnicity_rows = dlbs_cohort.qc.to_frame()
    flagged = ethnicity_rows[ethnicity_rows["reason"] == "coded_levels_do_not_match_data"]
    assert len(flagged) == 1
    assert "Ethnicity" in str(flagged.iloc[0]["detail"])


def test_fairness_axes_are_derived_with_real_labels(dlbs_cohort):
    analysis = dlbs_cohort.analysis
    assert set(analysis["sex"].unique()) <= {"male", "female"}
    assert "age_strata" in analysis.columns
    assert "education_strata" in analysis.columns
    assert analysis["age_strata"].notna().sum() == len(analysis)
    # Real DLBS race labels come from the dataset's own data dictionary.
    assert "White/Caucasian" in set(analysis["race"].unique())


def test_shift_cohort_flag_matches_the_predeclared_rule(dlbs_cohort):
    analysis = dlbs_cohort.analysis
    expected = analysis["age_at_index"] >= 75.0
    assert (analysis["is_shift_cohort"].to_numpy() == expected.fillna(False).to_numpy()).all()
    assert dlbs_cohort.audit["shift_cohort"]["n"] == int(expected.fillna(False).sum())


def test_subgroup_sizes_expose_underpowered_cells(dlbs_cohort):
    sizes = dlbs_cohort.audit["subgroup_sizes"]
    assert "sex" in sizes and "race" in sizes
    # The real DLBS cohort is overwhelmingly one race category, which is exactly
    # the situation the PRD requires to be surfaced rather than smoothed over.
    race_counts = list(sizes["race"].values())
    assert max(race_counts) >= 30
    assert min(race_counts) < 10


def test_feature_builder_encodes_categoricals_with_a_reference_level(dlbs_cohort):
    names = dlbs_cohort.features.names()
    sex_columns = [n for n in names if n.startswith("sex_")]
    assert len(sex_columns) == 1, f"expected one sex dummy with a reference level, got {sex_columns}"
    for name in names:
        assert dlbs_cohort.features.family_of(name) in {
            "mri", "genetics", "clinical", "demographic", "mri_excluded_system"}


def test_missing_mri_modality_is_reflected_in_available_families(dlbs_cohort):
    available = dlbs_cohort.features.available_families()
    assert available["mri"] is False
    assert available["clinical"] is True
    assert available["demographic"] is True


def test_make_splits_rejects_nothing_and_reports_stratification(dlbs_dir, dlbs_cohort):
    config = NeuroLensConfig()
    config.data.data_dir = dlbs_dir
    config.split.stratify = False
    analysis = dlbs_cohort.analysis.drop(columns=["split_name", "split_hash"])
    splits, info = make_splits(analysis, config, dlbs_cohort.qc)
    assert info["leakage_free"] is True
    assert info["stratified_on"] is None
    assert sum(info["counts"].values()) == info["n_patients"]


def test_split_is_reproducible_across_processes(dlbs_dir):
    """Python's ``hash()`` is randomised per process, so the split must not use it.

    The stratum salt used to be ``abs(hash(stage))``, which silently reshuffled
    the partition on every interpreter start and broke the reproducibility
    manifest. This runs the cohort build twice in child processes with different
    ``PYTHONHASHSEED`` values and requires an identical split hash.
    """
    import os
    import subprocess
    import sys

    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    code = (
        "import sys; sys.path.insert(0, {src!r});"
        "from neurolens.config import NeuroLensConfig;"
        "from neurolens.datasets import load_cohort;"
        "from neurolens.cohort import build_cohort;"
        "cfg = NeuroLensConfig(); cfg.data.data_dir = {data!r};"
        "info = build_cohort(load_cohort(cfg.data.dataset, cfg.data.data_dir), cfg).split_info;"
        "print(info['split_hash'], info['counts']['test'])"
    ).format(src=os.path.join(repo_root, "src"), data=dlbs_dir)

    hashes = []
    for seed in ("0", "1"):
        environment = dict(os.environ, PYTHONHASHSEED=seed)
        completed = subprocess.run([sys.executable, "-c", code], capture_output=True,
                                   text=True, env=environment, check=True)
        hashes.append(completed.stdout.strip())
    assert hashes[0], f"child process produced no split hash"
    assert hashes[0] == hashes[1], f"split depends on PYTHONHASHSEED: {hashes}"
