# Design Brief: NeuroLens

**Product:** NeuroLens — an evidence workspace for Huntington's disease progression models
**Audience:** Medical/ML researchers first; clinicians, clinical researchers, and informed reviewers second
**Document status:** Pre-code design direction (v2 — supersedes the "laboratory notebook" brief)
**Source:** NeuroLens PRD

---

## What changed in this revision, and why

The previous brief aimed for a *"calm neuroimaging laboratory notebook"*: off-white paper, graphite
ink, hairline rules, 4px radii, IBM Plex. That direction was internally coherent but it optimised for
one reader — the specialist — and it signalled *archive* rather than *product*. It read as a tool you
are required to use, not one you would choose.

This revision keeps every epistemic commitment from the PRD and changes the **register**, not the
**rigour**. Concretely:

| | Before | Now |
|---|---|---|
| Mood | Archival, institutional | Confident, contemporary, human |
| Neutrals | Cool blue-grays (clinical) | Warm neutrals (approachable) |
| Primary action | Muted teal (reads "medical") | Near-black ink; teal demoted to links/focus |
| Radii | 4 / 6 / 10 px | 6 / 8 / 12 / 16 px |
| Type | IBM Plex, 32px max, never actually loaded | Geist, self-hosted, 48px display |
| Theme | Light only | Light + dark |
| Motion | None specified | Purposeful micro-interaction, reduced-motion safe |

### The tension this brief has to hold

"Make it attractive to any audience" and "never imply clinical validity" pull in opposite directions.
A polished consumer surface invites trust by default; this product must **not** be trusted by default.
It is a research prototype that is never clinically validated.

The resolution is a division of labour:

- **Craft carries the warmth.** Typography, spacing, colour, motion, illustration, empty states — this
  is where the product becomes inviting. None of it asserts anything about model quality.
- **Content carries the caution.** Every metric keeps its n, interval, split, and adequacy status. The
  research-use warning stays a first-class, non-dismissible object. Uncertainty is never smoothed away
  for aesthetics.

A useful test: *the interface should look like a product you enjoy using, and read like a document you
would cite.* If a change makes it prettier by making a caveat smaller, the change is wrong.

### Two implementation facts this brief corrects

These were verified against the current code, not assumed:

1. **No webfont is loaded.** `globals.css` declares `--font-sans: "IBM Plex Sans", …` and
   `--font-mono: "IBM Plex Mono", …`, but no `next/font` import or `@font-face` exists anywhere. The
   app renders in fallback system fonts. The old brief specified a typeface the product never had.
2. **The app is light-only.** `globals.css` sets `color-scheme: light` and there is no dark theme.

---

# 1. Design principles

## 1. Warmth in craft, caution in content

The product should feel contemporary and pleasant — generous whitespace, confident type, smooth
motion — while never letting that polish imply clinical validity. Delight is permitted in *how* things
look; it is forbidden in *what* they claim.

**Design consequence:** No celebratory treatment for results. A strong metric renders in the same
visual weight as a weak one; the difference is carried by its interval and its adequacy status, not by
colour intensity, size, or a trophy-like flourish. Green is never used to mean "good model."

## 2. Evidence travels with its number

A metric without its denominator, interval, split, and version is an incomplete thought, and the
interface must not permit that incompleteness to look intentional. Qualifiers are not secondary
detail — they are part of the atomic unit of display.

**Design consequence:** The `Metric` component has no slot for a bare value. Point estimate, interval,
and n are a single composed object with shared baseline alignment, so it is structurally impossible to
render one without the others. Where a qualifier genuinely does not exist, the component renders an
explicit **INSUFFICIENT DATA** state rather than omitting the slot.

## 3. Provenance is a surface, not a footnote

Dataset version, target definition, split hash, seed, config hash, and package versions determine
whether a result can be trusted or repeated. Burying them in logs makes the product look cleaner and
makes it worthless.

**Design consequence:** Every run carries a persistent provenance strip in mono type. Hashes and IDs
are visually distinct from prose everywhere they appear. Copy-to-clipboard is a first-class control on
every provenance value. Immutable artifacts are styled differently from editable setup decisions, so a
user can tell at a glance what they are allowed to change.

---

# 2. Visual direction

## Mood

**Quiet authority.** The product should feel like a well-made instrument from a company that cares
about correctness — closer to Linear, Vercel, or Stripe Dashboard than to a hospital information
system or a generic BI tool.

The emotional target is *inviting rigour*: warm enough that a newcomer is not intimidated, precise
enough that a reviewer trusts it. Surfaces are calm and uncluttered; the density arrives where the
evidence demands it, and retreats everywhere else.

## References

- **Linear** — restraint, near-black primary actions, tight typography, motion that confirms rather
  than decorates. The model for how confident a tool can feel without ornament.
- **Stripe Dashboard** — dense financial data made legible through hierarchy rather than decoration;
  the model for metric-plus-qualifier composition.
- **Vercel / Geist** — the typographic and neutral-warmth baseline; a system designed for exactly this
  kind of technical-but-approachable product.
- **Observable / FT Visual Journalism** — chart craft: direct labelling, explicit uncertainty bands,
  annotation over legend. The model for every figure in this product.

## What to avoid

