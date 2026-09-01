"""Tests for the real-dataset ingestion layer."""

from __future__ import annotations

import os

import pytest

from neurolens.datasets import (
    MANIFESTS,
    load_cohort,
    parse_aseg_stats,
    resolve_manifest,
)

FIXTURE_SUBJECTS = [
    "sub-CMU_0050646", "sub-KKI_0050778", "sub-NYU_0050965", "sub-Pitt_50014",
    "sub-SBL_51556", "sub-UM_0050404", "sub-USM_50470",
]


def test_manifest_registry_is_well_formed():
    assert MANIFESTS, "no dataset manifests registered"
    for key, manifest in MANIFESTS.items():
        assert manifest.key == key
        assert manifest.access in {"open", "registration", "dua"}
        assert manifest.license
        assert manifest.loader
        # A DUA dataset must never be marked redistributable.
        if manifest.access == "dua":
            assert manifest.redistributable is False


def test_resolve_manifest_rejects_unknown_keys():
    with pytest.raises(KeyError):
        resolve_manifest("not-a-real-dataset")


def test_parse_aseg_stats_reads_real_volumes(bids_fixture_dir):
    path = os.path.join(bids_fixture_dir, "sub-Pitt_50014", "stats", "aseg.stats")
    parsed = parse_aseg_stats(path)

    # Real values taken from the committed aseg.stats file.
    assert parsed["icv"] == pytest.approx(1626868.523913, rel=1e-6)
    assert parsed["subject"] == "Pitt_50014"
    assert parsed["regions"]["Left-Caudate"] == pytest.approx(3613.1, rel=1e-6)
    assert parsed["regions"]["Left-Lateral-Ventricle"] == pytest.approx(11747.3, rel=1e-6)
    assert parsed["regions"]["Brain-Stem"] == pytest.approx(20618.4, rel=1e-6)
    assert len(parsed["regions"]) >= 20


def test_parse_aseg_stats_all_fixtures_have_catalogue_regions(bids_fixture_dir):
    for subject in FIXTURE_SUBJECTS:
        path = os.path.join(bids_fixture_dir, subject, "stats", "aseg.stats")
        parsed = parse_aseg_stats(path)
        assert parsed["regions"], f"{subject} produced no catalogue regions"
        assert parsed["icv"] and parsed["icv"] > 1_000_000, f"{subject} ICV implausible"
        for name, volume in parsed["regions"].items():
            assert volume > 0, f"{subject}/{name} has non-positive volume"


def test_bids_freesurfer_loader_links_imaging_to_participants(bids_fixture_dir):
    tables = load_cohort("bids-freesurfer", bids_fixture_dir)

    assert tables.summary()["n_patients"] == len(FIXTURE_SUBJECTS)
    assert tables.modalities_available()["mri"] is True
    assert tables.validate() == []

    # The BIDS subject id must be used, not FreeSurfer's internal subjectname.
    assert set(tables.mri_features["patient_id"]) == set(FIXTURE_SUBJECTS)
    assert set(tables.patients["patient_id"]) == set(FIXTURE_SUBJECTS)

    # ICV normalisation must be populated because the real ICV was parsed.
    normalised = tables.mri_features["normalized_volume"]
    assert normalised.notna().all()
    assert (normalised > 0).all()

    # Real demographics from the matched demographics.csv must come through.
    sexes = tables.patients.set_index("patient_id")["sex"].to_dict()
    assert sexes["sub-CMU_0050646"] == "Male"
    ages = tables.patients.set_index("patient_id")["age"].astype(int).to_dict()
    assert ages["sub-KKI_0050778"] == 22
    assert ages["sub-NYU_0050965"] == 9


def test_bids_loader_on_directory_without_freesurfer(tmp_path):
    tables = load_cohort("bids-freesurfer", str(tmp_path))
    reasons = tables.qc.summary()
    assert "no_freesurfer_aseg_found" in reasons
    assert tables.mri_features.empty


def test_dlbs_loader_reads_real_openneuro_participants(dlbs_dir):
    tables = load_cohort("openneuro-ds004856", dlbs_dir)
    summary = tables.summary()

    assert summary["n_patients"] == 464
    assert summary["n_sessions"] > 0
    assert summary["modalities_available"]["clinical"] is True
    assert summary["modalities_available"]["demographic"] is True
    assert tables.validate() == []

    patients = tables.patients.set_index("patient_id")
    # The loader preserves the dataset's raw codes verbatim; relabelling to
    # human-readable labels is the cohort builder's job and is driven by the
    # data dictionary, so it must be visible here as a passthrough.
    assert set(patients["sex"].unique()) == {"m", "f"}
    assert set(tables.variable_dictionary) >= {"Sex", "Race", "Ethnicity"}
    assert tables.variable_dictionary["Sex"]["Levels"] == {"m": "male", "f": "female"}

    # The published Ethnicity code list (1/2) does not match the data (0/1);
    # the loader keeps the raw codes and carries the dictionary forward so the
    # cohort builder can record the mismatch.
    assert set(patients["ethnicity"].dropna().unique()) <= {"0", "1", 0, 1}
    assert tables.variable_dictionary["Ethnicity"]["Levels"] == {
        "1": "Hispanic/Latin(o/a)", "2": "Non-Hispanic"}

    # Longitudinal MMSE must be present for wave 1 and at least one follow-up.
    clinical = tables.clinical
    assert "mmse" in clinical.columns
    assert clinical["session"].isin(["W1", "W2", "W3"]).all()
    w1 = clinical[clinical["session"] == "W1"]
    assert len(w1) > 400
    assert w1["mmse"].between(0, 30).all()


def test_coded_categorical_columns_stay_textual(dlbs_dir):
    """A fairness axis must not be coerced to float.

    Pandas infers float for a column of numeric-looking codes, which turns the
    ethnicity axis into ``0.0``/``1.0`` and stops it matching the published
    dictionary levels (``"0"``/``"1"``).
    """
    patients = load_cohort("openneuro-ds004856", dlbs_dir).patients
    for column in ("sex", "race", "ethnicity"):
        values = [str(v) for v in patients[column].dropna().unique()]
        assert all(not v.endswith(".0") for v in values), f"{column} -> {values}"
    assert sorted(str(v) for v in patients["ethnicity"].dropna().unique()) == ["0", "1"]
    assert sorted(str(v) for v in patients["race"].dropna().unique()) == [
        "1", "2", "3", "4", "5", "6", "7"]


def test_dlbs_missing_derivatives_are_reported_not_invented(dlbs_dir):
    tables = load_cohort("openneuro-ds004856", dlbs_dir)
    reasons = tables.qc.summary()
    # The imaging and genetic derivatives are git-annexed to OpenNeuro's S3
    # bucket; when absent they must be reported, never fabricated.
    assert tables.mri_features.empty
    assert tables.genetics.empty
    assert "mri_derivative_not_downloaded" in reasons
    assert "genetic_derivative_not_downloaded" in reasons
    assert tables.modalities_available()["mri"] is False
