# Design Brief: NeuroLens

**Product:** NeuroLens — a research-grade clinical AI system for Huntington’s disease progression
**Audience:** Medical/ML researchers first; clinicians and clinical researchers second
**Primary environment:** Google Colab GPU research workflow
**Document status:** Pre-code design direction
**Source:** NeuroLens PRD supplied by the user

## Product design thesis

This product must make a model’s evidence trail as visible as its prediction. The central interface is therefore not a dashboard that celebrates one score; it is an **evidence workspace** that connects cohort construction, leakage controls, model comparison, reliability, subgroup behavior, neuroanatomical explanation, and reproducibility artifacts.

The interface should consistently answer five questions: **What was predicted? How certain is it? Why did the model predict it? Where does it fail or become unreliable? Can another researcher reproduce the result?**

The product is a research prototype, not a diagnostic or treatment tool. That distinction is a first-class design constraint, not footer copy.

---

# 1. Design principles

### 1. Evidence before confidence

Every headline output must be accompanied by its denominator, uncertainty, provenance, and scope. A large metric without sample size, confidence interval, split version, or reliability context is not a complete result. Visual hierarchy should privilege evidence qualifiers over decorative certainty.

**Design consequence:** Put status, n, interval, split, and version beside metrics—not behind a secondary “details” interaction. Never use a green check to imply clinical validity.

### 2. Progressive disclosure without hiding risk

The primary view should be readable in under a minute, while every conclusion must be traceable to deeper evidence. Use layered disclosure: summary first, then subgroup detail, raw configuration, and artifact links. Safety-critical caveats remain visible at every relevant level.

**Design consequence:** A clinician can understand a case card quickly; a researcher can expand the same card into feature values, attribution objects, OOD score, and run metadata without leaving context.

### 3. Reproducibility is part of the interface

Dataset versions, target definitions, patient-level splits, seeds, feature lists, package versions, and configuration hashes are not engineering metadata to be buried in logs. They are user-facing objects that establish whether a result can be trusted and repeated.

**Design consequence:** Every run, metric, prediction, and export has a visible provenance trail and stable identifier. Immutable artifacts are visually distinguished from editable setup decisions.

---

# 2. Visual direction

## Mood

The visual language should feel like a **calm neuroimaging laboratory notebook**: precise, restrained, inspectable, and humane. It should communicate scientific seriousness without looking like a hospital bedside system or a generic enterprise analytics product.

The emotional target is **quiet confidence with visible uncertainty**. Surfaces should feel stable and archival. Charts should look like evidence figures prepared for a paper, while interactions should feel like a modern research instrument.

## References and visual cues

Use the structural discipline of scientific figure plates: clear captions, explicit units, confidence bands, sample counts, and restrained color encoding. Borrow the material cues of a laboratory notebook—off-white paper surfaces, graphite text, thin rules, version stamps, and annotation labels—while keeping interaction patterns contemporary.

Use neuroanatomical language as a content cue, not as a decorative motif. A subtle axial-slice grid or contour-line texture may appear in empty states or the product mark, but the application should not be covered in MRI imagery. The UI is about interpreting evidence, not simulating a scanner console.

## What to avoid

Avoid neon “AI” gradients, glowing neural-network motifs, dark cyberpunk interfaces, excessive glassmorphism, glossy 3D brains, gamified fairness scores, traffic-light judgment of people or cohorts, and dashboard walls of equal-weight cards. Avoid medical-blue clichés that imply clinical certification. Avoid red/green-only encodings because they collapse uncertainty and are inaccessible to many users.

Avoid showing a single composite fairness score. The PRD explicitly requires separate genetic, demographic, acquisition/cohort, and intersectional views with adequacy status.

## Layout direction

Use a persistent left navigation rail on desktop, a compact top bar for run context, and a wide content canvas with a readable maximum width of approximately 1440 px. The visual rhythm should alternate between dense analytical regions and generous explanatory spacing. Tables are primary evidence surfaces; cards are used to group meaning, not to turn every datum into a tile.

---

# 3. Design tokens

## Color palette