**Aesthetic failures:**
- Neon "AI" gradients, glowing neural-network motifs, dark cyberpunk surfaces, glossy 3D brains
- Glassmorphism and heavy blur — they obscure data and age badly
- Medical-blue clichés that imply clinical certification
- Dashboard walls of equal-weight cards, where nothing is more important than anything else
- Illustration that anthropomorphises the disease or the patient

**Epistemic failures (each violates the PRD):**
- Traffic-light judgement of people or cohorts
- A single composite fairness score — the PRD requires separate genetic, demographic,
  acquisition/cohort, and adequately powered intersectional views
- Red/green-only encoding, which collapses uncertainty and excludes colour-blind users
- Rendering an unsupported analysis as zero, blank, or "pass"
- Any visual treatment implying diagnosis, treatment utility, causal attribution, or validated fairness

## Layout direction

A persistent left rail on desktop, a run/provenance strip pinned under the header on analytical
screens, and a content canvas capped at **1440 px**. Rhythm alternates between generous explanatory
space and dense analytical regions — the whitespace is what makes the density readable.

Tables are primary evidence surfaces. Cards group meaning; they do not turn every datum into a tile.

---

# 3. Design tokens

## Colour

### Neutrals — warm, not clinical

The previous palette used blue-tinted grays (`#0e1a20` → `#f4f8f9`), which is the single strongest
cue that a medical interface is *institutional*. Shifting to warm neutrals is the cheapest
high-impact change available: it makes the product feel human without changing a single word of copy.

| Token | Hex | Usage | Contrast |
|---|---|---|---|
| `ink-950` | `#16191B` | Headings, primary text, primary buttons | 16.5:1 on canvas |
| `ink-700` | `#3D4347` | Body text, axis labels, metadata | 9.4:1 on canvas |
| `ink-500` | `#6B7276` | Tertiary text, placeholders | 4.6:1 on canvas |
| `ink-400` | `#8A8F93` | Disabled text — never essential content | decorative |
| `canvas` | `#F7F7F5` | Application background | — |
| `surface` | `#FFFFFF` | Cards, panels, tables, inputs | — |
| `raised` | `#FCFCFB` | Sticky bars, popovers | — |
| `border` | `#E5E4E0` | **Decorative** dividers and card edges only | 1.2:1 — see note |
| `border-input` | `#918F88` | Input, select, and checkbox boundaries | 3.2:1 on surface |

**Why two border tokens.** `#E5E4E0` measures 1.19:1 against canvas — invisible to WCAG 1.4.11, which
requires 3:1 for the boundary of any control a user must identify. Using one hairline token for both
dividers and inputs is the standard way products quietly fail that criterion. `border` is explicitly
decorative; `border-input` (`#918F88`, 3.24:1 on surface and 3.02:1 on canvas) is mandatory on every
interactive boundary. Verified to pass against *both* surfaces, since inputs appear on each.

### Brand and action

| Token | Hex | Usage | Contrast |
|---|---|---|---|
| `ink-950` | `#16191B` | **Primary action**, selected navigation, emphasis | 16.5:1 |
| `brand-700` | `#0B5E5A` | Links, focus rings, selection, active tabs | 7.6:1 on surface |
| `brand-600` | `#0E756E` | Hover/pressed brand, chart emphasis | 5.5:1 on surface |
| `brand-100` | `#DCEDEB` | Selected-row and active-tab backgrounds | — |
| `brand-50` | `#EEF8F6` | Subtle brand tint, info backgrounds | — |

**Why near-black is the primary action.** This is the most consequential change in the palette. The
old brief made muted teal the primary button colour — and teal-on-white is the single most reliable
visual shorthand for *"medical software."* Demoting teal to link/focus duty and promoting near-black
to primary action does three things at once:

1. It removes the clinical-certification cue the PRD explicitly warns against.
2. It matches the register of contemporary tools people already find pleasant.
3. It frees the semantic hues to be unambiguous. When the primary button is teal and the "supported
   within scope" status is also teal, users conflate *affordance* with *verdict*. Near-black primary
   cannot be mistaken for a result.

Teal is retained as the accent rather than replaced: it keeps continuity with the existing
implementation (`primary-700: #0f5f63`), so the migration is a token change rather than a rewrite.

### Status — four states, never a gradient between them

The PRD requires **PASS / WARN / INSUFFICIENT DATA** and forbids collapsing these into a single score.
The palette encodes them as discrete hues that are never interpolated.

| Token | Hex | Meaning | Contrast |
|---|---|---|---|
| `affirm-700` / `-100` | `#1F6F4A` / `#E4F1E9` | Supported within scope | 6.1:1 / 5.3:1 |
| `warn-700` / `-100` | `#8A5300` / `#FCF0DA` | Review; elevated uncertainty; underpowered | 6.3:1 / 5.6:1 |
| `insufficient-700` / `-100` | `#5A6369` / `#E9ECEE` | Insufficient data — **not** failure | 6.1:1 / 5.2:1 |
| `risk-700` / `-100` | `#97333C` / `#F8E3E5` | Failure, leakage, OOD, blocked | 7.4:1 / 6.0:1 |

**Why `insufficient` is neutral gray rather than red or amber.** "We cannot tell" is a different
claim from "this is wrong" and from "look closer." Colouring it as either teaches users to read a
missing analysis as a failure — which the PRD explicitly forbids. Gray is deliberately unsatisfying:
it should prompt the question *"why is there no data?"*, and the adjacent adequacy tooltip answers it.

