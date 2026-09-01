"""Configuration, provenance hashing, and deterministic seeding for NeuroLens.

Every NeuroLens experiment is described by a single :class:`NeuroLensConfig`.
The configuration is hashed into a ``config_hash`` that appears in the run
manifest, the audit report, the model card, and the UI provenance strip, so a
reader can always tell *which* experiment produced a number.

NeuroLens does not generate data. :class:`DataConfig` names a real dataset from
:data:`neurolens.datasets.MANIFESTS` and a local directory holding it.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import random
import sys
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Any, Dict, List, Optional

import numpy as np

__all__ = [
    "NeuroLensConfig",
    "DataConfig",
    "TargetConfig",
    "SplitConfig",
    "FeatureConfig",
    "ModelConfig",
    "FairnessConfig",
    "UncertaintyConfig",
    "ReportConfig",
    "canonical_json",
    "sha256_text",
    "sha256_json",
    "seed_everything",
    "package_versions",
    "config_from_dict",
]

PREPROCESSING_VERSION = "preproc-v1"
FEATURE_VERSION = "feat-v1"
TARGET_DEFINITION_VERSION = "target-v1"
EXPLANATION_VERSION = "expl-v1"


# --------------------------------------------------------------------------- #
# hashing + determinism
# --------------------------------------------------------------------------- #
def canonical_json(obj: Any) -> str:
    """Serialise ``obj`` to a stable JSON string (sorted keys, no float noise)."""

    def _default(value: Any) -> Any:
        if is_dataclass(value) and not isinstance(value, type):
            return asdict(value)
        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            return float(value)
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, (set, frozenset, tuple)):
            return list(value)
        return str(value)

    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=_default)


def sha256_text(text: str, length: int = 16) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:length]


def sha256_json(obj: Any, length: int = 16) -> str:
    return sha256_text(canonical_json(obj), length)


def seed_everything(seed: int) -> None:
    """Seed ``random`` and NumPy; opportunistically seed GPU backends."""
    seed = int(seed)
    os.environ["PYTHONHASHSEED"] = str(seed)
    random.seed(seed)
    np.random.seed(seed)
    for module_name in ("torch", "tensorflow"):
        module = sys.modules.get(module_name)
        if module is None:
            continue
        try:
            module.manual_seed(seed)  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover - backend-specific
            pass
        try:
            if hasattr(module, "cuda"):
                module.cuda.manual_seed_all(seed)  # type: ignore[attr-defined]
        except Exception:  # pragma: no cover - backend-specific
            pass


def package_versions() -> Dict[str, str]:
    import importlib

    versions: Dict[str, str] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
    }
    for name in ("numpy", "pandas", "scipy", "sklearn", "matplotlib", "joblib", "yaml"):
        try:
            module = importlib.import_module(name)
            versions[name] = getattr(module, "__version__", "unknown")
        except Exception:  # pragma: no cover - optional dependency
            versions[name] = "not-installed"
    try:
        import neurolens

        versions["neurolens"] = neurolens.__version__
    except Exception:  # pragma: no cover
        versions["neurolens"] = "unknown"
    return versions


# --------------------------------------------------------------------------- #
# dataclass helpers
# --------------------------------------------------------------------------- #
def _from_dict(cls: Any, payload: Dict[str, Any]) -> Any:
    if payload is None:
        return cls()
    known = {f.name for f in fields(cls)}
    return cls(**{k: v for k, v in payload.items() if k in known})


def config_from_dict(payload: Dict[str, Any]) -> "NeuroLensConfig":
    payload = dict(payload or {})
    nested = {
        "data": DataConfig,
        "target": TargetConfig,
        "split": SplitConfig,
        "features": FeatureConfig,
        "model": ModelConfig,
        "fairness": FairnessConfig,
        "uncertainty": UncertaintyConfig,
        "report": ReportConfig,
    }
    top_level = {f.name for f in fields(NeuroLensConfig)}
    kwargs: Dict[str, Any] = {}
    for key, value in payload.items():
        if key in nested:
            kwargs[key] = _from_dict(nested[key], value or {})
        elif key in top_level:
            kwargs[key] = value
    return NeuroLensConfig(**kwargs)


@dataclass
class DataConfig:
    """Which real dataset, and where it lives on disk."""

    dataset: str = "openneuro-ds004856"
    """Key into :data:`neurolens.datasets.MANIFESTS`."""
    data_dir: str = "data/raw/ds004856"
    seed: int = 20240917
    require_modalities: List[str] = field(default_factory=list)
    """If non-empty, abort when one of these modalities is unavailable rather
    than degrading. Empty means "run with what the dataset provides"."""


@dataclass
class TargetConfig:
    """Frozen definition of what is being predicted (PRD F4)."""

    outcome_measure: str = "mmse"
    index_session: str = "W1"
    outcome_session: str = "W2"
    annualize: bool = True
    """Express the continuous target as change per year of follow-up."""
    sign_convention: str = "decline_positive"
    """``decline_positive`` reports worsening as a positive number."""
    stage_measure: str = "mmse"
    stage_cutpoints: List[float] = field(default_factory=lambda: [21.0, 27.0])
    # Each cutpoint is the *lower edge* of the band that follows it, compared
    # strictly: [21, 27] with three labels gives < 21 / 21 to < 27 / >= 27.
    stage_labels: List[str] = field(
        default_factory=lambda: ["moderate_or_worse", "mild", "no_impairment"]
    )
    stage_definition: str = "mmse-standard-cutpoints"
    """27/21 are the conventional MMSE interpretation thresholds: >=27 no
    impairment, 21-26 mild impairment, <=20 moderate or worse. They are not
    data-derived, so they cannot be tuned on the test set."""
    stage_ordinal: bool = True
    min_followup_years: float = 1.0
    target_definition_version: str = TARGET_DEFINITION_VERSION


@dataclass
class SplitConfig:
    strategy: str = "patient"
    """``patient`` (grouped, stratified) or ``temporal`` (index-date aware)."""
    test_size: float = 0.20
    validation_size: float = 0.15
    seed: int = 20240917
    stratify: bool = True
    split_version: str = "split-v1"
    temporal_cutoff_quantile: float = 0.7


@dataclass
class FeatureConfig:
    """Which modalities and families may enter each model."""

    modalities: List[str] = field(
        default_factory=lambda: ["mri", "genetics", "clinical", "demographic"]
    )
    use_normalized_volumes: bool = True
    use_raw_volumes: bool = False
    mri_systems: List[str] = field(default_factory=lambda: [
        "basal ganglia", "ventricular", "thalamus", "medial temporal",
        "cortex", "white matter", "cerebellum", "brain stem",
    ])
    clinical_variables: List[str] = field(default_factory=lambda: ["mmse", "bmi_w1"])
    demographic_variables: List[str] = field(
        default_factory=lambda: ["age_at_index", "sex", "education_years", "handedness_score"]
    )
    genetic_variables: List[str] = field(default_factory=lambda: ["cag_repeat_length"])
    feature_version: str = FEATURE_VERSION


@dataclass
class ModelConfig:
    families: List[str] = field(default_factory=lambda: ["ridge", "logistic", "gradient_boosting"])
    comparisons: List[str] = field(default_factory=lambda: ["mri_only", "multimodal"])
    mitigations: List[str] = field(default_factory=lambda: ["none", "reweighting", "group_aware"])
    fairness_axis_for_mitigation: str = "sex"
    seeds: List[int] = field(default_factory=lambda: [20240917])
    ensemble_members: int = 8
    ridge_alpha: float = 3.0
    logistic_C: float = 0.5
    gbt_max_depth: Optional[int] = 3
    gbt_max_iter: int = 160
    gbt_learning_rate: float = 0.08
    gbt_min_samples_leaf: int = 20
    max_overall_degradation: float = 0.05
    """Mitigation selection rule (PRD F9): a mitigated model may lose at most
    this fraction of overall performance to improve the worst group."""


@dataclass
class FairnessConfig:
    axes: List[str] = field(
        default_factory=lambda: ["sex", "age_strata", "education_strata", "race", "ethnicity"]
    )
    intersectional_axes: List[List[str]] = field(
        default_factory=lambda: [["sex", "age_strata"]]
    )
    age_cuts: List[float] = field(default_factory=lambda: [45.0, 65.0])
    education_cuts: List[float] = field(default_factory=lambda: [13.0, 16.0])
    min_subgroup_n: int = 30
    """At or above this a subgroup estimate is ADEQUATE."""
    min_reportable_n: int = 10
    """Between this and ``min_subgroup_n`` the estimate is EXPLORATORY; below it
    the subgroup is reported as INSUFFICIENT DATA with its n."""
    relative_gap_warn: float = 0.20
    calibration_gap_warn: float = 0.05
    n_bootstrap: int = 1000
    bootstrap_seed: int = 12345


@dataclass
class UncertaintyConfig:
    method: str = "ensemble_conformal"
    alpha: float = 0.10
    conformal: str = "split"
    """``split`` (marginal) or ``mondrian`` (group-conditional)."""
    mondrian_axis: str = "sex"
    ood_method: str = "mahalanobis_knn"
    ood_threshold_quantile: float = 0.95
    knn_k: int = 10
    abstain_quantile: float = 0.85
    shift_cohort: Dict[str, Any] = field(
        default_factory=lambda: {"column": "age_at_index", "operator": ">=", "value": 75.0}
    )
    """Held-out distribution-shift cohort used to evaluate OOD detection."""


@dataclass
class ReportConfig:
    output_dir: str = "runs"
    figures_dpi: int = 150
    include_figures: bool = True
    representative_cases: int = 6
    explanation_background_size: int = 32
    explanation_coalitions: int = 256
    explanation_seed: int = 777
    formats: List[str] = field(default_factory=lambda: ["json", "markdown", "html"])


@dataclass
class NeuroLensConfig:
    project_name: str = "NeuroLens Progression Audit"
    research_question: str = (
        "Can imaging, genetic, and baseline clinical variables predict longitudinal "
        "neurodegenerative progression, and how reliable is that prediction across "
        "genetic and demographic subgroups?"
    )
    run_label: str = "auto"
    seed: int = 20240917
    data: DataConfig = field(default_factory=DataConfig)
    target: TargetConfig = field(default_factory=TargetConfig)
    split: SplitConfig = field(default_factory=SplitConfig)
    features: FeatureConfig = field(default_factory=FeatureConfig)
    model: ModelConfig = field(default_factory=ModelConfig)
    fairness: FairnessConfig = field(default_factory=FairnessConfig)
    uncertainty: UncertaintyConfig = field(default_factory=UncertaintyConfig)
    report: ReportConfig = field(default_factory=ReportConfig)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def config_hash(self) -> str:
        return sha256_json(self.to_dict())

    @classmethod
    def from_yaml(cls, path: str) -> "NeuroLensConfig":
        import yaml

        with open(path, "r", encoding="utf-8") as handle:
            return config_from_dict(yaml.safe_load(handle) or {})

    @classmethod
    def from_json(cls, path: str) -> "NeuroLensConfig":
        with open(path, "r", encoding="utf-8") as handle:
            return config_from_dict(json.load(handle))

    def to_yaml(self, path: str) -> None:
        import yaml

        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            yaml.safe_dump(self.to_dict(), handle, sort_keys=True)