The palette is intentionally low-saturation. Teal is reserved for supported/selected states, amber for review and uncertainty, and crimson for explicit risk or failure. Neutral ink and paper do most of the work so that charts remain legible.

| Token | Hex | Usage and rationale |
|---|---:|---|
| Ink 950 | `#17212B` | Primary text, headings, high-contrast controls; blue-black feels analytical without hospital-blue branding. |
| Ink 700 | `#3B4A57` | Secondary text, axis labels, metadata. |
| Ink 500 | `#687784` | Tertiary text and disabled-adjacent information; never for essential content alone. |
| Paper 0 | `#FFFFFF` | Primary surface and chart backgrounds. |
| Paper 25 | `#F7F8F6` | Application canvas; warmer than cool gray to evoke a notebook. |
| Paper 100 | `#EDF0ED` | Dividers, table stripes, inactive navigation. |
| Slate 200 | `#D9E0E2` | Borders, input outlines, chart gridlines. |
| Teal 700 | `#146C70` | Primary action, selected navigation, links, “validated within scope” status. |
| Teal 100 | `#D9EFEC` | Selected backgrounds and positive-but-qualified emphasis. |
| Amber 700 | `#9A5B00` | Review, incomplete evidence, elevated uncertainty, insufficient power. |
| Amber 100 | `#FFF0D1` | Warning surfaces. |
| Crimson 700 | `#A43D45` | Failure, OOD warning, leakage or preprocessing risk. |
| Crimson 100 | `#F8DFE1` | Risk backgrounds. |
| Violet 700 | `#5B4B8A` | Genetic feature family and CAG-related series; visually distinct from demographic series. |
| Violet 100 | `#EAE5F5` | Genetic family tint. |
| Blue 700 | `#2E5E8C` | MRI/anatomical feature family and imaging series. |
| Blue 100 | `#DFEAF5` | MRI family tint. |
| Olive 700 | `#5D6D2D` | Clinical covariates and stage-related series. |
| Olive 100 | `#E9EED7` | Clinical family tint. |

**Contrast targets:** Body text and controls must meet at least 4.5:1 against their background; large text at least 3:1; non-text focus indicators at least 3:1. Use Ink 950 for text on all pale tints rather than relying on tinted foreground colors.

## Type scale

Use **IBM Plex Sans** for interface text and **IBM Plex Mono** for IDs, hashes, seeds, configuration snippets, and machine-readable values. IBM Plex Sans fits this product because it is highly legible at compact research-table sizes, has clear numeric forms, and feels technical without the default “startup SaaS” personality. Plex Mono makes provenance values visibly different from prose.

| Token | Size / line height | Use |
|---|---:|---|
| Display | 32 / 38 px | Page title only. |
| H1 | 24 / 30 px | Primary workspace heading. |
| H2 | 20 / 26 px | Major section heading. |
| H3 | 16 / 22 px | Card and panel heading. |
| Body | 14 / 21 px | Default UI copy and table body. |
| Body small | 12 / 18 px | Metadata, captions, helper text. |
| Label | 11 / 15 px, semibold | All-caps or sentence-case field labels. |
| Metric | 28 / 32 px | Headline value; pair with unit and interval. |
| Code | 12 / 18 px mono | Run IDs, hashes, seeds, paths. |

## Spacing scale

Use a 4 px base unit to make dense data tables precise without sacrificing alignment.