**Every status chip pairs hue with a text label and a distinct glyph.** Colour is supplementary and
never load-bearing.

### Feature families — categorical, collision-checked

| Family | Hex | Contrast on surface |
|---|---|---|
| MRI / anatomical | `#2F6DB5` | 5.3:1 |
| Genetics / CAG | `#7A5AA8` | 5.5:1 |
| Clinical covariates | `#B5643A` | 4.3:1 |
| Demographic | `#3F7F7A` | 4.6:1 |

**Deliberate constraint: no categorical hue is green.** The previous palette used olive for clinical
covariates while using green for `affirm` status — so a chart mark and a success verdict shared a hue
family. The clinical hue moves to clay (`#B5643A`) to eliminate that collision. Series are additionally
distinguished by direct labels and, where lines are used, by stroke pattern — never by colour alone.

### Dark theme

The app is light-only today. Dark mode is specified here as a first-class theme, with every value
re-verified rather than inverted:

| Token | Hex | Contrast |
|---|---|---|
| `canvas` | `#0F1315` | — |
| `surface` | `#161B1E` | — |
| `text-primary` | `#ECEFEF` | 16.2:1 on canvas |
| `text-secondary` | `#A7B0B4` | 8.5:1 on canvas |
| `brand-400` | `#3FC1B4` | 8.5:1 on canvas |
| `affirm-400` | `#67C79A` | 9.1:1 |
| `warn-400` | `#E0A44A` | 8.5:1 |
| `insufficient-400` | `#98A2A8` | 7.2:1 |
| `risk-400` | `#E58A90` | 7.4:1 |
| `border-input` | `#5A666C` | 3.2:1 on canvas |

Dark mode is **not** a filter over the light theme. Charts in particular need re-tuned series colours
and gridline weights; a naive inversion produces muddy fills and unreadable annotation. Budget for it.

## Typography

### Font choice: Geist Sans + Geist Mono

**Why Geist, specifically.** Four reasons, in order of weight:

1. **It ships self-hosted from npm** (`geist`, v1.7.2, SIL Open Font License — verified installable).
   This matters more than aesthetics here: Google Fonts is unreachable in this build environment, and
   any `next/font/google` dependency breaks `next build`. Geist bundles its own WOFF2 files, so the
   typeface survives an offline build. A font that cannot load is not a design decision, it is a
   fallback stack — which is exactly the bug this brief is correcting.
2. **It is designed for interfaces with dense technical data.** Tabular figures by default, so numeric
   columns align without `font-variant-numeric` gymnastics — a real requirement for the case table and
   every subgroup metric.
3. **It is not the generic default.** The brief was asked to avoid obvious defaults; Inter is the
   reflexive answer for "modern SaaS." Geist is close enough in legibility to be safe and distinct
   enough to give the product its own voice.
4. **The mono companion is genuinely matched.** Geist Mono shares the family's proportions, so IDs and
   hashes sit on the same baseline as prose instead of jumping the line height.

Geist Mono is reserved for run IDs, hashes, seeds, file paths, and configuration snippets. Provenance
should *look* like a value, not like a sentence.

### Scale

Larger display sizes and tighter leading at the top of the scale are what separate a contemporary
product from a report. The old scale topped out at 32 px; that reads as a document.

| Token | Size / line height | Tracking | Use |
|---|---|---|---|
| `display` | 48 / 52 | −0.02em | Overview headline only |
| `title` | 32 / 38 | −0.015em | Page titles |
| `h2` | 22 / 28 | −0.01em | Section headings |
| `h3` | 17 / 24 | 0 | Card and panel headings |
| `body` | 15 / 24 | 0 | Default copy and table body |
| `body-sm` | 13 / 20 | 0 | Metadata, captions, helper text |
| `label` | 12 / 16, 600 | +0.01em | Field labels, column headers |
| `metric` | 36 / 40 | −0.02em | Headline value — always with unit + interval |
| `code` | 13 / 20 mono | 0 | IDs, hashes, seeds, paths |

Body moves from 14 px to 15 px. At 14 px, dense research tables feel like a form; at 15 px with 24 px
leading they read as prose that happens to be tabular. That single change does a great deal for the
"not laboratory-driven" goal.

## Spacing

4 px base, extended at the top end. Modern interfaces earn their calm from generous section spacing,
which the old scale capped too early.

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `space-1` | 4 | | `space-8` | 32 |
| `space-2` | 8 | | `space-10` | 40 |
| `space-3` | 12 | | `space-12` | 48 |
| `space-4` | 16 | | `space-16` | 64 |
| `space-5` | 20 | | `space-20` | 80 |
| `space-6` | 24 | | `space-24` | 96 |

16 px inside controls · 24 px inside panels · 40 px between sections · 64–96 px around page landmarks.

## Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 6 px | Inputs, code labels, compact tags |
| `radius-md` | 8 px | Buttons, table cells, small cards |
| `radius-lg` | 12 px | Panels, cards, dialogs |
| `radius-xl` | 16 px | Hero surfaces, onboarding, empty states |
| `radius-pill` | 999 px | Status chips and filter pills **only** |

Radii increase across the board. 4 px is the radius of enterprise software from a decade ago; 8–12 px
is the current register. The pill radius stays restricted to chips and filters — pill-shaped data
containers read as decoration and undermine seriousness.

## Elevation

Softer, more diffuse, and layered. Hard dark shadows read as institutional.

