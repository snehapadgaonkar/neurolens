"""Cohort construction, target freeze, leakage-safe splits, and feature building.

This module turns a loaded :class:`~neurolens.schema.CohortTables` into the
single analysis table that every model, audit, and explanation in NeuroLens is
computed from. Three PRD requirements drive its shape:

* **No patient appears in more than one partition** (F1) — splits are grouped by
  patient and verified, with the verification result hashed into ``split_hash``.
* **No future information enters the features** (F3/F4) — the design matrix is
  built exclusively from the index session, while the target is built
  exclusively from a later session.
* **Nothing is dropped silently** (F2) — every exclusion is recorded in the QC
  ledger with its reason and appears in the audit report.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from neurolens.config import NeuroLensConfig
from neurolens.schema import CohortTables, QCLedger, anatomical_label, region_family

__all__ = ["CohortResult", "build_cohort", "make_splits", "FeatureBuilder", "derive_groups"]

MISSING_TOKENS = {"", "n/a", "NA", "NaN", "nan", "xx", "None", "none", "."}


def _to_numeric(series: pd.Series) -> pd.Series:
    cleaned = series.astype("object").where(~series.astype(str).str.strip().isin(MISSING_TOKENS))
    return pd.to_numeric(cleaned, errors="coerce")


# --------------------------------------------------------------------------- #
# Fairness group derivation
# --------------------------------------------------------------------------- #
def derive_groups(analysis: pd.DataFrame, cfg: NeuroLensConfig) -> pd.DataFrame:
    """Add one column per fairness axis plus the distribution-shift flag."""
    out = analysis.copy()
    fair = cfg.fairness

    if "age_at_index" in out.columns:
        cuts = list(fair.age_cuts)
        labels = [f"age_lt{int(cuts[0])}"]
        labels += [f"age_{int(a)}_to_{int(b)}" for a, b in zip(cuts, cuts[1:])]
        labels.append(f"age_ge{int(cuts[-1])}")
        out["age_strata"] = pd.cut(
            _to_numeric(out["age_at_index"]), bins=[-np.inf, *cuts, np.inf], labels=labels
        ).astype("object")

    if "education_years" in out.columns:
        cuts = list(fair.education_cuts)
        labels = [f"edu_lt{int(cuts[0])}"]
        labels += [f"edu_{int(a)}_to_{int(b)}" for a, b in zip(cuts, cuts[1:])]
        labels.append(f"edu_ge{int(cuts[-1])}")
        out["education_strata"] = pd.cut(
            _to_numeric(out["education_years"]), bins=[-np.inf, *cuts, np.inf], labels=labels
        ).astype("object")

    for axis in ("sex", "race", "ethnicity", "site_id", "cohort_id"):
        if axis in out.columns:
            out[axis] = out[axis].astype("object").where(
                ~out[axis].astype(str).str.strip().isin(MISSING_TOKENS)
            )

    if "stage_at_index" in out.columns:
        out["baseline_stage"] = out["stage_at_index"]

    shift = cfg.uncertainty.shift_cohort or {}
    column = shift.get("column")
    out["is_shift_cohort"] = False
    if column and column in out.columns:
        values = _to_numeric(out[column])
        operator = shift.get("operator", ">=")
        threshold = float(shift.get("value", np.nan))
        if operator == ">=":
            out["is_shift_cohort"] = (values >= threshold).fillna(False)
        elif operator == ">":
            out["is_shift_cohort"] = (values > threshold).fillna(False)
        elif operator == "<=":
            out["is_shift_cohort"] = (values <= threshold).fillna(False)
        else:
            out["is_shift_cohort"] = (values < threshold).fillna(False)
    return out


# --------------------------------------------------------------------------- #
# Feature building
# --------------------------------------------------------------------------- #
@dataclass
class FeatureBuilder:
    """Builds numeric design matrices for a named modality subset.

    Feature families are tracked so explanations can be grouped into MRI /
    genetic / clinical / demographic, exactly as the case view requires.
    """

    config: NeuroLensConfig
    analysis: pd.DataFrame
    column_families: Dict[str, str] = field(default_factory=dict)
    column_labels: Dict[str, str] = field(default_factory=dict)

    def available_families(self) -> Dict[str, bool]:
        return {
            family: any(f == family for f in self.column_families.values())
            for family in ("mri", "genetics", "clinical", "demographic")
        }

    def names(self) -> List[str]:
        return list(self.column_families)

    def family_of(self, feature: str) -> str:
        return self.column_families.get(feature, "other")

    def label_of(self, feature: str) -> str:
        return self.column_labels.get(feature, feature)

    def names_for(self, modalities: Sequence[str]) -> List[str]:
        """Column names belonging to the requested modalities."""
        wanted = {m for m in modalities}
        return [c for c, fam in self.column_families.items() if fam in wanted]

    def matrix(self, modalities: Sequence[str]) -> pd.DataFrame:
        """Design matrix restricted to the requested modalities."""
        return self.analysis[self.names_for(modalities)].astype(float)

    def modalities_present(self, modalities: Sequence[str]) -> List[str]:
        return [m for m in modalities if any(f == m for f in self.column_families.values())]


def _encode_categorical(frame: pd.DataFrame, column: str, min_support: int = 5
                        ) -> Dict[str, pd.Series]:
    """One-hot encode with the most frequent level held out as the reference.

    Keeping every level would make the design matrix exactly collinear, which
    destabilises the linear baseline and makes its coefficients uninterpretable.
    """
    values = frame[column].astype(str).str.strip()
    values = values.where(~values.isin(MISSING_TOKENS))
    counts = values.value_counts()
    kept = [level for level, count in counts.items()
            if count >= min_support and level not in ("nan", "None")]
    if len(kept) < 2:
        return {}
    reference = max(kept, key=lambda level: counts[level])
    encoded: Dict[str, pd.Series] = {}
    for level in sorted(set(kept) - {reference}):
        encoded[f"{column}_{level}"] = (values == level).astype(float)
    return encoded


def build_feature_builder(analysis: pd.DataFrame, cfg: NeuroLensConfig) -> FeatureBuilder:
    """Attach feature columns, families, and human-readable labels."""
    builder = FeatureBuilder(config=cfg, analysis=analysis)
    spec = cfg.features

    # --- MRI ------------------------------------------------------------ #
    mri_prefixes = ("mri_norm_", "mri_raw_")
    for column in analysis.columns:
        if column.startswith(mri_prefixes):
            region = column.split("_", 2)[2]
            builder.column_families[column] = "mri"
            system = region_family(region)
            label = anatomical_label(region)
            unit = "ICV-normalised" if column.startswith("mri_norm_") else "raw mm^3"
            builder.column_labels[column] = f"{label} ({unit})"
            if system and system not in spec.mri_systems:
                builder.column_families[column] = "mri_excluded_system"

    # --- Genetics ------------------------------------------------------- #
    for column in spec.genetic_variables:
        if column in analysis.columns and _to_numeric(analysis[column]).notna().any():
            builder.column_families[column] = "genetics"
            builder.column_labels[column] = column.replace("_", " ")

    # --- Clinical ------------------------------------------------------- #
    for column in spec.clinical_variables:
        # Clinical variables are stored at the index time, so accept either the
        # bare name or the explicit `<name>_at_index` column produced by the
        # index/outcome builder.
        resolved = column if column in analysis.columns else f"{column}_at_index"
        if resolved in analysis.columns and _to_numeric(analysis[resolved]).notna().any():
            builder.column_families[resolved] = "clinical"
            builder.column_labels[resolved] = resolved.replace("_", " ")

    # --- Demographic ---------------------------------------------------- #
    for column in spec.demographic_variables:
        if column not in analysis.columns:
            continue
        if _to_numeric(analysis[column]).notna().sum() >= max(5, int(0.5 * len(analysis))):
            builder.analysis[column] = _to_numeric(analysis[column])
            builder.column_families[column] = "demographic"
            builder.column_labels[column] = column.replace("_", " ")
        else:
            encoded = _encode_categorical(analysis, column)
            for name, series in encoded.items():
                builder.analysis[name] = series
                builder.column_families[name] = "demographic"
                builder.column_labels[name] = name.replace("_", " ")

    # Fill remaining gaps with the column median so a missing value never
    # silently becomes a zero-effect feature; the gap is reported in the audit.
    for column in list(builder.column_families):
        if column in builder.analysis.columns:
            series = builder.analysis[column]
            if series.isna().any():
                builder.analysis[column] = series.fillna(series.median(numeric_only=True))

    return builder


# --------------------------------------------------------------------------- #
# Splits
# --------------------------------------------------------------------------- #
def make_splits(analysis: pd.DataFrame, cfg: NeuroLensConfig,
                qc: QCLedger) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Patient-level, optionally stratified, train/validation/test partition."""
    from sklearn.model_selection import GroupShuffleSplit

    patients = analysis["patient_id"].astype(str)
    unique = np.array(sorted(patients.unique()))
    rng = np.random.default_rng(cfg.split.seed)
    permuted = rng.permutation(unique)

    stratify_column = None
    if cfg.split.stratify and "stage_at_index" in analysis.columns:
        mode_stage = analysis["stage_at_index"].mode()
        stratify_column = "stage_at_index" if not mode_stage.empty else None

    if stratify_column:
        # Stratified grouping: partition each stratum separately so that small
        # classes are represented in every partition.
        assignment: Dict[str, str] = {}
        for stage, block in analysis.groupby(stratify_column, dropna=False):
            block_patients = np.array(sorted(block["patient_id"].astype(str).unique()))
            # The stratum salt must be a stable hash. Python's built-in hash() for
            # str is randomised per process, which would reshuffle the split on
            # every run and break the reproducibility manifest.
            salt = int(hashlib.sha256(str(stage).encode("utf-8")).hexdigest()[:8], 16)
            block_rng = np.random.default_rng(cfg.split.seed + salt % 10_000)
            block_patients = block_rng.permutation(block_patients)
            n_test = max(1, int(round(len(block_patients) * cfg.split.test_size)))
            n_val = max(1, int(round(len(block_patients) * cfg.split.validation_size)))
            for i, patient in enumerate(block_patients):
                assignment[patient] = "test" if i < n_test else ("validation" if i < n_test + n_val else "train")
        # Guarantee the overall proportions are close even when strata are tiny.
        for patient in permuted:
            assignment.setdefault(patient, "train")
    else:
        splitter = GroupShuffleSplit(
            n_splits=1, test_size=cfg.split.test_size, random_state=cfg.split.seed
        )
        train_val_idx, test_idx = next(splitter.split(analysis, groups=patients))
        train_val = analysis.iloc[train_val_idx]
        inner = GroupShuffleSplit(
            n_splits=1,
            test_size=cfg.split.validation_size / max(1e-9, 1 - cfg.split.test_size),
            random_state=cfg.split.seed + 1,
        )
        tr_idx, va_idx = next(inner.split(train_val, groups=train_val["patient_id"].astype(str)))
        train_patients = set(train_val.iloc[tr_idx]["patient_id"].astype(str))
        val_patients = set(train_val.iloc[va_idx]["patient_id"].astype(str))
        assignment = {}
        for patient in unique:
            if patient in train_patients:
                assignment[patient] = "train"
            elif patient in val_patients:
                assignment[patient] = "validation"
            else:
                assignment[patient] = "test"

    splits = pd.DataFrame({
        "patient_id": unique,
        "split_name": [assignment[p] for p in unique],
        "split_version": cfg.split.split_version,
        "seed": cfg.split.seed,
        "strategy": cfg.split.strategy,
    })

    # --- leakage verification (PRD success metric: 0 shared patients) ----- #
    per_split = {name: set(group["patient_id"]) for name, group in splits.groupby("split_name")}
    overlaps = {
        f"{a}∩{b}": sorted(per_split.get(a, set()) & per_split.get(b, set()))
        for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))
    }
    n_overlap = sum(len(v) for v in overlaps.values())
    for pair, shared in overlaps.items():
        for patient in shared:
            qc.add("split", patient, "patient_in_multiple_partitions", severity="error",
                   detail=f"shared between {pair}", stage="split")

    splits["split_hash"] = hashlib.sha256(
        "|".join(f"{r.patient_id}:{r.split_name}" for r in splits.itertuples()).encode()
    ).hexdigest()[:16]

    info = {
        "split_version": cfg.split.split_version,
        "strategy": cfg.split.strategy,
        "seed": cfg.split.seed,
        "split_hash": str(splits["split_hash"].iloc[0]),
        "counts": {name: int(len(group)) for name, group in splits.groupby("split_name")},
        "n_patients": int(len(splits)),
        "patient_overlap": {k: len(v) for k, v in overlaps.items()},
        "total_overlap": int(n_overlap),
        "leakage_free": bool(n_overlap == 0),
        "stratified_on": stratify_column,
    }
    return splits, info


