"""Tests for configuration, hashing, and the reproducibility manifest."""

from __future__ import annotations

import json

from neurolens.config import (
    NeuroLensConfig,
    canonical_json,
    config_from_dict,
    package_versions,
    seed_everything,
    sha256_json,
    sha256_text,
)


def test_canonical_json_is_order_independent():
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})
    assert canonical_json({"a": [1, 2]}) != canonical_json({"a": [2, 1]})


def test_config_hash_is_stable_and_sensitive():
    first = NeuroLensConfig()
    second = NeuroLensConfig()
    assert first.config_hash == second.config_hash
    assert len(first.config_hash) == 16

    changed = NeuroLensConfig()
    changed.split.seed += 1
    assert changed.config_hash != first.config_hash

    retargeted = NeuroLensConfig()
    retargeted.target.outcome_session = "W3"
    assert retargeted.config_hash != first.config_hash


def test_sha_helpers_are_deterministic():
    assert sha256_text("neurolens") == sha256_text("neurolens")
    assert sha256_text("neurolens") != sha256_text("NeuroLens")
    assert sha256_json({"x": 1}) == sha256_json({"x": 1})


def test_config_from_dict_ignores_unknown_keys_and_nests_sections():
    config = config_from_dict({
        "project_name": "Test",
        "data": {"dataset": "bids-freesurfer", "not_a_field": 1},
        "fairness": {"min_subgroup_n": 25},
        "unknown_section": {"a": 1},
    })
    assert config.project_name == "Test"
    assert config.data.dataset == "bids-freesurfer"
    assert config.fairness.min_subgroup_n == 25
    assert config.split.seed == NeuroLensConfig().split.seed


def test_config_round_trips_through_yaml(tmp_path):
    config = NeuroLensConfig()
    path = tmp_path / "config.yaml"
    config.to_yaml(str(path))
    loaded = NeuroLensConfig.from_yaml(str(path))
    assert loaded.config_hash == config.config_hash


def test_config_round_trips_through_json(tmp_path):
    config = NeuroLensConfig()
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config.to_dict()))
    loaded = NeuroLensConfig.from_json(str(path))
    assert loaded.config_hash == config.config_hash


def test_seed_everything_makes_numpy_reproducible():
    seed_everything(42)
    first = __import__("numpy").random.rand(5)
    seed_everything(42)
    second = __import__("numpy").random.rand(5)
    assert (first == second).all()


def test_package_versions_records_the_stack():
    versions = package_versions()
    for key in ("python", "numpy", "pandas", "sklearn", "neurolens"):
        assert key in versions
        assert versions[key]
    assert versions["neurolens"] != "unknown"


def test_default_config_targets_the_open_dataset():
    config = NeuroLensConfig()
    assert config.data.dataset == "openneuro-ds004856"
    # The open default must not require any credentials.
    from neurolens.datasets import resolve_manifest

    assert resolve_manifest(config.data.dataset).access == "open"