| Token | Value | Use |
|---|---|---|
| `shadow-0` | none | Default flat surface; borders do the work |
| `shadow-1` | `0 1px 2px rgba(22,25,27,.04), 0 1px 3px rgba(22,25,27,.06)` | Hover lift, sticky bars |
| `shadow-2` | `0 4px 12px rgba(22,25,27,.06), 0 12px 32px rgba(22,25,27,.08)` | Popovers, dropdowns |
| `shadow-3` | `0 12px 32px rgba(22,25,27,.10), 0 32px 64px rgba(22,25,27,.12)` | Modals only |

**Default to `shadow-0`.** Depth should come from border and background contrast, not shadow. Shadow is
reserved for things that genuinely float above the page.

## Motion

The old brief specified no motion, which is a large part of why the product felt static. Motion is
restored with discipline:

| Token | Value | Use |
|---|---|---|
| `duration-fast` | 120ms | Hover, focus, press feedback |
| `duration-base` | 200ms | Drawers, dropdowns, tab transitions |
| `duration-slow` | 320ms | Modal entry, page-level reveals |
| `ease-out` | `cubic-bezier(.16,1,.3,1)` | Entering elements |
| `ease-in-out` | `cubic-bezier(.65,0,.35,1)` | Movement and resize |

**Hard rule: metric values never animate.** A number that counts up implies a live measurement and
invites the reader to trust a transient state. Run *progress* may animate; results may not. All motion
honours `prefers-reduced-motion: reduce`, collapsing to instantaneous state changes with no loss of
information.

---

# 4. Screen inventory

This inventory reflects the **14 routes that actually exist** in `web/app/(workspace)/`, verified
against the codebase. The previous brief described 19 screens, several of which were never built;
describing screens that do not exist is how a brief stops being useful.

| Route | Screen | Purpose | Primary reader |
|---|---|---|---|
| `/` | Overview | Headline result, reliability summary, and what to read first | Both |
| `/cohort` | Cohort | Who was included, who was excluded, and why | Researcher |
| `/target` | Target | Outcome definition, units, horizon, distribution | Researcher |
| `/splits` | Splits | Partitions, leakage check, split hash | Researcher |
| `/data` | Data | Dataset provenance, access tier, licence | Researcher |
| `/models` | Models | Families, baselines, MRI-only vs multimodal | Researcher |
| `/reliability` | Reliability | Calibration, intervals, OOD, confident-and-wrong cases | Both |
| `/fairness` | Fairness | Subgroup error with n, CI, gap, adequacy | Researcher |
| `/mitigation` | Mitigation | None vs reweighting vs group-aware, on identical test splits | Researcher |
| `/explanations` | Explanations | Global importances and case attributions | Both |
| `/cases` | Cases | Per-patient prediction, interval, OOD score | Both |
| `/cases/[patientId]` | Case detail | One patient: prediction, attribution, provenance, caveats | Both |
| `/release` | Audit report | Limitations, failure modes, readiness, model card | Both |
| `/glossary` | Glossary | What each term in this workspace means | Both |

Navigation groups these as **Workspace · Build · Evaluate · Inspect · Release** (per `lib/nav.ts`),
which mirrors the order a reviewer actually reads an audit.

### Deferred, and named as such

The old brief specified Run Monitor, Experiment Configuration, Feature Catalog, Export Center,
Reproducibility Center, and Project Overview as separate screens. None exist as routes. Their content
is currently folded into `Overview`, `Data`, `Splits`, and `Release`. This brief does **not**
re-instate them as screens: inventing navigation for unbuilt functionality is how prototypes acquire
dead ends. If any is built later, it earns an entry here at that point.

---

# 5. User flows

## Flow A — First contact (the flow the old brief never had)

The previous brief assumed a returning specialist. A product meant to be attractive to any audience
needs an entry path for someone who has never seen it.

1. A visitor lands on `/` with no active run.
2. The empty state explains what NeuroLens is and is not, in three sentences, with the research-use
   warning already visible — not behind an interstitial.
3. One primary action: **Load the reference run.** Not "Create project" — there is no project model.
4. The workspace populates; the provenance strip appears with dataset, split hash, and seed.
5. A dismissible "How to read this workspace" card points at the five questions and links to
   `/glossary`. It returns from the help affordance once dismissed.

**Why this matters:** the first impression of the product is currently an empty shell. Fixing that is
cheaper than any visual change and does more for "attractive to any audience" than the palette does.

## Flow B — Audit a completed run

1. Open `/`. The readiness summary leads: cohort completeness, leakage result, headline metric,
   calibration, OOD, fairness coverage, model-card status.
2. Read `/models` for incremental value — MRI-only against multimodal, on a verified shared test set.
   The shared-test-set badge is visible before the metrics, not after them.
3. Open `/fairness`. Every subgroup row carries n, CI, gap, and adequacy status. Underpowered rows are
   visibly **INSUFFICIENT DATA**, not zeros.
4. Open `/reliability` to confirm uncertainty actually tracks error, and inspect confident-and-wrong
   cases — the failure mode the PRD singles out.
5. Sample real and flagged cases in `/cases`, then open one.
6. Review `/release` for limitations and failure modes.
7. Export is blocked while required artifacts or limitation text are missing, and the blocker names
   exactly what is absent.

## Flow C — Interpret one case

