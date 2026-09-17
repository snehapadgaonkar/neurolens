"""Real-dataset manifests, loaders, and access metadata.

NeuroLens never generates data. Every cohort it analyses comes from a dataset
that is described here by a versioned :class:`DatasetManifest` recording
license, access requirements, citation, and the exact loader used.

Access tiers
------------
``open``
    Public, no account, no data-use agreement. Downloadable by anyone.
``registration``
    Public but requires a free account / click-through terms.
``dua``
    Requires a data-use agreement with a data custodian. NeuroLens can ingest
    the data but must never redistribute it (PRD guardrail: "Redistribute
    restricted patient-level data" is prohibited).

Why there is no open Huntington's cohort
----------------------------------------
The HD neuroimaging literature's usable cohorts — TRACK-HD, TRACKOn-HD,
PREDICT-HD, IMAGE-HD, HD-YAS, SHIELD-HD, PEARL-HD, LONGPDE10 — are harmonised
and distributed by the CHDI Foundation through Enroll-HD under a data-use
agreement. OpenNeuro (CC0, no registration) was searched exhaustively: of its
dataset repositories, none contains an HD patient cohort. NeuroLens therefore
ships the CHDI manifest as the *clinical* target and an open longitudinal
neuroimaging cohort as the default that runs with zero credentials.
"""

from __future__ import annotations

import glob
import json
import os
import re
import urllib.request
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from neurolens.schema import CohortTables, QCLedger, REGION_CATALOG

__all__ = [
    "DatasetManifest",
    "MANIFESTS",
    "resolve_manifest",
    "load_cohort",
    "fetch_openneuro_tabular",
    "parse_aseg_stats",
]


# --------------------------------------------------------------------------- #
# Manifests
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class DatasetManifest:
    key: str
    title: str
    version: str
    disease: str
    access: str
    license: str
    url: str
    citation: str
    loader: str
    modalities: List[str] = field(default_factory=list)
    download_command: str = ""
    redistributable: bool = True
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