# --------------------------------------------------------------------------- #
# Cohort assembly
# --------------------------------------------------------------------------- #
@dataclass
class CohortResult:
    analysis: pd.DataFrame
    splits: pd.DataFrame
    split_info: Dict[str, Any]
    qc: QCLedger
    features: FeatureBuilder
    tables: CohortTables
    audit: Dict[str, Any] = field(default_factory=dict)


def _canonical_code(value: Any) -> str:
    """Normalise a coded value so 5, 5.0 and '5' all map to the same key."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text


def _apply_data_dictionary_levels(frame: pd.DataFrame, dictionary: Dict[str, Any],
                                 qc: Optional[QCLedger] = None) -> pd.DataFrame:
    """Replace coded values with the labels published in the dataset's own
    data dictionary (e.g. ``Race`` 5 -> "White/Caucasian").

    Using the source dictionary rather than a hand-written map keeps the audit
    report's subgroup labels traceable to the dataset that produced them.
    """
    if not dictionary or frame.empty:
        return frame
    out = frame.copy()
    # Loaders normalise column names to lower case, so match the dictionary
    # case-insensitively rather than requiring an exact name match.
    by_lower = {name.lower(): name for name in out.columns}
    for dictionary_column, meta in dictionary.items():
        if not isinstance(meta, dict):
            continue
        column = by_lower.get(str(dictionary_column).lower())
        if column is None:
            continue
        levels = meta.get("Levels")
        if not isinstance(levels, dict) or not levels:
            continue
        mapping = {_canonical_code(code): str(label) for code, label in levels.items()}
        keys = out[column].map(_canonical_code)
        matched = float(keys.isin(list(mapping)).mean())
        if matched >= 0.5:
            out[column] = keys.map(mapping).fillna(keys.replace("", np.nan))
        elif qc is not None:
            # The published code list does not match the observed values. Guess
            # would be worse than leaving the codes in place, so record it.
            qc.add("variable_dictionary", column, "coded_levels_do_not_match_data",
                   severity="warning",
                   detail=f"only {matched:.0%} of observed codes appear in the published "
                          f"Levels for '{dictionary_column}'; raw codes retained",
                   stage="ingest")
    return out


def _index_and_outcome(tables: CohortTables, cfg: NeuroLensConfig,
                       qc: QCLedger) -> pd.DataFrame:
    """Build one row per patient with index-session state and future outcome."""
    if tables.sessions.empty:
        raise ValueError("dataset provides no sessions; cannot define an index time")

    sessions = tables.sessions.copy()
    sessions["patient_id"] = sessions["patient_id"].astype(str)
    if "session" not in sessions.columns:
        sessions["session"] = sessions.get("session_id", "")
    if "time_years" not in sessions.columns:
        sessions["time_years"] = 0.0
    sessions["time_years"] = _to_numeric(sessions["time_years"]).fillna(0.0)

    index_sessions = sessions[sessions["session"].astype(str) == cfg.target.index_session]
    if index_sessions.empty:
        raise ValueError(
            f"no session labelled '{cfg.target.index_session}' in this dataset "
            f"(available: {sorted(sessions['session'].astype(str).unique())})"
        )
    index_sessions = index_sessions.sort_values("time_years").drop_duplicates(
        "patient_id", keep="first"
    )
    clinical = tables.clinical.copy() if not tables.clinical.empty else pd.DataFrame()
    if not clinical.empty:
        clinical["patient_id"] = clinical["patient_id"].astype(str)
        clinical["session"] = clinical["session"].astype(str)

    rows: List[Dict[str, Any]] = []
    for record in index_sessions.to_dict("records"):
        patient = record["patient_id"]
        row: Dict[str, Any] = {
            "patient_id": patient,
            "index_session": cfg.target.index_session,
            "index_session_id": record.get("session_id"),
            "index_time_years": float(record.get("time_years", 0.0)),
            "age_at_index": record.get("age_years", np.nan),
        }

        if not clinical.empty:
            index_row = clinical[
                (clinical["patient_id"] == patient)
                & (clinical["session"] == cfg.target.index_session)
            ]
            outcome_row = clinical[
                (clinical["patient_id"] == patient)
                & (clinical["session"] == cfg.target.outcome_session)
            ]
            measure = cfg.target.outcome_measure
            if not index_row.empty and measure in index_row.columns:
                row[f"{measure}_at_index"] = _to_numeric(
                    pd.Series([index_row.iloc[0][measure]])
                ).iloc[0]
            if not outcome_row.empty and measure in outcome_row.columns:
                row[f"{measure}_at_outcome"] = _to_numeric(
                    pd.Series([outcome_row.iloc[0][measure]])
                ).iloc[0]
                row["followup_years"] = float(outcome_row.iloc[0].get(
                    "assessment_time_years", np.nan
                )) - float(record.get("time_years", 0.0))
                row["outcome_session"] = cfg.target.outcome_session

        rows.append(row)

    frame = pd.DataFrame(rows)

    # Demographics
    if not tables.patients.empty:
        patients = tables.patients.copy()
        patients["patient_id"] = patients["patient_id"].astype(str)
        patients = patients.drop_duplicates("patient_id", keep="first")
        frame = frame.merge(patients, on="patient_id", how="left")
        frame = _apply_data_dictionary_levels(frame, tables.variable_dictionary, qc)

    # MRI at the index session, pivoted to one column per region.
    if not tables.mri_features.empty:
        mri = tables.mri_features.copy()
        mri["patient_id"] = mri["patient_id"].astype(str)
        if "session" in mri.columns:
            mri = mri[mri["session"].astype(str) == cfg.target.index_session]
        mri = mri.drop_duplicates(["patient_id", "region"], keep="first")
        for kind, column in (("norm", "normalized_volume"), ("raw", "raw_volume")):
            if column not in mri.columns:
                continue
            wide = mri.pivot_table(index="patient_id", columns="region", values=column,
                                   aggfunc="first")
            wide.columns = [f"mri_{kind}_{c}" for c in wide.columns]
            frame = frame.merge(wide.reset_index(), on="patient_id", how="left")

    # Genetics (patient-level)
    if not tables.genetics.empty:
        genetics = tables.genetics.copy()
        genetics["patient_id"] = genetics["patient_id"].astype(str)
        genetics = genetics.drop_duplicates("patient_id", keep="first")
        shared = [c for c in genetics.columns if c != "patient_id"]
        frame = frame.merge(genetics[["patient_id", *shared]], on="patient_id", how="left")

    return frame


def _apply_targets(frame: pd.DataFrame, cfg: NeuroLensConfig, qc: QCLedger) -> pd.DataFrame:
    out = frame.copy()
    measure = cfg.target.outcome_measure
    index_col = f"{measure}_at_index"
    outcome_col = f"{measure}_at_outcome"

    if index_col in out.columns and outcome_col in out.columns:
        raw_change = out[outcome_col] - out[index_col]
        if cfg.target.annualize and "followup_years" in out.columns:
            years = out["followup_years"].replace(0, np.nan)
            out["progression_rate"] = raw_change / years
        else:
            out["progression_rate"] = raw_change
        if cfg.target.sign_convention == "decline_positive":
            out["progression_rate"] = -out["progression_rate"]
        out["target_continuous"] = out["progression_rate"]
        out["target_continuous_units"] = (
            f"{measure} points per year ({cfg.target.sign_convention})"
        )
    else:
        out["target_continuous"] = np.nan
        out["target_continuous_units"] = "unavailable"

    stage_measure = cfg.target.stage_measure
    stage_index_col = f"{stage_measure}_at_index"
    stage_outcome_col = f"{stage_measure}_at_outcome"
    cuts = list(cfg.target.stage_cutpoints)
    labels = list(cfg.target.stage_labels)

    def band(value: Any) -> Any:
        """Map a score to its predeclared ordinal band.

        ``cuts`` holds the lower edge of every band except the first, so the
        comparison is strict: with cuts ``[21, 27]`` a score of 21 falls in the
        second band (mild) and a score of 27 in the third (no impairment).
        """
        if pd.isna(value):
            return np.nan
        for i, cut in enumerate(cuts):
            if value < cut:
                return labels[i]
        return labels[-1]

    for source, target in ((stage_index_col, "stage_at_index"),
                           (stage_outcome_col, "stage_at_outcome")):
        if source in out.columns:
            out[target] = out[source].map(band)
        else:
            out[target] = np.nan
    out["target_stage"] = out.get("stage_at_outcome")
    return out


def _stage_bands(cfg: NeuroLensConfig) -> List[Dict[str, str]]:
    """Render the predeclared ordinal cutpoints as human-auditable ranges.

    Cutpoints are the lower edge of every band except the first, and the
    comparison is strict, so ``[21, 27]`` reads as ``< 21`` / ``21 to < 27`` /
    ``>= 27``.
    """
    cuts = list(cfg.target.stage_cutpoints)
    labels = list(cfg.target.stage_labels)
    bands: List[Dict[str, str]] = []
    for i, label in enumerate(labels):
        if i < len(cuts):
            upper = f" to < {_fmt(cuts[i])}" if i > 0 else ""
            prefix = "" if i == 0 else f"{_fmt(cuts[i - 1])}"
            lower = f"< {_fmt(cuts[i])}" if i == 0 else f"{prefix}{upper}"
        else:
            lower = f">= {_fmt(cuts[i - 1])}"
        bands.append({"label": str(label), "range": lower})
    return bands


def _fmt(value: float) -> str:
    """Render a cutpoint without a trailing ``.0`` when it is a whole number."""
    return str(int(value)) if float(value).is_integer() else str(value)


def build_cohort(tables: CohortTables, cfg: NeuroLensConfig) -> CohortResult:
    """Assemble the analysis table, targets, groups, features, and splits."""
    qc = tables.qc

    frame = _index_and_outcome(tables, cfg, qc)
    frame = _apply_targets(frame, cfg, qc)

    # ---- inclusion / exclusion ----------------------------------------- #
    before = len(frame)
    keep = pd.Series(True, index=frame.index)

    if "target_continuous" in frame.columns:
        missing_target = frame["target_continuous"].isna()
        for patient in frame.loc[missing_target, "patient_id"]:
            qc.add("patient", patient, "insufficient_followup_for_target",
                   detail=f"no {cfg.target.outcome_measure} at "
                          f"{cfg.target.outcome_session}", stage="cohort")
        keep &= ~missing_target

    if "followup_years" in frame.columns:
        short = frame["followup_years"] < cfg.target.min_followup_years
        for patient in frame.loc[short & keep, "patient_id"]:
            qc.add("patient", patient, "followup_below_minimum",
                   detail=f"< {cfg.target.min_followup_years} years", stage="cohort")
        keep &= ~short

    analysis = frame[keep].reset_index(drop=True)
    qc.add("cohort", "all", "cohort_finalised", severity="note",
           detail=f"{before} indexed -> {len(analysis)} analysed", stage="cohort")

    if analysis.empty:
        raise ValueError(
            "cohort is empty after applying the frozen target definition; "
            f"{qc.summary()}"
        )

    analysis = derive_groups(analysis, cfg)
    splits, split_info = make_splits(analysis, cfg, qc)
    analysis = analysis.merge(
        splits[["patient_id", "split_name", "split_hash"]], on="patient_id", how="left"
    )
    features = build_feature_builder(analysis, cfg)

    # ---- cohort audit --------------------------------------------------- #
    subgroup_sizes: Dict[str, Dict[str, int]] = {}
    for axis in cfg.fairness.axes:
        if axis in analysis.columns:
            counts = analysis[axis].astype("object").value_counts(dropna=False)
            subgroup_sizes[axis] = {
                ("<missing>" if (k is None or (isinstance(k, float) and pd.isna(k)) or k == "nan")
                 else str(k)): int(v)
                for k, v in counts.items()
            }

    missingness: Dict[str, float] = {}
    for column in features.names():
        series = analysis.get(column)
        if series is not None:
            missingness[column] = float(series.isna().mean())

    modality_columns = {
        family: sum(1 for f in features.column_families.values() if f == family)
        for family in ("mri", "genetics", "clinical", "demographic")
    }

    stage_counts = (
        analysis["target_stage"].astype("object").value_counts(dropna=False).to_dict()
        if "target_stage" in analysis.columns else {}
    )

    audit = {
        "n_indexed": int(before),
        "n_analysed": int(len(analysis)),
        "n_excluded": int(before - len(analysis)),
        "exclusion_reasons": qc.summary(),
        "modalities_available": tables.modalities_available(),
        "modality_feature_counts": modality_columns,
        "features": features.names(),
        "feature_missingness": missingness,
        "subgroup_sizes": subgroup_sizes,
        "stage_distribution": {str(k): int(v) for k, v in stage_counts.items()},
        "target_definition": {
            "outcome_measure": cfg.target.outcome_measure,
            "index_session": cfg.target.index_session,
            "outcome_session": cfg.target.outcome_session,
            "annualized": cfg.target.annualize,
            "sign_convention": cfg.target.sign_convention,
            "stage_cutpoints": cfg.target.stage_cutpoints,
            "stage_labels": cfg.target.stage_labels,
            "stage_bands": _stage_bands(cfg),
            "stage_definition": cfg.target.stage_definition,
            "version": cfg.target.target_definition_version,
            "units": str(analysis["target_continuous_units"].iloc[0])
            if "target_continuous_units" in analysis.columns and len(analysis) else "",
        },
        "target_distribution": {
            "n": int(analysis["target_continuous"].notna().sum()),
            "mean": float(analysis["target_continuous"].mean()) if len(analysis) else float("nan"),
            "sd": float(analysis["target_continuous"].std(ddof=1)) if len(analysis) > 1 else float("nan"),
            "min": float(analysis["target_continuous"].min()) if len(analysis) else float("nan"),
            "max": float(analysis["target_continuous"].max()) if len(analysis) else float("nan"),
        },
        "shift_cohort": {
            "definition": cfg.uncertainty.shift_cohort,
            "n": int(analysis["is_shift_cohort"].sum()) if "is_shift_cohort" in analysis else 0,
        },
        "split": split_info,
    }
    return CohortResult(
        analysis=analysis, splits=splits, split_info=split_info,
        qc=qc, features=features, tables=tables, audit=audit,
    )