1. From `/cases`, search by patient/session ID or filter to flagged.
2. The row shows prediction, horizon and units, interval, stage, OOD status, run version.
3. Opening the case shows, in this fixed order: research-use warning → reliability/OOD status →
   prediction and interval → explanation → provenance.
4. The explanation groups contributors by MRI, genetic, and clinical family, and translates regions
   into neuroanatomical terms on demand.
5. The association-not-causation note sits adjacent to the attribution, not in a footer.

## Flow D — Trace a result to its source

1. From any metric, the provenance strip gives dataset version, target version, split hash, seed,
   config hash.
2. Each is copyable in one action and links to the governing screen (`/data`, `/target`, `/splits`).
3. `/release` lists the full artifact inventory with checksums.

## Flow E — Respond to an unreliable or incomplete result

1. The system detects a preprocessing failure, missing modality, insufficient subgroup, or OOD case.
2. It records severity, affected count, scope, and recommended action.
3. The user inspects the affected records and the exact rule that fired.
4. Any fallback (e.g. MRI-only inference where CAG is missing) produces a **visibly different model
   and input label**, and is carried into exports.
5. The run cannot be marked release-ready until the issue is acknowledged or resolved.

## Flow F — Compare mitigation strategies

1. Open `/mitigation`.
2. The screen states up front that all strategies are evaluated on **identical, untouched test
   splits** — the PRD forbids comparing models on different test sets, and the badge asserting this
   must be read before the comparison, not discovered after.
3. Compare none → reweighting → group-aware on headline metric, worst-group metric, and calibration.
4. Where a subgroup is underpowered, the cell renders **INSUFFICIENT DATA** rather than a delta.

---

# 6. Per-screen layout

## Overview (`/`)

**Sections:** research-use banner · headline metric with interval · reliability and OOD summary ·
readiness checklist · what-to-read-first guidance · provenance strip.
**Hierarchy:** the research-use warning is first in DOM order and first visually. Then reliability,
then the headline metric — deliberately *not* metric-first, because leading with a score teaches the
reader to skim past the caveats that follow it.
**Primary action:** Load reference run (empty) / Open audit report (populated).
**Components:** `Banner`, `Metric`, `ReadinessChecklist`, `ProvenanceStrip`, `EmptyState`, `Card`.

## Cohort (`/cohort`)

**Sections:** inclusion summary · exclusion ledger with reasons · cohort composition · subgroup
availability · QC exceptions.
**Hierarchy:** counts first, then the reason for every exclusion. The PRD requires that samples are
never silently dropped, so the exclusion ledger is a primary surface, not a drawer.
**Primary action:** Copy cohort manifest.
**Components:** `DataTable`, `Metric`, `StatusChip`, `CompositionChart`, `AdequacyBadge`.

## Target (`/target`)

**Sections:** outcome definition · prediction time and horizon · units · outcome distribution ·
missing-follow-up count · definition version.
**Hierarchy:** the definition sentence, then the distribution that justifies it.
**Primary action:** Copy target definition.
**Components:** `DefinitionCard`, `DistributionChart`, `KeyValue`, `VersionBadge`.

## Splits (`/splits`)

**Sections:** partition summary · proportions · stratification · **leakage check result** · split hash
and seed · partition manifest.
**Hierarchy:** the leakage result leads. A split that has not been checked is not a result, and the
screen should not let a reader reach the proportions first.
**Primary action:** Copy split hash.
**Components:** `PartitionBar`, `LeakageResult`, `HashField`, `DataTable`, `StatusChip`.

## Data (`/data`)

**Sections:** dataset identity · access tier and licence · provenance · acquisition notes ·
redistribution status.
**Hierarchy:** licence and access before content — a reader who cannot use the data does not need its
schema.
**Primary action:** Copy citation / open source.
**Components:** `KeyValue`, `LicenceBadge`, `ProvenanceStrip`, `Code`.

## Models (`/models`)

**Sections:** shared-test-set verification · headline metrics by family · MRI-only vs multimodal ·
baselines · calibration comparison · configuration differences.
**Hierarchy:** the shared-test-set badge above the table. Comparison metrics are meaningless without
it, so it cannot be scrolled past.
**Primary action:** Open reliability for the selected model.
**Components:** `ComparisonTable`, `MetricCell`, `TestSetLockBadge`, `CalibrationPlot`, `DiffDrawer`.

## Reliability (`/reliability`)

**Sections:** interval coverage · interval width · error-vs-uncertainty scatter · OOD score
distribution · confident-and-wrong cases · validated reliability regime.
**Hierarchy:** coverage first, then the scatter that demonstrates uncertainty tracks error, then the
cases that break it.
**Primary action:** Open flagged cases.
**Components:** `CoverageCard`, `ScatterPlot`, `ThresholdLegend`, `DataTable`, `MethodologyDrawer`.

## Fairness (`/fairness`)

**Sections:** axis selector · subgroup performance table · calibration gaps · worst-group summary ·
intersectional explorer.
**Hierarchy:** every row shows n, CI, gap, adequacy — in that order, always. No axis is summarised
into a single score anywhere on this screen.
**Primary action:** Inspect a flagged disparity.
**Components:** `AxisTabs`, `SubgroupTable`, `GapChart`, `CIPlot`, `AdequacyBadge`, `FilterBar`.

## Mitigation (`/mitigation`)

