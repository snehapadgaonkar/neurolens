# NeuroLens data policy and provenance

NeuroLens runs **only on real, globally accessible open data**. There is no
synthetic cohort generator anywhere in this repository — not in the library, not
in the tests, not in the demos, and not as a fallback. If a dataset cannot be
reached, the pipeline records that fact in the QC ledger and stops; it never
manufactures rows to keep going.

That rule has one consequence worth stating plainly: **the default open cohort
is not a Huntington's disease cohort.** The reasoning is documented below, along
with the exact barrier that separates the open pathway from the HD pathway.

---

## 1. The default cohort: Dallas Lifespan Brain Study (open, CC0)

| Property | Value |
|---|---|
| Key | `openneuro-ds004856` |
| Dataset | Dallas Lifespan Brain Study (DLBS), OpenNeuro `ds004856` |
| Access | **Open** — no account, no registration, no data use agreement |
| Licence | CC0 1.0 (public domain) |
| Fetch | `neurolens fetch-data --dataset openneuro-ds004856` |
| Participants indexed | 464 |
| Analysable for the default target | 331 |

### What is fetched

`fetch-data` pulls the small tabular metadata that OpenNeuro commits to git and
mirrors on the GitHub API — `participants.tsv`, its data dictionary
`participants.json`, `dataset_description.json`, and `README` — into
`data/raw/ds004856/`. Those files are what the default run analyses:

* three waves of MMSE (`MMSE_W1..W3`), giving a real longitudinal outcome;
* age at each wave (`AgeCog_W*`, `AgeMRI_W*`), used to annualise the target;
* sex, race, ethnicity, education years, handedness, height/weight/BMI.

### What is *not* available, and how that is handled

The DLBS structural-MRI volumes, amyloid/tau PET SUVRs, and APOE genotypes are
shipped as git-annexed derivatives living in OpenNeuro's S3 bucket
(`s3://openneuro.org/ds004856`). They are only retrievable with the AWS CLI:

```bash
aws s3 sync --no-sign-request s3://openneuro.org/ds004856 data/raw/ds004856
```

When those derivatives are absent the loader records
`mri_derivative_not_downloaded` and `genetic_derivative_not_downloaded` in the
QC ledger, sets `modalities_available.mri = false`, and the audit report states
the limitation in prose. The MRI-only comparison is listed under
`skipped_comparisons` rather than being silently dropped.

Fetch those derivatives and the identical pipeline immediately runs the
MRI-only versus multimodal comparison — no code change is required.

### One data-quality defect found in the source

The DLBS data dictionary declares `Ethnicity` levels as `1 = Hispanic/Latin(o/a)`
and `2 = Non-Hispanic`, but the `participants.tsv` column contains `0` and `1`.
The published code list does not match the data. NeuroLens does **not** guess a
mapping: the raw codes are retained and the mismatch is logged as
`coded_levels_do_not_match_data`. Guessing would have silently relabelled a
fairness axis.

---

## 2. Why the default cohort is not an HD cohort

NeuroLens is built for Huntington's disease progression. The HD neuroimaging
data that exists is real, harmonised, and BIDS-formatted — it is simply not open.

The harmonised HD collections (TRACK-HD, TRACKOn-HD, PREDICT-HD, IMAGE-HD,
HD-YAS, SHIELD-HD, PEARL-HD, LONGPDE10) combine into six BIDS datasets totalling
**2,216 participants and 7,073 sessions**, with level-2 processed variants
including FreeSurfer and fMRIPrep outputs. Access is granted by the CHDI
Foundation under a data use agreement obtained through Enroll-HD:
<https://www.enroll-hd.org/for-researchers/datasets/>

Three independent checks were used to confirm that no zero-barrier open HD
imaging cohort exists:

1. a sweep of the OpenNeuro metadata index (`VisLab/openneuro-metadata`,
   2,900+ datasets) for HD, Huntington, CAG, and `HTT` terms — no HD imaging
   cohort;
2. a sweep of OpenNeuro's git-annex mirror repositories
   (`github.com/OpenNeuroDatasets/*`) — no HD cohort;
3. the authoritative literature on HD neuroimaging data availability, which
   names CHDI/Enroll-HD as the access route for every curated HD collection.

So the project ships two pathways that share all downstream code:

| Pathway | Manifest key | Access | Redistributable |
|---|---|---|---|
| Open default | `openneuro-ds004856` | open (CC0) | yes |
| HD research | `chdi-hd-bids` | data use agreement | **no** |

`configs/hd-chdi-bids.yaml` is the HD configuration. It expects UHDRS Total
Motor Score as the continuous target and Total Functional Capacity as the
ordinal stage, uses CAG repeat length as the primary fairness axis, and declares
the premanifest-to-late stage cutpoints up front. It downloads nothing: you must
already hold an approved DUA and point `--data-dir` at your local copy.
NeuroLens never caches, mirrors, or redistributes that data.

---

## 3. Test fixtures: real FreeSurfer output

`tests/data/bids_freesurfer_fixture/` contains **real** FreeSurfer 6.0.0
`aseg.stats` output for seven ABIDE subjects, plus their real demographics,
taken from `ReproNim/how-would-repronim-4` (CC-BY 4.0,
[doi:10.18116/kgt2-xc27](https://doi.org/10.18116/kgt2-xc27)). No values were
altered, imputed, or invented; `participants.tsv` is a mechanical BIDS renaming
of the source rows. See `SOURCES.md` in that directory.

These files exist because the open DLBS run has no imaging derivative, and the
MRI ingestion path still has to be tested against genuine `aseg.stats` — real
volumes, real estimated total intracranial volume, real structure names — rather
than a stand-in. They are not part of any analysis cohort and are never mixed
into a NeuroLens result.

The tests that need the DLBS participants table use the real file, downloading it
once per session if it is absent, and skip cleanly with an explanatory message if
it cannot be reached.

---

## 4. What is never done

* **No synthetic or simulated cohort**, in any form, including "obviously fake"
  demo data and test doubles.
* **No manufactured demographics.** Sex, race, ethnicity, and education come
  from the source dataset or are recorded as missing.
* **No redistribution of restricted patient-level data.**
* **No fairness claim about a subgroup that is too small to support one.** Cells
  below the predeclared reportable minimum are marked `INSUFFICIENT DATA` and
  carry no estimate.
* **No silent sample dropping.** Every excluded patient appears in
  `qc_ledger.csv` with a reason.

---

## 5. Registering another dataset

Add a `DatasetManifest` to `MANIFESTS` in `src/neurolens/datasets.py`:

```python
DatasetManifest(
    key="my-open-dataset",
    title="...",
    version="...",
    access="open",              # "open" | "registration" | "dua"
    redistributable=True,
    license="CC0 1.0",
    url="https://...",
    citation="...",
    loader=_load_my_dataset,     # returns a CohortTables
)
```

`access` drives the access-banner text in the UI and the licence line in the
model card; `redistributable` must be `False` for any DUA dataset. Everything
downstream — cohort building, splits, targets, features, models, fairness audit,
uncertainty, explanations, reporting — is dataset-agnostic.
