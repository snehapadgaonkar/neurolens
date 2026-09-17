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

Requires Python ≥ 3.9. No GPU. The pipeline and the API need no Node
toolchain; only the optional Next.js workspace in `web/` does (Node ≥ 20).

## Quickstart

```bash
neurolens fetch-data --dataset openneuro-ds004856   # real CC0 data from OpenNeuro
neurolens run --config configs/openneuro-ds004856.yaml
neurolens serve --runs-root runs                    # API + built-in workspace on :8000
```

For the richer Next.js workspace, run the API as above and then:

```bash
cd web && npm install && npm run dev                # workspace on :3000
```

`web/` proxies `/api/*` to the API (override the target with
`NEUROLENS_API`), so the browser never addresses the backend directly.

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
pytest                    # 113 tests, all on real data
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

There is one front end over a read-only JSON API. `neurolens serve` on `:8000`
is a pure API — it renders no HTML and hosts no pages — and the Next.js
workspace on `:3000` is the only UI.

**Why only one.** The API used to also host a second, no-build single-page app.
Two front ends reading the same report meant every field rename had to be made
twice, and only one of them was covered by TypeScript. The workspace now owns
the whole presentation layer, and `:8000` returns a JSON endpoint index at `/`
so it stays useful to `curl` without being a website.

**Next.js workspace** — `web/` is a Next.js 16 App Router app with 14 screens
grouped **Workspace / Build / Evaluate / Inspect / Release**, with a persistent
research-use banner, a run switcher, and a provenance strip, including a
per-patient case view at `/cases/[patientId]`. It proxies `/api/*` to the API,
so the browser only ever talks to the workspace origin.

The workspace honours the audit rules throughout. Every subgroup metric shows n,
CI, gap, and adequacy status; there is no composite fairness score. Charts have
an accessible text summary and a data-table alternative. Responsive order is
preserved at every width: research-use warning → reliability/OOD → prediction →
interval → explanation → provenance → action.

Three checks render real front-end code against a live API rather than fixtures:

```bash
cd web
npm run check:render      # all 14 Next.js screens render live data
npm run check:shell       # shell chrome: banner, run switcher, nav
npm run subgroup-check    # a case that actually has subgroup context
```

`check:render` fails on React warnings (NaN SVG coordinates, duplicate keys) and
on any literal `undefined` or `NaN` in the output — the silent symptom of a
field name that does not match the API.

All three need the Next.js dev server on `:3000` and the API on `:8000`.

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
  server/         FastAPI read-only evidence API (JSON only, no UI)
configs/          example configurations (open and HD pathways)
notebooks/        Colab pipeline walkthrough
scripts/          standalone smoke test
tests/            113 tests, including real FreeSurfer fixtures
web/              Next.js 16 workspace (App Router, TypeScript, Tailwind v4)
  app/(workspace) 14 screens grouped Workspace / Build / Evaluate / Inspect / Release
  components/     shell chrome, UI primitives, hand-rolled SVG charts, data table
  lib/            API client, store, types mirroring the live payload, formatters
  scripts/        render checks that mount the real components against a live API
```

## Commands

| Command | Purpose |
|---|---|
| `neurolens datasets` | list registered real-dataset manifests and their access tier |
| `neurolens fetch-data --dataset KEY` | download a dataset's open tabular metadata |
| `neurolens run [--config PATH]` | run the full audit pipeline |
| `neurolens report RUN_DIR` | re-render reports for an existing run |
| `neurolens model-card RUN_DIR` | re-render the model card |
| `neurolens serve --runs-root runs` | serve the API and the built-in workspace on `:8000` |
| `neurolens serve --run-dir RUN_DIR` | pin the workspace to one run instead of the newest |
| `neurolens smoke-test` | fast end-to-end verification |

From `web/`, once the API is running:

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js workspace on `:3000`, proxying `/api/*` to the API |
| `npm run build` | production build and type check |
| `npm run check:render` | mount all 14 screens against a live API and assert real data |
| `npm run check:shell` | assert the shell chrome renders (banner, run switcher, nav) |
| `npm run subgroup-check` | assert subgroup labels on a case that has subgroup context |
| `npm run check:selectors` | render the real components and assert every hook the e2e suite uses resolves |

### End-to-end tests (Playwright)

One-time setup: `npx playwright install --with-deps chromium` from `web/`.

| Command | Purpose |
|---|---|
| `npm run test:e2e` | run the full browser suite; starts the API and Next.js itself |
| `npm run test:e2e:ui` | interactive watch mode for writing and debugging tests |
| `npm run test:e2e:ci` | CI invocation: 2 retries, GitHub + HTML + list reporters |
| `npm run test:e2e:report` | open the HTML report from the last run |

The suite seeds a real run from the real OpenNeuro ds004856 metadata before it
starts and removes only the run it created afterwards. It refuses to run
against generated data.

The GitHub Actions workflow ships at `ci/e2e.yml`, **not**
`.github/workflows/e2e.yml`, because the push token is a GitHub App
installation without the `workflows` permission. `ci/README.md` explains the
one-line move that enables it.

---

## License

MIT — see [`LICENSE`](LICENSE). Data licences belong to the source datasets and
are recorded in the manifest and the model card.