**Sections:** identical-test-split assertion · strategy comparison · per-subgroup deltas ·
configuration diffs.
**Hierarchy:** the assertion leads; deltas follow. Underpowered cells render **INSUFFICIENT DATA**.
**Primary action:** Open the selected strategy's audit.
**Components:** `ComparisonTable`, `MetricCell`, `DeltaCell`, `TestSetLockBadge`.

## Explanations (`/explanations`)

**Sections:** global feature importances by family · family legend · method and its limits ·
case-attribution entry point.
**Hierarchy:** the method and its limits sit beside the chart, not beneath it. Attribution is the
easiest surface to over-read, so its caveat must compete with the visual, not trail it.
**Primary action:** Open a case attribution.
**Components:** `ImportanceChart`, `FamilyLegend`, `ContributorList`, `DisclaimerNote`.

## Cases (`/cases`)

**Sections:** search and filter toolbar · result count · case table · saved views · export selection.
**Hierarchy:** prediction, interval, stage, OOD, and status are the columns that never hide at any
viewport.
**Primary action:** Open a case.
**Components:** `SearchField`, `FilterBar`, `DataTable`, `SortControl`, `StatusChip`, `Pagination`.

## Case detail (`/cases/[patientId]`)

**Sections:** research-use banner · reliability/OOD banner · prediction and interval · stage
probabilities · MRI contributors · genetic and clinical contributors · subgroup context · provenance ·
association-not-causation note.
**Hierarchy:** fixed order, enforced at every breakpoint: warning → reliability → prediction →
interval → explanation → provenance. This order is a PRD requirement, not a preference.
**Primary action:** View run context.
**Components:** `Banner`, `PredictionCard`, `IntervalPlot`, `ProbabilityBar`, `ContributorList`,
`AnatomyDrawer`, `ProvenancePanel`.

## Audit report (`/release`)

**Sections:** release readiness · intended use · training scope · limitations · known failure modes ·
artifact inventory with checksums · model card · export controls.
**Hierarchy:** blockers above content. An incomplete card should be impossible to mistake for a
finished one.
**Primary action:** Export report (disabled with a named reason until blockers clear).
**Components:** `ReadinessChecklist`, `DocumentSection`, `ArtifactTable`, `ChecksumField`, `ExportBar`.

## Glossary (`/glossary`)

**Sections:** searchable term list · plain-language definitions · technical detail · links to where
each term appears.
**Hierarchy:** plain language first, technical second, always.
**Primary action:** Search.
**Components:** `TermEntry`, `SearchField`, `AnchorNav`.

---

# 7. Component library

| Component | Variants | States |
|---|---|---|
| `AppShell` | desktop rail · tablet rail · mobile top bar | expanded · collapsed · current section · keyboard-open |
| `Banner` | research-use (non-dismissible) · reliability · info · blocking | persistent · acknowledged · expanded. **The research-use variant has no dismiss affordance on case screens.** |
| `Button` | primary (near-black) · secondary · ghost · destructive | default · hover · pressed · focus · disabled · loading |
| `StatusChip` | affirm · warn · insufficient · risk · locked · OOD | default · hover tooltip · focus · compact table form. Always hue + glyph + text label. |
| `Metric` | point estimate · with CI · with prediction interval | normal · wide interval · **missing CI** · insufficient n. **Has no bare-value slot.** |
| `MetricCell` | table-embedded metric | normal · insufficient · stale · loading |
| `IntervalPlot` | horizontal interval · shaded band | default · selected · unavailable · clipped scale |
| `SubgroupTable` | grouped · flat · intersectional | sortable (`aria-sort`) · filtered · insufficient data · loading · row selected |
| `AdequacyBadge` | adequate · exploratory · insufficient data | default · tooltip with the n/power rule. Never implies equality between groups. |
| `DataTable` | dense research · compact result · artifact | loading · empty · error · sortable · selectable · keyboard-navigable · responsive row mode |
| `SortControl` | header-embedded · toolbar select | ascending · descending · none; drives `aria-sort` and actual row order |
| `ComparisonTable` | run comparison · mitigation | loading · partial · error · locked-test verified |
| `TestSetLockBadge` | verified · unverified | verified is required before any comparison metric renders |
| `PartitionBar` | train/validation/test | draft · verified · overlap error · locked |
| `LeakageResult` | pass · fail | the fail state blocks progression and names the overlap |
| `ProvenanceStrip` | compact · expanded | sticky · copied · stale. All values mono and copyable. |
| `HashField` | short · full | copyable · copied · truncated with reveal |
| `VersionBadge` | dataset · target · split · model · run | immutable (locked glyph) vs editable |
| `ContributorList` | MRI · genetic · clinical | positive/negative direction where supported · missing · disclaimer attached |
| `ProbabilityBar` | stage probability | normal · calibrated · low confidence · unavailable |
| `ImportanceChart` | global · per-case | loading · no data · error · data-table alternative present |
| `PlotPanel` | calibration · scatter · distribution · gap | loading · no data · error · accessible summary · data-table alternative |
| `Drawer` | definition · raw values · logs · diff | open · focus-trapped · closed with focus restored · Escape |
| `Modal` | export · acknowledge · confirm | open · validation error · confirming · success. Destructive actions require explicit confirmation. |
| `EmptyState` | no run · no results · no flagged cases · no subgroup power | explains *why* it is empty and offers exactly one next action |
| `Skeleton` | row · card · chart · metric | pulsing at low amplitude; never shaped like a real value |
| `Toast` | saved · copied · export started · failed | non-blocking. **Never the sole carrier of a risk message.** |
| `Tooltip` | metric definition · anatomy · methodology | focusable · plain language · links to source. Never the only place a definition exists. |