| Token | Value |
|---|---:|
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-8` | 32 px |
| `space-10` | 40 px |
| `space-12` | 48 px |
| `space-16` | 64 px |

Use 16 px within controls, 24 px within panels, 32 px between major sections, and 48–64 px around page-level landmarks.

## Radius and elevation

Use modest radii to preserve a research-tool feel: 4 px for inputs and tags, 6 px for panels, and 10 px only for prominent callouts. Do not use pill-shaped containers for ordinary data.

| Token | Value | Use |
|---|---:|---|
| `radius-sm` | 4 px | Inputs, code labels, compact tags. |
| `radius-md` | 6 px | Panels, tables, buttons. |
| `radius-lg` | 10 px | Alert callouts and onboarding surfaces. |
| `shadow-0` | none | Default flat surfaces. |
| `shadow-1` | `0 1px 3px rgba(23,33,43,.08)` | Raised popovers and sticky summary bars. |
| `shadow-2` | `0 8px 24px rgba(23,33,43,.12)` | Modal dialogs only. |

---

# 4. Screen inventory

| Screen | Purpose | Primary user |
|---|---|---|
| Workspace home | Show active projects, recent runs, pipeline health, and unresolved review items. | Researcher |
| Project setup / overview | Establish project scope, cohort, target, and research-use warning. | Researcher |
| Dataset manifest & cohort builder | Select/version datasets, define inclusion and exclusion rules, preview cohort composition. | Researcher |
| Data audit & QC | Inspect missingness, preprocessing failures, exclusions, cohort composition, and subgroup availability. | Researcher |
| Target definition | Define prediction time, future progression endpoint, follow-up horizon, stage definition, and version. | Researcher |
| Split builder | Create patient-level and time-aware partitions; verify zero cross-partition patient overlap. | Researcher |
| Feature catalog | Inspect MRI regional biomarkers, raw/normalized values, missingness, versions, and feature families. | Researcher |
| Experiment configuration | Choose model family, modalities, mitigation, uncertainty/OOD methods, seed, and locked test policy. | Researcher |
| Run monitor | Track Colab execution, pipeline stages, logs, smoke tests, and artifact creation. | Researcher |
| Run comparison | Compare MRI-only, multimodal, baselines, and mitigation experiments on identical test sets. | Researcher |
| Audit dashboard | Present cohort, performance, calibration, uncertainty, OOD, fairness, explanations, and documentation. | Both |
| Fairness audit | Explore genetic, demographic, acquisition/cohort, and adequately powered intersectional results. | Researcher |
| Reliability & OOD | Examine coverage, interval width, error-vs-uncertainty, OOD scores, and flagged cases. | Both |
| Case explorer | Search and inspect individual predictions with stage, interval, explanation, subgroup context, and warning. | Both |
| Case detail | Deep-dive into one patient/session prediction, feature values, attribution, provenance, and caveats. | Both |
| Model card | Review intended use, training scope, limitations, known failure modes, and release status. | Both |
| Reproducibility center | Inspect manifest, split hash, seed, package versions, config hash, artifacts, and export options. | Researcher |
| Export center | Generate Markdown/HTML audit report and JSON artifacts with validation summary. | Researcher |
| Help / glossary | Define terms such as calibration, OOD, interval coverage, subgroup adequacy, and association vs causation. | Both |

The navigation should group these into **Build**, **Evaluate**, **Inspect**, and **Release** rather than presenting a flat list.

---

# 5. User flows

## Flow A: Create a reproducible project

1. The researcher opens Workspace Home and selects **New project**.
2. The project overview requires a project name, research question, intended users, and an always-visible research-prototype acknowledgment.
3. The researcher opens Dataset Manifest and selects a versioned public cohort manifest.
4. The system validates required fields, patient identifiers, session relationships, licensing/access notes, MRI availability, CAG availability, demographics, and follow-up.
5. The researcher defines inclusion/exclusion rules before modeling. Each rule displays its expected effect and the resulting count.
6. The researcher freezes the cohort definition. The interface creates a cohort version and immutable audit record.
7. The system routes the researcher to Data Audit & QC with a checklist of blocking and non-blocking issues.

## Flow B: Define target and leakage-safe split

1. From the project checklist, the researcher opens Target Definition.
2. They choose or propose the continuous progression endpoint, prediction time, follow-up horizon, and stage definition.
3. The UI shows a target preview, outcome distribution, missing follow-up count, stage imbalance, and a prominent “endpoint unresolved” state until the decision is finalized.
4. The researcher confirms which variables are available at prediction time.
5. They open Split Builder and choose patient-level partitioning plus optional time-aware or cross-cohort validation.
6. The system generates train/validation/test manifests and runs a patient-overlap check.
7. The researcher must resolve any overlap or temporal leakage warning before the split can be locked.
8. The split is frozen with seed, version, and split hash; later screens display that hash in run context.

## Flow C: Configure and run an experiment

1. The researcher opens Experiment Configuration from the project checklist.
2. They select task: continuous progression, disease stage, or both.
3. They select modality: MRI-only baseline or MRI + genetics + clinical variables.
4. They select model family and inspect a short rationale about capacity versus sample size.
5. They select uncertainty and OOD methods, fairness mitigation, repeated seeds, and output artifacts.
6. The system checks for missing CAG, insufficient follow-up, class imbalance, unsupported subgroup analyses, and GPU constraints.
7. The researcher reviews a read-only experiment manifest and confirms the held-out test set is locked.
8. The system launches the documented Colab pipeline and routes to Run Monitor.
9. On completion, the run is added to Run Comparison and Audit Dashboard; failed steps remain inspectable rather than disappearing.

## Flow D: Audit a model release

1. The researcher opens Audit Dashboard for a completed run.
2. The overview shows a release-readiness summary: cohort completeness, leakage result, task metrics, calibration, uncertainty, OOD, fairness coverage, explanation coverage, and model-card status.
3. The researcher examines Performance and Comparison to assess incremental value and trade-offs.
4. They open Fairness Audit, where each subgroup metric includes n, confidence interval, gap, and adequacy status.
5. They open Reliability & OOD to examine whether uncertainty identifies error and distribution shift.
6. They inspect representative and flagged cases in Case Explorer.
7. They review the Model Card and Reproducibility Center.
8. The system blocks “Release” while required artifacts, limitations, or unsupported-analysis labels are missing.
9. The researcher exports Markdown/HTML and JSON, then records a model version.

## Flow E: Interpret one case

1. A clinician or researcher opens Case Explorer and searches by patient/session identifier or filters by flagged status.
2. The result row shows prediction, horizon/units, interval, stage, OOD status, and run version.
3. Selecting a case opens Case Detail with a concise summary first.
4. The viewer sees the interval and reliability banner before the explanation.
5. The explanation groups contributors into MRI, genetic, and clinical families and translates MRI regions into neuroanatomical terms.
6. The viewer can expand raw feature values, attribution values, subgroup reliability context, and provenance.
7. The page reiterates that model association is not biological causation and that the prototype is not validated for clinical decision-making.

## Flow F: Respond to an incomplete or unreliable run

1. The system detects a preprocessing failure, missing modality, insufficient subgroup, OOD case, or calibration concern.
2. It records the event with a severity, affected count, scope, and recommended next action.
3. The user can inspect affected records and the exact rule that caused the status.
4. The system offers predeclared alternatives only—for example, MRI-only inference when CAG is missing, if that pathway was configured.
5. Any fallback produces a visibly different model/input label and is included in exports.
6. The user must acknowledge or resolve the issue before the run can be marked release-ready.

---

# 6. Per-screen layout

## Workspace Home

**Sections:** workspace switcher; project list; recent runs; pipeline health; “needs review” queue; reproducibility shortcuts. **Hierarchy:** project name and current status first, then unresolved evidence issues, then recent activity. **Primary action:** Create project. **Components:** project row, status chip, run row, progress meter, issue queue, empty-state panel.

## Project Overview

**Sections:** project identity; research-use banner; milestone checklist; current cohort/target/split/model versions; recent audit summary. **Primary action:** Continue setup or open current audit. **Components:** checklist stepper, provenance strip, warning banner, metric preview, version badge.

## Dataset Manifest & Cohort Builder

**Sections:** manifest selector; source/access metadata; inclusion rules; exclusion rules; cohort preview; freeze bar. **Hierarchy:** selected manifest and version, then rule builder, then count impact. **Primary action:** Freeze cohort version. **Components:** version selector, rule builder, count delta table, filter chips, cohort composition chart, confirmation dialog.

## Data Audit & QC

**Sections:** blocking checks; missingness; preprocessing failures; excluded records; cohort/subgroup composition; QC table. **Primary action:** Resolve blocking issue or continue to target. **Components:** audit checklist, issue banner, missingness matrix, sortable table, failure drawer, subgroup adequacy badge.

## Target Definition

**Sections:** continuous endpoint; prediction timestamp; follow-up horizon; stage definition; variable availability; outcome preview; unresolved-decision callout. **Primary action:** Freeze target definition. **Components:** radio/select controls, timeline diagram, distribution chart, stage prevalence chart, definition version card, validation message.

## Split Builder

**Sections:** partition strategy; proportions; stratification; temporal/cross-cohort options; overlap verification; manifest preview; immutable release summary. **Primary action:** Lock split. **Components:** strategy selector, partition bar, patient-overlap result, hash display, seed input, lock dialog.

## Feature Catalog

**Sections:** feature family tabs; region table; raw versus normalized toggle; distributions; missingness; software/version metadata. **Primary action:** Export feature manifest or return to configuration. **Components:** feature table, distribution plot, family legend, definition drawer, version badge.

## Experiment Configuration

**Sections:** task and target; input modalities; model family; mitigation; uncertainty/OOD; seeds; compute constraints; generated manifest. **Primary action:** Review and run. **Components:** segmented control, model cards, checkbox groups, seed list, GPU constraint alert, manifest preview, locked-test badge.

## Run Monitor

**Sections:** run identity; pipeline timeline; current stage; logs; smoke tests; artifact inventory; failure recovery. **Primary action:** Inspect failed stage or open completed audit. **Components:** stage timeline, log viewer, progress bar, status chip, artifact list, retry/stop control.

## Run Comparison

**Sections:** run selector; shared test-set verification; headline metrics; performance trade-off plots; calibration comparison; worst-group comparison; configuration differences. **Primary action:** Open selected audit. **Components:** comparison table, metric cell with CI, line/bar chart, test-set lock badge, diff drawer.

## Audit Dashboard

**Sections:** release-readiness header; cohort; performance; calibration; uncertainty; OOD; fairness; explanations; comparison; documentation. **Hierarchy:** readiness and limitations at top; evidence sections below in a stable order. **Primary action:** Review release blockers or export report. **Components:** evidence scorecard, metric cards, plot panels, subgroup summary table, alert rail, report action bar.

## Fairness Audit

**Sections:** audit-axis selector; subgroup performance; calibration gaps; worst-group summary; confidence intervals; sample-size adequacy; intersectional explorer. **Primary action:** Inspect a flagged disparity or export fairness section. **Components:** axis tabs, subgroup table, gap chart, CI plot, `INSUFFICIENT DATA` badge, adequacy tooltip, filter bar.

## Reliability & OOD

**Sections:** coverage; interval width; error versus uncertainty; OOD score distribution; flagged cases; failure examples; validated reliability regime. **Primary action:** Open flagged cases. **Components:** coverage card, scatter plot, threshold legend, reliability banner, flagged-case table, methodology drawer.

## Case Explorer

**Sections:** search/filter toolbar; result count; case table; saved filters; export selection. **Primary action:** Open case. **Components:** search field, filter chips, table, pagination, sort controls, status badges, saved-view menu.

## Case Detail

**Sections:** research-use banner; prediction summary; uncertainty; stage probabilities; reliability/OOD; MRI contributors; genetic/clinical contributors; subgroup context; provenance; association-not-causation note. **Primary action:** View run/audit context. **Components:** prediction card, interval visualization, probability bars, contributor list, anatomy definition drawer, warning banner, provenance panel.

## Model Card

**Sections:** model identity; intended use; training scope; cohort; inputs; evaluation; limitations; known failure modes; release status. **Primary action:** Export model card or return to blockers. **Components:** document sections, definition list, status banner, artifact links, print/export controls.

## Reproducibility Center

**Sections:** dataset manifest; target version; split version/hash; seed; preprocessing; feature list; configuration; package versions; saved predictions/metrics/model artifacts; Colab entry point. **Primary action:** Copy manifest or export reproducibility package. **Components:** metadata table, code block, copy button, artifact table, hash viewer, Colab link.

## Export Center

**Sections:** report contents; format selector; validation checklist; included run/version; export history. **Primary action:** Generate export. **Components:** format cards, checklist, progress state, download row, checksum field.

---

# 7. Component library

| Component | Variants | States / behavior |
|---|---|---|
| App shell | Desktop rail, tablet rail, mobile top bar | Expanded, collapsed, current section, keyboard-open. |
| Research-use banner | Global, case-level, export-level | Persistent, acknowledged, expanded details. Never dismissible on case view. |
| Status chip | Validated within scope, Review, Blocked, OOD, Insufficient data, Locked | Default, hover tooltip, focus details, compact table form. |
| Evidence card | Metric, provenance, readiness, warning | Loaded, partial, stale, unavailable. Always shows scope and timestamp/version when applicable. |
| Metric with interval | Point estimate, CI, prediction interval | Normal, wide interval, missing CI, insufficient n. |
| Confidence/interval plot | Horizontal interval, shaded band | Default, selected, unavailable, clipped scale. |
| Subgroup metric table | Grouped, flat, intersectional | Sortable, filtered, insufficient data, loading, row selected. |
| Adequacy badge | Adequate, exploratory, insufficient data | Tooltip explains n/power rule; never implies equality. |
| Warning banner | Informational, review, blocking, reliability | Inline, page-level, sticky; includes reason and action. |
| Checklist stepper | Project setup, release readiness | Not started, active, complete, blocked, skipped with rationale. |
| Version/provenance strip | Dataset, target, split, model, run | Compact, expanded, copied; monospace IDs. |
| Rule builder | Inclusion, exclusion, availability | Empty, edited, invalid, previewing, frozen. |
| Partition visualizer | Train/validation/test | Draft, verified, overlap error, locked. |
| Model option card | Statistical baseline, nonlinear, MRI-only, multimodal | Available, selected, incompatible, insufficient data. |
| Modality selector | MRI, genetics, clinical | Selected, missing required field, fallback enabled, disabled. |
| Pipeline timeline | Data, QC, features, target, split, train, audit, export | Pending, running, complete, warning, failed, skipped. |
| Log viewer | Plain text, filtered, error-focused | Streaming, paused, empty, truncation notice, copy. |
| Plot panel | Calibration, error gap, scatter, distribution | Loading, no data, error, zoomed, data table alternative. |
| Contributor list | MRI, genetic, clinical groups | Positive/negative direction where supported, missing, association disclaimer. |
| Probability bar | Stage probability | Normal, calibrated, low confidence, unavailable. |
| Filter bar | Dataset, group, status, run, time | Empty, active, clearable, overflow drawer. |
| Data table | Dense research, compact result, artifact table | Loading, empty, error, sortable, selectable, keyboard navigation. |
| Modal/dialog | Freeze, lock, export, acknowledge | Open, validation error, confirming, success. Destructive actions require explicit confirmation. |
| Toast/notice | Saved, copied, export started, failure | Non-blocking; never the sole carrier of important risk. |
| Empty state | No project, no run, no flagged cases, no subgroup power | Explains why empty and gives one next action. |
| Tooltip/glossary | Metric definition, neuroanatomical term, methodology | Keyboard accessible, plain-language definition, source/version link where available. |

Components should expose both a visual label and machine-readable status. Status colors are supplementary; text and icons must carry the meaning.

---

# 8. States by key screen

| Screen | Empty | Loading | Error | Success | Offline / unavailable |
|---|---|---|---|---|---|
| Workspace Home | Explain that no project exists; primary action is Create project. | Skeleton project rows with preserved navigation. | “Projects could not be loaded”; retry and local recent-work option. | Show active projects and unresolved review count. | Show cached projects with “last synced” timestamp and disable remote actions. |
| Project Overview | Setup checklist with first step highlighted. | Load project metadata and checklist placeholders. | Identify missing project/version metadata; link to manifest repair. | Show progress and current next action. | Allow local inspection; mark run/export actions unavailable. |
| Dataset Manifest | Explain that a manifest is required before cohort building. | Manifest selector and validation skeleton. | Field-level validation plus affected record count. | Show validated manifest and cohort preview. | Show cached manifest; prevent claiming a new frozen version. |
| Data Audit & QC | State “No audit run yet”; route to ingest/QC. | Per-check skeleton and staged progress. | Preserve partial results and show exact failed check. | All checks display status, counts, and exclusions. | Show last audit with stale label; no new conclusions. |
| Target Definition | Explain unresolved endpoint decision; provide decision path, not a default. | Preview distribution loading. | Identify invalid horizon, unavailable outcome, or leakage risk. | Frozen target version and visible definition summary. | Allow editing draft locally; cannot freeze remotely. |
| Split Builder | Explain why split is needed; no metrics until locked. | Generate manifests and overlap test. | Block on patient overlap or temporal leakage. | Show zero overlap, hash, seed, and locked state. | View last locked split; disable regeneration. |
| Experiment Configuration | Prompt for required cohort, target, and split versions. | Validate compatibility and compute estimate. | Show missing modality, unsupported task, or GPU constraint. | Read-only manifest ready for launch. | Save draft locally; launch disabled. |
| Run Monitor | Explain that no run has been launched. | Live stage timeline, logs, and artifact count. | Failed stage with logs, reason, affected artifacts, and retry guidance. | Completion summary with links to audit and artifacts. | Show last known stage and explicit stale timestamp. |
| Audit Dashboard | Explain that audit requires a completed run. | Section-level skeletons; do not show placeholder metrics as facts. | Preserve completed sections and isolate failed analysis. | Release-readiness summary with blockers and evidence. | Show cached report as read-only and mark data age. |
| Fairness Audit | Explain no sufficiently represented groups or no audit yet. | Load metrics by axis independently. | Show failed subgroup computation without hiding other axes. | Every reported metric includes n, CI, gap, status. | Display last generated analysis with stale label. |
| Reliability & OOD | Explain no predictions or no uncertainty method configured. | Load plots and flagged-case table progressively. | Identify missing intervals, calibration failure, or OOD computation error. | Show coverage, width, error relationship, OOD cases. | Show cached analysis; disable new filtering requiring server data. |
| Case Explorer | “No cases match” distinguishes no data from filters. | Table skeleton and result count placeholder. | Search/filter error with retry and clear-filter option. | Results show prediction, interval, stage, OOD, run. | Cached results are viewable; new search disabled. |
| Case Detail | Explain missing prediction/explanation separately; never fabricate. | Summary first, then contributor panels. | Show unavailable sections and provenance of the failure. | Full prediction, uncertainty, explanation, context, caveats. | Show cached case with last-updated timestamp; no mutable actions. |
| Model Card | Explain card cannot be released until required sections exist. | Load sections independently. | Mark incomplete section and preserve editable content. | Complete model card with release status. | View cached card; export may be disabled. |
| Reproducibility Center | Explain missing artifacts by name. | Artifact inventory and checksums load progressively. | Identify missing package/config/model artifact. | All required artifacts and hashes present. | Allow copying cached metadata; no new package generation. |
| Export Center | Explain no eligible completed run. | Show generation checklist and progress. | Identify failed section and allow corrected re-export. | Show format, version, timestamp, checksum, and download. | Queue export if supported or state that generation requires reconnection. |

---

# 9. Responsive behaviour

## Mobile: 320–767 px

Mobile is for **inspection and triage**, not full experiment construction. Replace the desktop rail with a top bar containing project/run context and a menu. Stack evidence cards vertically. Use a sticky bottom action for one primary action only. Convert dense tables into labeled rows with a “more fields” disclosure; never force horizontal scrolling for the key prediction, interval, stage, OOD, or status columns.

Charts should preserve the important annotation—point estimate, interval, n, and threshold—before detail. Filters open in a full-screen sheet. Case Detail leads with the reliability banner and prediction summary, then lets users expand contributor groups. Configuration flows may be completed on mobile only for small edits; freeze/lock actions require a review screen.

## Tablet: 768–1199 px

Use a collapsible rail and a two-column layout where the left column contains controls or navigation context and the right contains evidence. Tables may scroll horizontally inside an explicitly labeled region, but the first three identity/status columns remain sticky. Use split-view drawers for definitions and provenance rather than modal dialogs when possible.

## Desktop: 1200 px and above

Use the persistent rail, a max-width analytical canvas, and two- or three-column evidence layouts. Keep a sticky run/provenance bar at the top of analytical screens. Use side drawers for definitions, raw values, logs, and configuration diffs so the user can inspect detail without losing comparison context.

## Breakpoint rules

At every breakpoint, preserve the order: **research-use warning → reliability/OOD status → prediction/metric → interval or CI → explanation/evidence → provenance → action**. Do not hide risk content in responsive overflow menus. Hover-only affordances must have focus and touch equivalents.

---

# 10. Accessibility

## Contrast and color

All normal text must meet 4.5:1 contrast and large text 3:1. Focus indicators and meaningful chart marks must meet 3:1 against adjacent colors. Do not encode subgroup, status, or direction through color alone. Pair status with text such as **OOD**, **INSUFFICIENT DATA**, **BLOCKED**, or **LOCKED**. Chart series require line style, point shape, or direct labels in addition to color.

## Focus order and keyboard navigation

Use a logical order matching the page narrative: skip link, header/project context, research-use warning, primary content heading, section navigation, controls, evidence, and actions. The primary action should be reachable without traversing every chart datum. Provide keyboard shortcuts only where discoverable and nonessential.

Tables require predictable cell navigation, sortable headers with `aria-sort`, row selection with visible focus, and a non-visual announcement of filter and sort changes. Drawers and dialogs must trap focus while open, restore focus on close, and close with Escape unless the dialog is an active transaction.

## ARIA and semantics

Use semantic landmarks: `header`, `nav`, `main`, `aside`, and `footer`. Use real headings rather than styled text. Use `role="status"` for non-urgent run progress, `role="alert"` for blocking errors and reliability warnings, and `aria-live="polite"` for asynchronous export/run updates. Every chart needs a concise accessible summary and a data-table alternative. Do not expose a canvas-only chart without an equivalent tabular or textual representation.

Controls must have explicit labels, helper text, error text, and programmatic relationships. Inputs for seeds, hashes, IDs, and CAG values should expose units and expected format. Tooltips must be focusable and not the only place a definition exists.

## Clinical and research comprehension

Use plain-language labels beside technical terms: “Out-of-distribution (OOD)” on first use, “prediction interval” with a short explanation, and “model association is not biological causation” near every explanation surface. State the prediction horizon and units in the same visual block as the estimate. Make sample size and confidence interval visible in subgroup rows.

## Motion and cognitive load

Avoid animation for metric changes. If run progress animates, provide reduced-motion behavior and textual stage updates. Preserve user-selected filters and scroll position when opening a detail drawer. Use one primary action per screen and make destructive or irreversible actions—freezing cohorts, locking splits, releasing models—explicitly reviewable.

---

# Release criteria for the design

Before implementation begins, the design should be reviewed against these non-negotiables:

1. A clinician can find prediction, horizon/units, interval, stage, explanation, OOD status, and research-use warning without opening more than one detail surface.
2. A researcher can trace every headline result to dataset version, target definition, split version/hash, model configuration, seed, and artifact list.
3. Every subgroup metric visibly includes n, confidence interval where permitted, gap, and adequacy status.
4. Unsupported analyses are explicit and never rendered as zero, blank, or “pass.”
5. The system never visually implies diagnosis, treatment utility, causal attribution, or validated fairness.
6. Every loading, empty, error, success, and offline state preserves the user’s ability to understand what is known, what is missing, and what action is safe next.
7. The responsive design preserves risk, provenance, and uncertainty content at every viewport size.

This brief is intentionally designed around the PRD’s unresolved dataset-dependent decisions. The UI should support provisional definitions and visibly version them; it should not silently turn an unresolved endpoint, stage taxonomy, uncertainty method, or demographic axis into a permanent product assumption.

## References

[1]: /home/ubuntu/upload/Huntington_Auditable_AI_PRD.md "NeuroLens PRD supplied by the user"
