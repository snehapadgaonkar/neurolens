# NeuroLens

**A fair, uncertainty-aware, and explainable framework for longitudinal
neurodegenerative disease progression modelling — built as an evidence
workspace, not a predictor.**

> **Research prototype.** NeuroLens is not clinically validated. It must not be
> used for diagnosis, staging, prognosis, or treatment decisions. Its feature
> attributions describe *model association*, not biological causation.

NeuroLens answers five questions about a progression model, in this order, and
refuses to let a headline number stand on its own:

| Question | Where it is answered |
|---|---|
| **What was predicted?** | Continuous future progression and disease stage, with the target definition frozen before training |
| **How certain?** | Split conformal intervals, calibration, OOD scores, and the cases that were confidently wrong |
| **Why?** | Global importances and patient-level KernelSHAP, labelled *association, not causation* |
| **Where does it fail?** | Per-subgroup error with n, CI, gap, and a PASS / WARN / **INSUFFICIENT DATA** verdict |
| **Can it be reproduced?** | Seed, config hash, split hash, target-definition version, package versions, artifact list |

---

## Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[api,dev]"
```

Requires Python ≥ 3.9. No build step, no GPU, no Node toolchain.

## Quickstart

```bash
neurolens fetch-data --dataset openneuro-ds004856   # real CC0 data from OpenNeuro
neurolens run --config configs/openneuro-ds004856.yaml
neurolens serve --runs-root runs                    # evidence workspace UI
```

`run` writes a self-contained audit package to `runs/<run_id>/`:

```
audit_report.json   machine-readable audit package
audit_report.md     human-readable audit report
audit_report.html   self-contained HTML report
model_card.md       model card with scope, limits, and failure modes
predictions.csv     per-case predictions, intervals, OOD scores
fairness_audit.csv  every subgroup row with adequacy and status
explanations.csv    patient-level attributions
qc_ledger.csv       every excluded sample and the reason
manifest.json       reproducibility manifest
config.yaml         the exact configuration
figures/            eight evidence figures
```

Verify the installation end to end:

```bash
pytest                    # 110 tests, all on real data
python scripts/smoke_test.py
```

---

## Data policy: real data only

**NeuroLens never generates data.** There is no synthetic cohort generator
anywhere in this repository — not in the library, not in the tests, not in the
demos, not as a fallback. If a dataset cannot be reached, the pipeline records
that in the QC ledger and stops.

The default cohort is the **Dallas Lifespan Brain Study** (OpenNeuro `ds004856`,
CC0 public domain, no registration): 464 real participants with three waves of
MMSE.

The Huntington's disease pathway needs the harmonised HD BIDS collections, which
the CHDI Foundation distributes under a data use agreement via
[Enroll-HD](https://www.enroll-hd.org/for-researchers/datasets/). That data is
not open and is not redistributable, so NeuroLens never downloads, caches, or
mirrors it — `configs/hd-chdi-bids.yaml` expects a local copy you already have
the right to hold. Both pathways share every line of code downstream of
ingestion.

**[`DATA.md`](DATA.md)** documents the provenance of every dataset used here,
what is and is not available in the open, and how to register another one.

---

## What makes the output an audit rather than a score

**No composite fairness score, ever.** Every subgroup row carries its own `n`,
an estimate with a confidence interval, the gap to a predeclared reference
group with its *own* CI, an adequacy status, and a verdict. A subgroup below the
reportable minimum is marked `INSUFFICIENT DATA` and carries **no estimate** —
because absence of a disparity signal in an underpowered cell is not evidence of
fairness. Only *adverse* gaps are flagged.

**Stated uncertainty is tested, not assumed.** The report checks whether
uncertainty actually tracks realised error. When it does not, the report says
abstention based on interval width is not supported. Out-of-distribution cases
are required to be worse; "confident but wrong" is counted and reported as a
first-class failure mode.

**Nothing is dropped silently.** Every excluded patient appears in
`qc_ledger.csv` with a reason. Where a dataset's published code list does not
match its data — as with DLBS `Ethnicity` — the raw codes are kept and the
mismatch is logged rather than guessed away.

**Degenerate tasks are named.** If one class dominates the stage task, the
report states the majority-class accuracy next to the headline accuracy so
nobody reads 0.91 as discrimination.

**Mitigations are compared on an identical, untouched test split** — none →
reweighting → group-aware — with the selection rule and its predeclared overall
degradation budget printed alongside the choice.

---

## Evidence workspace UI

`neurolens serve` hosts a static single-page app: no npm, no bundler,
hand-rolled SVG charts. Screens are grouped **Workspace / Build / Evaluate /
Inspect / Release**, with a persistent research-use banner, a run switcher, and
a provenance strip.

Every subgroup metric shows n, CI, gap, and adequacy status. Charts have an
accessible text summary and a data-table alternative. Responsive order is
preserved at every width: research-use warning → reliability/OOD → prediction
→ interval → explanation → provenance → action.

---

## Project layout

```
src/neurolens/
  schema.py       data model, QC ledger, anatomical labels
  config.py       dataclass config, canonical hashing, manifests
  datasets.py     real-dataset loaders and access manifests
  cohort.py       targets, leakage-free splits, feature builder
  models.py       model families, ordinal decomposition, mitigation
  evaluation.py   metrics, calibration, conformal intervals
  ood.py          OOD detection and shift evaluation
  fairness.py     adequacy, audit axes, mitigation selection
  explain.py      KernelSHAP and permutation importance
  reporting.py    figures, markdown/HTML, model card
  pipeline.py     orchestration and the audit report
  cli.py          command-line entry points
  server/         FastAPI evidence workspace + static UI
configs/          example configurations (open and HD pathways)
notebooks/        Colab pipeline walkthrough
scripts/          standalone smoke test
tests/            110 tests, including real FreeSurfer fixtures
```

## Commands

| Command | Purpose |
|---|---|
| `neurolens datasets` | list registered real-dataset manifests and their access tier |
| `neurolens fetch-data --dataset KEY` | download a dataset's open tabular metadata |
| `neurolens run [--config PATH]` | run the full audit pipeline |
| `neurolens report RUN_DIR` | re-render reports for an existing run |
| `neurolens model-card RUN_DIR` | re-render the model card |
| `neurolens serve --runs-root runs` | serve the evidence workspace |
| `neurolens smoke-test` | fast end-to-end verification |

---

## License

MIT — see [`LICENSE`](LICENSE). Data licences belong to the source datasets and
are recorded in the manifest and the model card.