MANIFESTS: Dict[str, DatasetManifest] = {
    # ------------------------------------------------------------------ #
    # DEFAULT — fully open, zero credentials, CC0.
    # ------------------------------------------------------------------ #
    "openneuro-ds004856": DatasetManifest(
        key="openneuro-ds004856",
        title="Dallas Lifespan Brain Study (DLBS) — OpenNeuro ds004856",
        version="ds004856 (OpenNeuro snapshot 1.0.1)",
        disease="Cognitive ageing / neurodegeneration (longitudinal, 3 waves)",
        access="open",
        license="CC0 1.0 Universal (Public Domain Dedication)",
        url="https://openneuro.org/datasets/ds004856",
        citation=(
            "Dallas Lifespan Brain Study. OpenNeuro. "
            "doi:10.18112/openneuro.ds004856 — see dataset_description.json for authors."
        ),
        loader="dlbs_tabular",
        modalities=["demographic", "clinical", "mri", "genetics"],
        download_command=(
            "# Tabular metadata (works behind restrictive networks, uses the GitHub mirror):\n"
            "neurolens fetch-data --dataset openneuro-ds004856\n\n"
            "# Full dataset incl. imaging and derivatives (needs S3/OpenNeuro access):\n"
            "aws s3 sync --no-sign-request s3://openneuro.org/ds004856 data/raw/ds004856"
        ),
        redistributable=True,
        notes=(
            "463 participants, 3 longitudinal waves ~4 and ~9 years apart. "
            "participants.tsv carries real age/sex/race/ethnicity/education and MMSE at each "
            "wave. Regional MRI volumes live in derivatives/brainsummary/Template_Structural_MRI.xlsx "
            "and genotypes in derivatives/Template19_Genotyping.xlsx; both are git-annexed to "
            "OpenNeuro's S3 bucket and are only read if present locally."
        ),
    ),
    # ------------------------------------------------------------------ #
    # CLINICAL TARGET — the PRD's Huntington's disease cohort.
    # ------------------------------------------------------------------ #
    "chdi-hd-bids": DatasetManifest(
        key="chdi-hd-bids",
        title="CHDI harmonised HD neuroimaging collections (TRACK-HD / TRACKOn-HD, PREDICT-HD, "
              "IMAGE-HD, HD-YAS, SHIELD-HD, PEARL-HD, LONGPDE10)",
        version="BIDS harmonised release (see Enroll-HD dataset register for the current version)",
        disease="Huntington's disease",
        access="dua",
        license="CHDI Foundation / Enroll-HD data-use agreement (not open)",
        url="https://www.enroll-hd.org/for-researchers/datasets/",
        citation=(
            "Bridging Huntington's disease research with big data science: harmonized "
            "neuroimaging datasets from multiple studies. Imaging Neuroscience (2024). "
            "doi:10.1162/imag_a_00395"
        ),
        loader="bids_freesurfer",
        modalities=["demographic", "clinical", "mri", "genetics"],
        download_command=(
            "# 1. Apply for access at https://www.enroll-hd.org/for-researchers/datasets/\n"
            "# 2. After approval, download the harmonised BIDS collection with DataLad:\n"
            "datalad install ///datasets/<TRACK_bids_master-v2.0>\n"
            "# 3. Point NeuroLens at it:\n"
            "neurolens run --dataset chdi-hd-bids --data-dir /path/to/downloaded/collection"
        ),
        redistributable=False,
        notes=(
            "2,216 participants / 7,073 sessions across eight studies, with FreeSurfer and "
            "fMRIPrep derivatives. NeuroLens stores only this manifest — never the data — and "
            "records the access requirement in every audit report and model card."
        ),
    ),
    # ------------------------------------------------------------------ #
    # Longitudinal imaging + demographics with regional volumes.
    # ------------------------------------------------------------------ #
    "oasis3": DatasetManifest(
        key="oasis3",
        title="OASIS-3: Longitudinal Neuroimaging, Clinical, and Cognitive Dataset",
        version="OASIS-3 (see oasis-brains.org for the released snapshot)",
        disease="Normal ageing / mild cognitive impairment / Alzheimer's disease",
        access="registration",
        license="CC BY 4.0 after free account registration and terms acceptance",
        url="https://www.oasis-brains.org/",
        citation="LaMontagne PJ, et al. OASIS-3. bioRxiv 2019. doi:10.1101/732586",
        loader="oasis3_tabular",
        modalities=["demographic", "clinical", "mri"],
        download_command=(
            "# Create a free account at https://www.oasis-brains.org, accept the terms,\n"
            "# then download OASIS3_* .csv and the FreeSurfer ROI tables into data/raw/oasis3/.\n"
            "neurolens run --dataset oasis3 --data-dir data/raw/oasis3"
        ),
        redistributable=False,
        notes=(
            "1,000+ participants with FreeSurfer regional volumes, education, race/ethnicity, "
            "and longitudinal CDR. Requires a free account, so it is not the zero-credential default."
        ),
    ),
    # ------------------------------------------------------------------ #
    # Generic: any BIDS collection with FreeSurfer `stats/aseg.stats` output.
    # ------------------------------------------------------------------ #
    "bids-freesurfer": DatasetManifest(
        key="bids-freesurfer",
        title="Generic BIDS collection with FreeSurfer aseg derivatives",
        version="user-supplied",
        disease="user-supplied",
        access="open",
        license="user-supplied",
        url="",
        citation="user-supplied",
        loader="bids_freesurfer",
        modalities=["demographic", "mri"],
        notes="Loader for any local BIDS tree containing */stats/aseg.stats plus participants.tsv.",
    ),
}


def resolve_manifest(key: str) -> DatasetManifest:
    if key not in MANIFESTS:
        raise KeyError(
            f"Unknown dataset '{key}'. Available: {', '.join(sorted(MANIFESTS))}"
        )
    return MANIFESTS[key]