**Two structural rules.** Components spread `...rest` so they remain test-hookable. And every component
exposes both a visual label and a machine-readable status — styling is never the only carrier of
meaning.

---

# 8. States

A note on "offline": NeuroLens is a local FastAPI + Next.js workspace reading from `runs/`. There is no
cloud sync and no offline cache, so specifying one would be fiction. The realistic degraded states are
**API unreachable** and **no active run**, and those are what the table below specifies.

| Screen | Empty | Loading | Error | Success | API unreachable |
|---|---|---|---|---|---|
| Overview | What NeuroLens is and is not; one action: load reference run | Section skeletons; **never a placeholder metric shaped like a real one** | Name the failed section; keep the rest readable | Readiness summary with headline metric and intervals | "Cannot reach the evidence API" + retry; no stale numbers shown as current |
| Cohort | No cohort built; link to `/data` | Per-section skeletons | Preserve partial results; name the failed check | Counts plus a reason for every exclusion | Last-known cohort marked stale with its timestamp |
| Target | Endpoint not yet defined; show the decision path, **not a default** | Distribution loading | Invalid horizon, unavailable outcome, or leakage risk | Frozen definition with version and distribution | Draft editable locally; freeze disabled |
| Splits | Why a split is needed; no metrics until locked | Generating manifests and running overlap check | **Blocks on patient overlap or temporal leakage** | Zero overlap, hash, seed, locked state | Last locked split viewable; regeneration disabled |
| Data | No dataset registered | Manifest loading | Field-level validation with affected record count | Validated manifest with licence and provenance | Cached manifest viewable; cannot claim a new version |
| Models | No completed run to compare | Per-metric skeletons | Isolate the failed model; keep others visible | Comparison on a verified shared test set | Read-only last comparison, clearly timestamped |
| Reliability | No predictions, or no uncertainty method configured | Plots and flagged table load progressively | Missing intervals, calibration failure, or OOD computation error | Coverage, width, error relationship, OOD cases | Cached analysis; server-dependent filtering disabled |
| Fairness | No sufficiently represented groups, or no audit yet | Axes load **independently** | Failed subgroup computation shown without hiding other axes | Every metric with n, CI, gap, status | Last analysis, marked stale |
| Mitigation | No mitigation runs | Strategy comparison loading | Name the failed strategy | All strategies on identical untouched splits | Read-only comparison |
| Explanations | No attributions computed | Chart skeletons | Method failure named; case entry point still offered | Global importances with method and limits stated | Cached explanation, marked stale |
| Cases | "No cases match" — distinguishes *no data* from *filters too narrow*, with a clear-filters action | Table skeleton with count placeholder | Search/filter error with retry and clear-filters | Rows with prediction, interval, stage, OOD, run | Cached rows viewable; new search disabled |
| Case detail | Missing prediction and missing explanation reported **separately**; never fabricated | Summary first, then contributor panels | Unavailable sections named, with the failure's provenance | Full prediction, uncertainty, explanation, caveats | Cached case with last-updated time; no mutable actions |
| Audit report | Card cannot release until required sections exist | Sections load independently | Incomplete section marked; editable content preserved | Complete card with release status | Cached card; export disabled |
| Glossary | — (static content) | — | — | Searchable terms | Fully available; it is static |

**Three rules that apply everywhere:**

1. **A skeleton is never shaped like a number.** Loading states must not be mistaken for results — a
   gray bar where a metric will be is honest; a "0.00" is not.
2. **Errors preserve what succeeded.** One failed analysis must not blank the screen.
3. **"No data" and "not enough data" are different states** with different copy and different actions.

---

# 9. Responsive behaviour

## Mobile — 320–767 px

For **inspection and triage**, not experiment construction.

- The rail becomes a top bar with run context and a menu sheet.
- Evidence cards stack vertically.
- One sticky bottom action bar, carrying exactly one primary action.
- Dense tables convert to labelled rows with a "more fields" disclosure. **Prediction, interval,
  stage, OOD, and status never collapse into that disclosure** — they are the point of the row.
- Charts keep their annotation (point estimate, interval, n, threshold) before any detail.
- Filters open in a full-screen sheet.
- Case detail leads with the reliability banner and prediction, then expands contributor groups.

## Tablet — 768–1199 px

- Collapsible rail.
- Two columns: controls/context left, evidence right.
- Tables may scroll horizontally inside an explicitly labelled region, with the first three
  identity/status columns sticky.
- Prefer split-view drawers over modals for definitions and provenance.

## Desktop — 1200 px+

- Persistent rail, canvas capped at 1440 px.
- Two- or three-column evidence layouts.
- Sticky provenance strip on analytical screens.
- Side drawers for definitions, raw values, and config diffs, so detail can be inspected without
  losing comparison context.

## The invariant

At **every** breakpoint, this order is preserved:

> research-use warning → reliability/OOD status → prediction/metric → interval or CI →
> explanation/evidence → provenance → action

Risk content is never hidden in an overflow menu. Hover-only affordances always have focus and touch
equivalents.

---

# 10. Accessibility

## Contrast

Every value in §3 was **computed, not estimated** — WCAG relative luminance against its actual
background:

