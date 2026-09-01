"""Shared fixtures.

Everything here operates on real data:

* ``tests/data/bids_freesurfer_fixture`` — real FreeSurfer ``aseg.stats`` output
  plus real demographics (see ``SOURCES.md`` in that directory).
* ``data/raw/ds004856`` — the real OpenNeuro DLBS ``participants.tsv`` (CC0),
  downloaded on demand. Tests that need it skip cleanly when it is unavailable.
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FIXTURE_DIR = os.path.join(REPO_ROOT, "tests", "data", "bids_freesurfer_fixture")
DLBS_DIR = os.path.join(REPO_ROOT, "data", "raw", "ds004856")


@pytest.fixture(scope="session")
def bids_fixture_dir() -> str:
    assert os.path.isdir(FIXTURE_DIR), f"missing real fixture at {FIXTURE_DIR}"
    return FIXTURE_DIR


@pytest.fixture(scope="session")
def dlbs_dir() -> str:
    """Real DLBS participants.tsv, fetched once per session if not present."""
    target = os.path.join(DLBS_DIR, "participants.tsv")
    if not os.path.exists(target):
        from neurolens.datasets import fetch_openneuro_tabular

        try:
            written = fetch_openneuro_tabular("ds004856", DLBS_DIR)
        except Exception:
            written = {}
        if not written.get("participants.tsv"):
            pytest.skip(
                "OpenNeuro ds004856 metadata is not available offline and could not "
                "be downloaded; run `neurolens fetch-data --dataset openneuro-ds004856`."
            )
    return DLBS_DIR


@pytest.fixture(scope="session")
def dlbs_cohort(dlbs_dir):
    from neurolens.config import NeuroLensConfig
    from neurolens.cohort import build_cohort
    from neurolens.datasets import load_cohort

    config = NeuroLensConfig()
    config.data.data_dir = dlbs_dir
    return build_cohort(load_cohort(config.data.dataset, dlbs_dir), config)


@pytest.fixture(scope="session")
def smoke_run(dlbs_dir, tmp_path_factory):
    """One real end-to-end run, reused by the pipeline and API tests."""
    from neurolens.config import NeuroLensConfig
    from neurolens.pipeline import smoke_test

    config = NeuroLensConfig()
    config.data.data_dir = dlbs_dir
    config.report.output_dir = str(tmp_path_factory.mktemp("runs"))
    result = smoke_test(config)
    result["config"] = config
    return result


@pytest.fixture(scope="session")
def figure_run(dlbs_dir, tmp_path_factory):
    """A real run with figures enabled.

    ``smoke_test`` turns figures off, so an API test that iterates the report's
    figure map would silently pass without loading a single image. This fixture
    produces real PNGs so the key-to-filename mapping is actually exercised.
    """
    from neurolens.config import NeuroLensConfig
    from neurolens.pipeline import NeuroLensPipeline

    config = NeuroLensConfig()
    config.data.data_dir = dlbs_dir
    config.model.ensemble_members = 2
    config.model.families = ["ridge", "logistic"]
    config.model.mitigations = ["none"]
    config.fairness.n_bootstrap = 50
    config.report.include_figures = True
    config.report.explanation_coalitions = 32
    config.report.output_dir = str(tmp_path_factory.mktemp("figures"))
    return NeuroLensPipeline(config).run()