# --------------------------------------------------------------------------- #
# Download helper
# --------------------------------------------------------------------------- #
def _http_get(url: str, timeout: int = 60) -> Optional[bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": "neurolens/0.1"})
    token = os.environ.get("GITHUB_TOKEN")
    if token and "api.github.com" in url:
        request.add_header("Authorization", f"token {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except Exception:
        return None


def fetch_openneuro_tabular(
    dataset_id: str,
    dest_dir: str,
    files: Iterable[str] = ("participants.tsv", "participants.json",
                            "dataset_description.json", "README"),
) -> Dict[str, str]:
    """Download a dataset's committed tabular metadata.

    Tries OpenNeuro's HTTPS endpoint first and falls back to the public GitHub
    mirror (``OpenNeuroDatasets/<id>``), which is useful inside networks that
    block S3. Returns a mapping of filename -> path actually written.
    """
    import base64

    os.makedirs(dest_dir, exist_ok=True)
    written: Dict[str, str] = {}
    for name in files:
        target = os.path.join(dest_dir, name)
        payload = _http_get(f"https://openneuro.org/datasets/{dataset_id}/files/{name}")
        if payload is None:
            api = (
                f"https://api.github.com/repos/OpenNeuroDatasets/{dataset_id}"
                f"/contents/{name}"
            )
            payload = _http_get(api)
            if payload is None:
                continue
            try:
                payload = base64.b64decode(json.loads(payload)["content"])
            except Exception:
                continue
        with open(target, "wb") as handle:
            handle.write(payload)
        written[name] = target
    return written


# --------------------------------------------------------------------------- #
# FreeSurfer aseg.stats parsing
# --------------------------------------------------------------------------- #
ASEG_COLUMN_ALIASES = {
    "index": "index",
    "segid": "seg_id",
    "structname": "struct_name",
    "nvoxels": "n_voxels",
    "volume_mm3": "volume_mm3",
    "volume_mm^3": "volume_mm3",
    "normmean": "norm_mean",
    "normstddev": "norm_stddev",
    "normmin": "norm_min",
    "normmax": "norm_max",
    "normrange": "norm_range",
}


def parse_aseg_stats(path: str) -> Dict[str, Any]:
    """Parse one FreeSurfer ``aseg.stats`` file into regional volumes.

    Returns ``{"icv": float|None, "regions": {struct_name: volume_mm3},
    "subject": str|None, "source": path}``. Only structures listed in
    :data:`neurolens.schema.REGION_CATALOG` are retained, plus the estimated
    total intracranial volume from the ``# Measure`` header block.
    """
    icv: Optional[float] = None
    subject: Optional[str] = None
    header_cols: List[str] = []
    rows: List[Dict[str, Any]] = []

    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            if line.startswith("#"):
                text = line.lstrip("#").strip()
                if text.lower().startswith("measure"):
                    parts = [p.strip() for p in text.split(",")]
                    # Layout: Measure <name>, <valname>, <description>, <value>, <units>
                    # The description may itself contain commas, so the value is
                    # located by scanning from the right for the last parseable
                    # float rather than by a fixed index.
                    if len(parts) >= 4 and any(
                        "intracranial" in token.lower() or token.lower() == "etiv"
                        for token in parts[:3]
                    ):
                        for candidate in reversed(parts[2:]):
                            try:
                                icv = float(candidate)
                                break
                            except ValueError:
                                continue
                elif text.lower().startswith("subjectname"):
                    subject = text.split(None, 1)[1].strip() if " " in text else None
                elif text.lower().startswith(("colheaders", "index")):
                    tokens = text.split()
                    # `# ColHeaders Index SegId ...` — the leading keyword is a
                    # marker, not a column, so it must not shift the mapping.
                    if tokens and tokens[0].lower() == "colheaders":
                        tokens = tokens[1:]
                    header_cols = [
                        ASEG_COLUMN_ALIASES.get(tok.lower(), tok.lower()) for tok in tokens
                    ]
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            # Positional layout: Index SegId NVoxels Volume StructName ...
            try:
                volume = float(parts[3])
            except ValueError:
                continue
            record: Dict[str, Any] = {
                "index": parts[0],
                "seg_id": parts[1],
                "n_voxels": parts[2],
                "volume_mm3": volume,
                "struct_name": parts[4],
            }
            if header_cols and len(header_cols) == len(parts):
                named = dict(zip(header_cols, parts))
                if "struct_name" in named:
                    record["struct_name"] = named["struct_name"]
                if "volume_mm3" in named:
                    try:
                        record["volume_mm3"] = float(named["volume_mm3"])
                    except ValueError:
                        pass
            rows.append(record)

    regions = {
        row["struct_name"]: float(row["volume_mm3"])
        for row in rows
        if row.get("struct_name") in REGION_CATALOG
    }
    return {"icv": icv, "regions": regions, "subject": subject, "source": path}


def _iter_aseg_files(root: str) -> List[str]:
    patterns = [
        os.path.join(root, "**", "stats", "aseg.stats"),
        os.path.join(root, "**", "aseg.stats"),
    ]
    found: List[str] = []
    for pattern in patterns:
        found.extend(glob.glob(pattern, recursive=True))
    return sorted(set(found))


def _subject_from_path(path: str, root: str) -> str:
    """Recover the BIDS subject label from a file path.

    BIDS subject labels may contain underscores (``sub-CMU_0050646``), so this
    walks the path segments rather than matching a character class — a regex
    such as ``sub-[A-Za-z0-9]+`` would silently truncate the label to
    ``sub-CMU`` and unlink the imaging from the participant record.
    """
    relative = os.path.relpath(path, root)
    for part in relative.split(os.sep):
        if part.startswith("sub-"):
            # `sub-01_ses-1` names a subject and session in one segment; the
            # subject label ends at the first `_ses-`.
            return re.split(r"_ses-", part, maxsplit=1)[0]
    parts = [p for p in relative.split(os.sep) if p not in ("stats", "aseg.stats")]
    return parts[0] if parts else os.path.basename(path)


def _session_from_path(path: str) -> Optional[str]:
    match = re.search(r"(ses-[A-Za-z0-9]+)", path)
    return match.group(1) if match else None


# --------------------------------------------------------------------------- #
# Loaders
# --------------------------------------------------------------------------- #
def _read_table(path: str, **kwargs: Any) -> pd.DataFrame:
    if path.endswith((".xlsx", ".xls")):
        return pd.read_excel(path, **kwargs)
    sep = "\t" if path.endswith((".tsv", ".stats")) else ","
    return pd.read_csv(path, sep=sep, **kwargs)


def _clean(df: pd.DataFrame, na_values: Iterable[str]) -> pd.DataFrame:
    """Normalise a dataset's missing-value sentinels to real NaNs."""
    tokens = {str(v).strip() for v in na_values}
    return df.replace(list(tokens), np.nan)


def _load_bids_freesurfer(data_dir: str, manifest: DatasetManifest,
                          qc: QCLedger) -> CohortTables:
    """Any BIDS tree with FreeSurfer ``stats/aseg.stats`` and a participants.tsv."""
    aseg_files = _iter_aseg_files(data_dir)
    participants_path = ""
    for candidate in ("participants.tsv", "participants.csv"):
        if os.path.exists(os.path.join(data_dir, candidate)):
            participants_path = os.path.join(data_dir, candidate)
            break

    if not aseg_files:
        qc.add("dataset", data_dir, "no_freesurfer_aseg_found",
               detail="expected */stats/aseg.stats under the data directory")

    mri_rows: List[Dict[str, Any]] = []
    subjects_seen: List[str] = []
    for path in aseg_files:
        parsed = parse_aseg_stats(path)
        # Prefer the BIDS identifier recovered from the path: FreeSurfer's
        # internal `# subjectname` frequently differs from the BIDS subject
        # label (e.g. `Pitt_50014` vs `sub-Pitt_50014`), which would silently
        # unlink the imaging from the participant record.
        subject = _subject_from_path(path, data_dir) or parsed["subject"]
        session = _session_from_path(path) or "ses-01"
        subjects_seen.append(subject)
        if not parsed["regions"]:
            qc.add("mri", f"{subject}/{session}", "aseg_parse_empty",
                   detail=f"no catalogue structures found in {path}")
            continue
        icv = parsed["icv"]
        for struct, volume in parsed["regions"].items():
            catalogue = REGION_CATALOG[struct]
            normalised = (volume / icv * 1000.0) if icv else np.nan
            mri_rows.append(dict(
                patient_id=subject, session_id=f"{subject}_{session}",
                session=session, region=catalogue["key"], struct_name=struct,
                anatomical_label=catalogue["label"], system=catalogue["system"],
                raw_volume=float(volume), normalized_volume=normalised,
                units="mm^3", icv_mm3=icv, feature_version="freesurfer-aseg-v1",
                freesurfer_subject=parsed["subject"],
                source_file=os.path.relpath(path, data_dir),
            ))

    mri_features = pd.DataFrame(mri_rows)

    if participants_path:
        patients = _read_table(participants_path)
        id_col = "participant_id" if "participant_id" in patients.columns else patients.columns[0]
        patients = patients.rename(columns={id_col: "patient_id"})
        patients["patient_id"] = patients["patient_id"].astype(str)
        # Keep only subjects we actually have imaging for.
        have = set(subjects_seen)
        missing = sorted(set(patients["patient_id"]) - have)
        for subject in missing:
            qc.add("patient", subject, "no_freesurfer_output", severity="note")
        patients = patients[patients["patient_id"].isin(have)].reset_index(drop=True)
    else:
        qc.add("dataset", data_dir, "no_participants_table", severity="note")
        patients = pd.DataFrame({"patient_id": sorted(set(subjects_seen))})

    sessions = (
        mri_features[["patient_id", "session_id", "session"]]
        .drop_duplicates()
        .reset_index(drop=True)
        if not mri_features.empty else pd.DataFrame(columns=["patient_id", "session_id", "session"])
    )
    tables = CohortTables(
        dataset_key=manifest.key, dataset_version=manifest.version,
        patients=patients, sessions=sessions, mri_features=mri_features,
        source_manifest=manifest.to_dict(), qc=qc,
        observed_columns={
            "participants": list(patients.columns),
            "mri_features": list(mri_features.columns) if not mri_features.empty else [],
        },
    )
    return tables


def _as_code(series: pd.Series) -> pd.Series:
    """Keep a coded categorical column textual.

    Pandas infers float for a column of numeric-looking codes, which would turn a
    fairness axis into ``0.0``/``1.0`` and stop it matching the published data
    dictionary (whose levels are the strings ``"0"`` and ``"1"``).
    """
    values: List[Any] = []
    for value in series.astype("object").where(series.notna(), None):
        if value is None:
            values.append(None)
            continue
        text = str(value).strip()
        values.append(text[:-2] if text.endswith(".0") else text)
    return pd.Series(values, index=series.index, dtype="object")


def _load_dlbs(data_dir: str, manifest: DatasetManifest, qc: QCLedger) -> CohortTables:
    """OpenNeuro ds004856 — Dallas Lifespan Brain Study."""
    participants_path = os.path.join(data_dir, "participants.tsv")
    if not os.path.exists(participants_path):
        fetched = fetch_openneuro_tabular("ds004856", data_dir)
        participants_path = fetched.get("participants.tsv", "")
    if not participants_path or not os.path.exists(participants_path):
        raise FileNotFoundError(
            f"participants.tsv not found in {data_dir}. Run "
            "`neurolens fetch-data --dataset openneuro-ds004856` first."
        )

    dictionary: Dict[str, Any] = {}
    json_path = os.path.join(data_dir, "participants.json")
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as handle:
            dictionary = json.load(handle)

    raw = _read_table(participants_path)
    for column in ("Sex", "Race", "Ethnicity"):
        if column in raw.columns:
            raw[column] = _as_code(raw[column])
    na_tokens = ["n/a", "NA", "xx", "NaN", "nan", "", "."]
    raw = _clean(raw, na_tokens)
    for column in raw.columns:
        if column not in ("participant_id", "Sex", "Race", "Ethnicity"):
            raw[column] = pd.to_numeric(raw[column], errors="coerce")

    patients = pd.DataFrame({
        "patient_id": raw["participant_id"].astype(str),
        "cohort_id": "ds004856",
        "sex": raw.get("Sex"),
        "race": raw.get("Race"),
        "ethnicity": raw.get("Ethnicity"),
        "education_years": raw.get("EduYrsEstCap"),
        "handedness_score": raw.get("HandednessScore"),
        "bmi_w1": raw.get("BMI_W1"),
    })
    duplicates = patients["patient_id"].duplicated()
    if duplicates.any():
        for patient in patients.loc[duplicates, "patient_id"]:
            qc.add("patient", patient, "duplicate_patient_record")
        patients = patients.drop_duplicates("patient_id", keep="first").reset_index(drop=True)

    # Long-form sessions from the three waves. Time is expressed in years since
    # the wave-1 cognitive assessment, derived from the dataset's own age fields.
    waves = [1, 2, 3]
    session_rows: List[Dict[str, Any]] = []
    clinical_rows: List[Dict[str, Any]] = []
    for _, row in raw.iterrows():
        patient = str(row["participant_id"])
        base_age = row.get("AgeCog_W1")
        if pd.isna(base_age):
            base_age = row.get("AgeMRI_W1")
        if pd.isna(base_age):
            qc.add("patient", patient, "no_baseline_age")
            continue
        for wave in waves:
            age_cog = row.get(f"AgeCog_W{wave}")
            age_mri = row.get(f"AgeMRI_W{wave}")
            mmse = row.get(f"MMSE_W{wave}")
            has_any = not (pd.isna(age_cog) and pd.isna(age_mri) and pd.isna(mmse))
            if not has_any:
                qc.add("session", f"{patient}/W{wave}", "no_wave_data", severity="note",
                       stage="cohort")
                continue
            reference = age_cog if not pd.isna(age_cog) else age_mri
            session_rows.append(dict(
                patient_id=patient,
                session_id=f"{patient}_W{wave}",
                session=f"W{wave}",
                wave=wave,
                age_years=float(reference),
                time_years=float(reference) - float(base_age),
                has_cognitive=bool(not pd.isna(mmse)),
                has_mri=bool(not pd.isna(age_mri)),
                modality="T1w" if not pd.isna(age_mri) else "",
                qc_status="PASS",
            ))
            if not pd.isna(mmse):
                clinical_rows.append(dict(
                    patient_id=patient, session_id=f"{patient}_W{wave}",
                    session=f"W{wave}", wave=wave,
                    assessment_time_years=float(reference) - float(base_age),
                    mmse=float(mmse),
                ))

    sessions = pd.DataFrame(session_rows)
    clinical = pd.DataFrame(clinical_rows)

    # Imaging and genetics are shipped as git-annexed derivatives. Read them if
    # the user has fetched them; otherwise record the modality as unavailable.
    mri_features = _load_dlbs_structural(data_dir, qc)
    genetics = _load_dlbs_genotyping(data_dir, qc)

    return CohortTables(
        dataset_key=manifest.key, dataset_version=manifest.version,
        patients=patients, sessions=sessions, mri_features=mri_features,
        genetics=genetics, clinical=clinical, variable_dictionary=dictionary,
        source_manifest=manifest.to_dict(), qc=qc,
        observed_columns={
            "participants": list(raw.columns),
            "patients": list(patients.columns),
            "sessions": list(sessions.columns) if not sessions.empty else [],
            "clinical": list(clinical.columns) if not clinical.empty else [],
            "mri_features": list(mri_features.columns) if not mri_features.empty else [],
        },
    )


def _find_derivative(data_dir: str, *fragments: str) -> str:
    for root, _dirs, files in os.walk(data_dir):
        for name in files:
            low = name.lower()
            if all(fragment.lower() in low for fragment in fragments):
                return os.path.join(root, name)
    return ""


def _load_dlbs_structural(data_dir: str, qc: QCLedger) -> pd.DataFrame:
    """Regional volumes from the DLBS structural-MRI derivative, if present."""
    path = _find_derivative(data_dir, "Structural_MRI")
    if not path:
        qc.add("modality", "mri", "mri_derivative_not_downloaded", severity="warning",
               detail="derivatives/brainsummary/Template_Structural_MRI.xlsx is git-annexed to "
                      "OpenNeuro S3; fetch it with `aws s3 sync --no-sign-request "
                      "s3://openneuro.org/ds004856 data/raw/ds004856`",
               stage="ingest")
        return pd.DataFrame()
    try:
        table = _read_table(path)
    except Exception as exc:  # pragma: no cover - depends on the derivative's shape
        qc.add("modality", "mri", "mri_derivative_unreadable", severity="error",
               detail=f"{path}: {exc}", stage="ingest")
        return pd.DataFrame()

    id_col = next((c for c in table.columns if "id" in c.lower() or "subject" in c.lower()),
                  table.columns[0])
    rows: List[Dict[str, Any]] = []
    for _, record in table.iterrows():
        patient = str(record[id_col])
        for column in table.columns:
            if column == id_col:
                continue
            struct = column.replace(" ", "-")
            catalogue = REGION_CATALOG.get(struct)
            if catalogue is None:
                continue
            value = pd.to_numeric(pd.Series([record[column]]), errors="coerce").iloc[0]
            if pd.isna(value):
                continue
            rows.append(dict(
                patient_id=patient, session_id=f"{patient}_W1", session="W1",
                region=catalogue["key"], struct_name=struct,
                anatomical_label=catalogue["label"], system=catalogue["system"],
                raw_volume=float(value), normalized_volume=np.nan, units="mm^3",
                icv_mm3=np.nan, feature_version="dlbs-structural-v1",
                source_file=os.path.relpath(path, data_dir),
            ))
    if not rows:
        qc.add("modality", "mri", "mri_derivative_has_no_catalogue_regions", severity="warning",
               detail=f"{path}: no columns matched the FreeSurfer region catalogue",
               stage="ingest")
    return pd.DataFrame(rows)


def _load_dlbs_genotyping(data_dir: str, qc: QCLedger) -> pd.DataFrame:
    path = _find_derivative(data_dir, "Genotyping")
    if not path:
        qc.add("modality", "genetics", "genetic_derivative_not_downloaded", severity="warning",
               detail="derivatives/Template19_Genotyping.xlsx is git-annexed to OpenNeuro S3",
               stage="ingest")
        return pd.DataFrame()
    try:
        table = _read_table(path)
    except Exception as exc:  # pragma: no cover
        qc.add("modality", "genetics", "genetic_derivative_unreadable", severity="error",
               detail=f"{path}: {exc}", stage="ingest")
        return pd.DataFrame()
    table.columns = [str(c).lower() for c in table.columns]
    id_col = next((c for c in table.columns if "id" in c), table.columns[0])
    genetics = table.rename(columns={id_col: "patient_id"}).copy()
    genetics["patient_id"] = genetics["patient_id"].astype(str)
    return genetics


def _load_oasis3(data_dir: str, manifest: DatasetManifest, qc: QCLedger) -> CohortTables:
    """OASIS-3 tabular release: subjects + longitudinal assessments + FreeSurfer ROIs."""
    def find(*needles: str) -> str:
        for name in sorted(os.listdir(data_dir)):
            low = name.lower()
            if low.endswith((".csv", ".tsv")) and all(n in low for n in needles):
                return os.path.join(data_dir, name)
        return ""

    subject_path = find("subj")
    if not subject_path:
        raise FileNotFoundError(
            f"No OASIS3 subject table (OASIS3_*subj*.csv) found in {data_dir}. "
            "Download the release from https://www.oasis-brains.org/ after registering."
        )
    patients = _read_table(subject_path)
    id_col = next((c for c in patients.columns if "subject" in c.lower()), patients.columns[0])
    patients = patients.rename(columns={id_col: "patient_id"})
    patients["patient_id"] = patients["patient_id"].astype(str)

    long_path = find("long")
    clinical = _read_table(long_path) if long_path else pd.DataFrame()
    if not clinical.empty:
        cid = next((c for c in clinical.columns if "subject" in c.lower()), None)
        if cid:
            clinical = clinical.rename(columns={cid: "patient_id"})
            clinical["patient_id"] = clinical["patient_id"].astype(str)

    freesurfer_path = find("freesurfer")
    mri_features = pd.DataFrame()
    if freesurfer_path:
        rois = _read_table(freesurfer_path)
        sid = next((c for c in rois.columns if "subject" in c.lower()), rois.columns[0])
        rows: List[Dict[str, Any]] = []
        for _, record in rois.iterrows():
            for column in rois.columns:
                struct = str(column).replace(" ", "-")
                catalogue = REGION_CATALOG.get(struct)
                if catalogue is None:
                    continue
                value = pd.to_numeric(pd.Series([record[column]]), errors="coerce").iloc[0]
                if pd.isna(value):
                    continue
                session = str(record.get("Session", record.get("session", "ses-01")))
                rows.append(dict(
                    patient_id=str(record[sid]),
                    session_id=f"{record[sid]}_{session}", session=session,
                    region=catalogue["key"], struct_name=struct,
                    anatomical_label=catalogue["label"], system=catalogue["system"],
                    raw_volume=float(value), normalized_volume=np.nan, units="mm^3",
                    icv_mm3=np.nan, feature_version="oasis3-freesurfer-v1",
                    source_file=os.path.relpath(freesurfer_path, data_dir),
                ))
        mri_features = pd.DataFrame(rows)
    else:
        qc.add("modality", "mri", "no_freesurfer_roi_table", severity="warning",
               detail="expected OASIS3_*freesurfer*.csv in the data directory", stage="ingest")

    sessions = pd.DataFrame({
        "patient_id": patients["patient_id"],
        "session_id": patients["patient_id"] + "_ses-01",
        "session": "ses-01",
    })
    return CohortTables(
        dataset_key=manifest.key, dataset_version=manifest.version,
        patients=patients, sessions=sessions, mri_features=mri_features,
        clinical=clinical, source_manifest=manifest.to_dict(), qc=qc,
        observed_columns={
            "participants": list(patients.columns),
            "clinical": list(clinical.columns) if not clinical.empty else [],
            "mri_features": list(mri_features.columns) if not mri_features.empty else [],
        },
    )


_LOADERS = {
    "bids_freesurfer": _load_bids_freesurfer,
    "dlbs_tabular": _load_dlbs,
    "oasis3_tabular": _load_oasis3,
}


def load_cohort(dataset_key: str, data_dir: str) -> CohortTables:
    """Load a real cohort described by a registered manifest."""
    manifest = resolve_manifest(dataset_key)
    qc = QCLedger()
    loader = _LOADERS[manifest.loader]
    if manifest.loader != "dlbs_tabular" and not os.path.isdir(data_dir):
        raise FileNotFoundError(
            f"Data directory '{data_dir}' does not exist for dataset '{dataset_key}'. "
            f"Access: {manifest.access}. {manifest.download_command}"
        )
    os.makedirs(data_dir, exist_ok=True)
    tables = loader(data_dir, manifest, qc)
    problems = tables.validate()
    for problem in problems:
        qc.add("dataset", dataset_key, "structural_validation", severity="error",
               detail=problem, stage="ingest")
    return tables