- Body text and controls: **≥ 4.5:1**. Met — `ink-950` 16.5:1, `ink-700` 9.4:1, `ink-500` 4.6:1.
- Large text: **≥ 3:1**. Met throughout.
- Focus indicators: **≥ 3:1** against adjacent colour. `brand-700` measures 7.6:1 on surface and 7.1:1
  on canvas — it passes against both, so a focus ring is legible wherever it lands.
- Control boundaries: **≥ 3:1** (WCAG 1.4.11). This is the criterion most products fail quietly. The
  decorative `border` token (1.2:1) is therefore **forbidden on inputs**; `border-input` (3.24:1 on
  surface, 3.02:1 on canvas) is mandatory.
- Meaningful chart marks: **≥ 3:1**. All four feature-family hues clear it (4.3–5.5:1).

`ink-400` is disabled-state text only and must never carry essential content.

## Colour is never load-bearing

- Subgroup, status, and direction are never encoded by hue alone.
- Every status pairs a hue with a text label (`OOD`, `INSUFFICIENT DATA`, `BLOCKED`, `LOCKED`) **and**
  a distinct glyph.
- Chart series carry direct labels, and line series carry stroke pattern, in addition to colour.
- No categorical hue is green, so a series can never be confused with the `affirm` status.

## Focus order and keyboard navigation

Focus order matches the page narrative: skip link → header and run context → research-use warning →
main heading → section navigation → controls → evidence → actions. The primary action is reachable
without traversing every chart datum.

- **Skip link** targets `<main id="main" tabIndex={-1}>` and is the first focusable element.
- Tables have predictable cell navigation, `aria-sort` on sortable headers, and row selection with a
  visible focus ring.
- Sort and filter changes announce via a polite live region.
- Drawers and dialogs trap focus while open, restore focus on close, and dismiss on Escape — unless
  the dialog is an active transaction.
- Every interactive component spreads `...rest`, so it is reachable and assertable.

## ARIA and semantics

- Landmarks: `header`, `nav` (`aria-label="Workspace sections"`), `main`, `aside`
  (`complementary`), `footer`. Exactly one `nav` landmark.
- Real headings, not styled text; heading levels never skipped.
- `role="status"` for run progress, `role="alert"` for blocking errors and reliability warnings,
  `aria-live="polite"` for asynchronous updates.
- **Every chart has a concise accessible summary and a paired data-table alternative.** A canvas-only
  chart is not shippable.
- Controls have explicit labels, helper text, and error text with programmatic relationships.
- Seeds, hashes, IDs, and CAG inputs expose units and expected format.
- Tooltips are focusable and never the only home of a definition.

## Comprehension

- Plain-language label beside every technical term: "Out-of-distribution (OOD)" on first use,
  "prediction interval" with a one-line explanation.
- **"Model association is not biological causation"** appears adjacent to every explanation surface —
  not in a footer.
- Prediction horizon and units render in the same visual block as the estimate.
- Sample size and CI are visible in every subgroup row, at every breakpoint.

## Motion and cognitive load

- Metric values never animate.
- All motion honours `prefers-reduced-motion: reduce`, collapsing to instantaneous changes with no
  information loss.
- Filters and scroll position survive opening a detail drawer.
- One primary action per screen.
- Irreversible actions — freezing cohorts, locking splits, releasing models — require an explicit
  review step.

---

# Release criteria

Before implementation, review against these non-negotiables:

1. A clinician can find prediction, horizon/units, interval, stage, explanation, OOD status, and the
   research-use warning **without opening more than one detail surface**.
2. A researcher can trace every headline result to dataset version, target definition, split
   version/hash, model configuration, seed, and artifact list.
3. Every subgroup metric visibly includes n, confidence interval where permitted, gap, and adequacy
   status.
4. Unsupported analyses are explicit — never rendered as zero, blank, or "pass."
5. The system never visually implies diagnosis, treatment utility, causal attribution, or validated
   fairness.
6. Every empty, loading, error, success, and unreachable state preserves the user's ability to
   understand what is known, what is missing, and what action is safe next.
7. Responsive layouts preserve risk, provenance, and uncertainty content at every viewport.
8. The webfont actually loads — verified in a build with no network access to Google Fonts.
9. Every contrast claim in this document is reproduced by an automated check, not by inspection.

## Implementation notes

Three gaps between this brief and the current code, all verified:

1. **No webfont is wired up.** `globals.css` names IBM Plex in `--font-sans`/`--font-mono` but nothing
   loads it, so the app falls back to system fonts. Installing `geist` (v1.7.2, SIL OFL, confirmed
   available from the registry) and importing it via `next/font/local` from the package's own files
   closes this without a Google Fonts dependency.
2. **The app is light-only.** `color-scheme: light` with no dark theme. The dark tokens above are
   specified and contrast-verified but unbuilt.
3. **The old palette values in the previous brief never matched `globals.css`.** The doc said Ink 950
   `#17212B`; the code had `#0e1a20`. Token values in this brief are the ones to implement, and they
   should be the single source of truth for both doc and code.

## References

- NeuroLens PRD — source of every epistemic constraint in this document.
- WCAG 2.1 SC 1.4.3 (contrast minimum), 1.4.6 (contrast enhanced), 1.4.11 (non-text contrast),
  1.4.1 (use of colour), 2.4.7 (focus visible), 4.1.2 (name, role, value).
