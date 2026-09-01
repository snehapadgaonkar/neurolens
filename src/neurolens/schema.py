"""NeuroLens data-model entities, QC ledger, and neuroanatomical feature map.

The entity set follows PRD section 7 (Data Model Sketch): Patient,
ImagingSession, MRIFeatures, GeneticProfile, ClinicalAssessment, Outcome,
Split, ExperimentRun, Prediction, AuditResult, Explanation, ModelCard.

Nothing in this module invents data. Every entity is populated by a dataset
loader in :mod:`neurolens.datasets` from files that actually exist on disk.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

import pandas as pd

__all__ = [
    "CohortTables",
    "QCLedger",
    "QCRecord",
    "REGION_CATALOG",
    "ICV_KEY",
    "anatomical_label",
    "region_family",
]

ICV_KEY = "EstimatedTotalIntraCranialVol"

# --------------------------------------------------------------------------- #
# Neuroanatomical catalogue
# --------------------------------------------------------------------------- #
# Maps FreeSurfer `aseg` structure names (the column `StructName` in
# ``aseg.stats``) to a canonical NeuroLens feature key, a human-readable
# anatomical label, and an anatomical system. The anatomical system is what the
# UI and the audit report use to group contributors.
REGION_CATALOG: Dict[str, Dict[str, str]] = {
    "Left-Lateral-Ventricle": dict(key="lat_ventricle_left", label="Lateral ventricle (left)", system="ventricular"),
    "Right-Lateral-Ventricle": dict(key="lat_ventricle_right", label="Lateral ventricle (right)", system="ventricular"),
    "3rd-Ventricle": dict(key="third_ventricle", label="Third ventricle", system="ventricular"),
    "4th-Ventricle": dict(key="fourth_ventricle", label="Fourth ventricle", system="ventricular"),
    "Left-Inf-Lat-Vent": dict(key="inf_lat_ventricle_left", label="Inferior lateral ventricle (left)", system="ventricular"),
    "Right-Inf-Lat-Vent": dict(key="inf_lat_ventricle_right", label="Inferior lateral ventricle (right)", system="ventricular"),
    "Left-Caudate": dict(key="caudate_left", label="Caudate nucleus (left)", system="basal ganglia"),
    "Right-Caudate": dict(key="caudate_right", label="Caudate nucleus (right)", system="basal ganglia"),
    "Left-Putamen": dict(key="putamen_left", label="Putamen (left)", system="basal ganglia"),
    "Right-Putamen": dict(key="putamen_right", label="Putamen (right)", system="basal ganglia"),
    "Left-Pallidum": dict(key="pallidum_left", label="Globus pallidus (left)", system="basal ganglia"),
    "Right-Pallidum": dict(key="pallidum_right", label="Globus pallidus (right)", system="basal ganglia"),
    "Left-Accumbens-area": dict(key="accumbens_left", label="Nucleus accumbens (left)", system="basal ganglia"),
    "Right-Accumbens-area": dict(key="accumbens_right", label="Nucleus accumbens (right)", system="basal ganglia"),
    "Left-Thalamus-Proper": dict(key="thalamus_left", label="Thalamus (left)", system="thalamus"),
    "Right-Thalamus-Proper": dict(key="thalamus_right", label="Thalamus (right)", system="thalamus"),
    "Left-Hippocampus": dict(key="hippocampus_left", label="Hippocampus (left)", system="medial temporal"),
    "Right-Hippocampus": dict(key="hippocampus_right", label="Hippocampus (right)", system="medial temporal"),
    "Left-Amygdala": dict(key="amygdala_left", label="Amygdala (left)", system="medial temporal"),
    "Right-Amygdala": dict(key="amygdala_right", label="Amygdala (right)", system="medial temporal"),
    "Left-Cerebellum-Cortex": dict(key="cerebellum_left", label="Cerebellar cortex (left)", system="cerebellum"),
    "Right-Cerebellum-Cortex": dict(key="cerebellum_right", label="Cerebellar cortex (right)", system="cerebellum"),
    "Brain-Stem": dict(key="brain_stem", label="Brain stem", system="brain stem"),
    "Left-Cerebral-Cortex": dict(key="cortex_left", label="Cerebral cortex (left)", system="cortex"),
    "Right-Cerebral-Cortex": dict(key="cortex_right", label="Cerebral cortex (right)", system="cortex"),
    "Left-Cerebral-White-Matter": dict(key="white_matter_left", label="Cerebral white matter (left)", system="white matter"),
    "Right-Cerebral-White-Matter": dict(key="white_matter_right", label="Cerebral white matter (right)", system="white matter"),
}

# HD-relevant regions come first: they are the structures the PRD names
# explicitly (caudate, putamen, ventricles) and are prioritised in reports.
PRIORITY_REGIONS: List[str] = [
    "Left-Caudate",
    "Right-Caudate",
    "Left-Putamen",
    "Right-Putamen",
    "Left-Pallidum",
    "Right-Pallidum",
    "Left-Lateral-Ventricle",
    "Right-Lateral-Ventricle",
    "Left-Thalamus-Proper",
    "Right-Thalamus-Proper",
    "Left-Hippocampus",
    "Right-Hippocampus",
    "Left-Accumbens-area",
    "Right-Accumbens-area",
]


def anatomical_label(feature_or_struct: str) -> str:
    """Human-readable anatomical label for a feature key or aseg structure name."""
    if feature_or_struct in REGION_CATALOG:
        return REGION_CATALOG[feature_or_struct]["label"]
    for entry in REGION_CATALOG.values():
        if entry["key"] == feature_or_struct:
            return entry["label"]
    return feature_or_struct.replace("_", " ")


def region_family(feature: str) -> str:
    """Anatomical system for a feature key ('' when not an MRI region)."""
    for entry in REGION_CATALOG.values():
        if entry["key"] == feature:
            return entry["system"]
    return ""


# --------------------------------------------------------------------------- #
# QC ledger — PRD F2: "Log every excluded scan and its reason. Never silently
# drop samples."
# --------------------------------------------------------------------------- #
@dataclass
class QCRecord:
    """One exclusion or degradation event, retained for the audit report."""

    entity_type: str
    entity_id: str
    reason: str
    severity: str = "exclusion"
    detail: str = ""
    stage: str = "qc"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class QCLedger:
    """Append-only record of every sample that did not make it into the cohort."""

    def __init__(self) -> None:
        self.records: List[QCRecord] = []

    def add(self, entity_type: str, entity_id: str, reason: str,
            severity: str = "exclusion", detail: str = "", stage: str = "qc") -> None:
        self.records.append(
            QCRecord(entity_type, str(entity_id), reason, severity, detail, stage)
        )

    def to_frame(self) -> pd.DataFrame:
        if not self.records:
            return pd.DataFrame(
                columns=["entity_type", "entity_id", "reason", "severity", "detail", "stage"]
            )
        return pd.DataFrame([r.to_dict() for r in self.records])

    def summary(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for record in self.records:
            counts[record.reason] = counts.get(record.reason, 0) + 1
        return dict(sorted(counts.items(), key=lambda kv: -kv[1]))

    def __len__(self) -> int:
        return len(self.records)


# --------------------------------------------------------------------------- #
# Cohort container
# --------------------------------------------------------------------------- #
@dataclass
class CohortTables:
    """Everything a loader produced for one dataset, plus its provenance."""

    dataset_key: str
    dataset_version: str
    patients: pd.DataFrame = field(default_factory=pd.DataFrame)
    sessions: pd.DataFrame = field(default_factory=pd.DataFrame)
    mri_features: pd.DataFrame = field(default_factory=pd.DataFrame)
    genetics: pd.DataFrame = field(default_factory=pd.DataFrame)
    clinical: pd.DataFrame = field(default_factory=pd.DataFrame)
    variable_dictionary: Dict[str, Any] = field(default_factory=dict)
    source_manifest: Dict[str, Any] = field(default_factory=dict)
    qc: QCLedger = field(default_factory=QCLedger)
    #: Columns the loader found, per table. Used by the audit report.
    observed_columns: Dict[str, List[str]] = field(default_factory=dict)

    def modalities_available(self) -> Dict[str, bool]:
        return {
            "mri": not self.mri_features.empty,
            "genetics": not self.genetics.empty,
            "clinical": not self.clinical.empty,
            "demographic": not self.patients.empty,
        }

    def summary(self) -> Dict[str, Any]:
        return {
            "dataset_key": self.dataset_key,
            "dataset_version": self.dataset_version,
            "n_patients": int(self.patients["patient_id"].nunique()) if not self.patients.empty else 0,
            "n_sessions": int(self.sessions["session_id"].nunique()) if not self.sessions.empty else 0,
            "n_mri_feature_rows": int(len(self.mri_features)),
            "n_clinical_rows": int(len(self.clinical)),
            "n_genetic_rows": int(len(self.genetics)),
            "modalities_available": self.modalities_available(),
            "qc_events": len(self.qc),
            "qc_reasons": self.qc.summary(),
            "observed_columns": self.observed_columns,
        }

    def validate(self) -> List[str]:
        """Structural validation run before any modelling. Returns problem list."""
        problems: List[str] = []
        if self.patients.empty:
            problems.append("patients table is empty")
        elif "patient_id" not in self.patients.columns:
            problems.append("patients table has no patient_id column")
        if not self.sessions.empty and "patient_id" not in self.sessions.columns:
            problems.append("sessions table has no patient_id column")
        if not self.patients.empty and self.patients["patient_id"].duplicated().any():
            problems.append("patients table contains duplicate patient_id values")
        if not self.sessions.empty and not self.patients.empty:
            orphan = set(self.sessions["patient_id"]) - set(self.patients["patient_id"])
            if orphan:
                problems.append(f"{len(orphan)} sessions reference unknown patients")
        return problems
