# Product Requirements Document

# NeuroLens
## Auditable AI for Huntington’s Disease Progression Under Genetic and Demographic Distribution Shift

**Product type:** Research-grade clinical AI system  
**Primary user:** Medical/ML researcher  
**Secondary user:** Clinician / clinical researcher  
**Compute constraint:** Google Colab GPU only  
**MVP scope:** Full end-to-end research pipeline  
**Clinical status:** Research/decision-support prototype; not for diagnosis or treatment

---

## Product Thesis

NeuroLens should not merely predict Huntington’s disease progression. It should show whether the prediction is trustworthy, which biological signals drive it, where it fails across genetic and demographic subgroups, and when the system should warn the user that a prediction may be unreliable.

The core product is therefore:

**Prediction + Reliability + Explainability + Fairness Auditability**

---

# 1. Problem Statement — Who Hurts and Why

Huntington’s disease (HD) is a progressive genetic neurodegenerative disorder caused by an expanded CAG repeat in the **HTT** gene. Clinical progression varies substantially between individuals, even among people with substantial genetic similarity.

Longitudinal MRI contains measurable structural changes that can complement genetic and clinical information. However, a model that produces only a single progression estimate without reporting uncertainty, subgroup performance, or explanations can be misleading as a research instrument.

### Primary user pain

Researchers need:

- A reproducible way to build HD progression models without treating aggregate performance as sufficient evidence of reliability.
- A method to determine whether prediction error changes with CAG repeat burden, age, sex, disease stage, or other available cohort characteristics.
- Explanations tied to interpretable neuroanatomical biomarkers rather than opaque predictions.
- A repeatable audit artifact that can accompany papers, model cards, and GitHub releases.
- A controlled way to compare fairness mitigation methods without contaminating the test set.

### Secondary user pain

Clinicians and clinical researchers need an understandable indication of:

- Predicted disease trajectory.
- Prediction uncertainty.
- Brain regions/features driving the prediction.
- Whether the patient resembles the model's validated training distribution.
- Whether the output should be treated cautiously.

### Product problem statement

Build a research platform that predicts longitudinal HD progression and disease stage from standardized MRI-derived biomarkers, genetic burden, and selected clinical variables while automatically quantifying subgroup disparities, uncertainty, out-of-distribution risk, and feature-level explanations.

---

# 2. Target User + 2 Personas

## Persona 1 — Medical/ML Researcher

**Role:** Primary user

**Job to be done:** Design, train, compare, audit, and document HD progression models.

**Top needs:**

- Reproducibility.
- Leakage-resistant cohort construction.
- Experiment tracking.
- Statistical rigor.
- Subgroup fairness analysis.
- Uncertainty evaluation.
- Explainability.
- Paper-ready results.

**Success:** Can reproduce the headline results and generate a defensible audit package from a clean Google Colab environment.

**Main risk:** Overclaiming fairness, generalization, or clinical usefulness from weak statistics.

---

## Persona 2 — Clinician / Clinical Researcher

**Role:** Secondary user

**Job to be done:** Understand whether an AI prediction is clinically plausible and appropriately qualified.

**Top needs:**

- Clear progression estimate.
- Disease-stage prediction.
- Uncertainty.
- Neuroanatomical rationale.
- Reliability/OOD warning.
- Clear limitations.

**Success:** Can quickly understand what the model predicts, why it predicted it, and when the prediction should not be trusted.

**Main risk:** Treating a research prototype as a clinically validated diagnostic system.

---

# 3. Goals and Non-Goals

## Goals

1. Create a patient-level, leakage-resistant HD dataset pipeline from public/reproducible research resources.
2. Predict a continuous future progression target.
3. Predict disease stage as a separate task.
4. Compare MRI-only models against multimodal MRI + genetic + clinical models.
5. Quantify performance and calibration overall and across predefined subgroups.
6. Implement uncertainty estimation.
7. Implement out-of-distribution detection.
8. Provide interpretable explanations based on neuroanatomical MRI-derived features.
9. Evaluate fairness-aware mitigation methods.
10. Generate machine-readable and human-readable audit reports.
11. Produce reproducible artifacts suitable for a research paper and public GitHub repository.
12. Keep the entire MVP runnable using Google Colab GPU resources.

## Non-Goals

NeuroLens will **not**:

- Diagnose Huntington’s disease.
- Recommend treatment or medication.
- Replace clinician judgment.
- Be deployed as a hospital production system.
- Claim clinical validity without external/prospective validation.
- Train a massive end-to-end 3D MRI foundation model.
- Claim causal effects of CAG repeat length or MRI features.
- Manufacture demographic or ancestry variables that are not present in the dataset.
- Make fairness claims for subgroups with inadequate sample sizes.
- Require production HIPAA infrastructure in the MVP.

---

# 4. User Stories

1. **As a researcher, I want to ingest and standardize longitudinal MRI and patient-level metadata so that experiments are reproducible and leakage-resistant.**

2. **As a researcher, I want to define a future continuous progression target so that I can evaluate prognosis rather than only diagnosis.**

3. **As a researcher, I want to predict disease stage so that the model has a discrete clinical interpretation alongside the continuous estimate.**

4. **As a researcher, I want an MRI-only baseline so that I can measure the incremental value of genetics and clinical variables.**

5. **As a researcher, I want subgroup metrics by genetic burden and available demographics so that hidden performance disparities become visible.**

6. **As a researcher, I want uncertainty intervals and OOD flags so that unreliable predictions can be identified.**

7. **As a researcher, I want feature-level explanations so that I can determine whether predictions are driven by plausible neuroanatomical signals.**

8. **As a researcher, I want fairness mitigation experiments under identical data splits so that improvements can be attributed to the mitigation method rather than changes in evaluation data.**

9. **As a researcher, I want automated audit reports so that every model release has a standardized evidence trail.**

10. **As a clinician, I want a concise prediction summary with uncertainty and explanations so that I can judge whether the output is plausible.**

11. **As a clinician, I want an explicit research-use warning so that I do not interpret the prototype as a validated clinical decision tool.**

---

# 5. Feature List

## MVP

### Data

- Dataset ingestion.
- Dataset versioning.
- Cohort builder.
- Patient-level deduplication.
- Patient-level train/validation/test splitting.
- Longitudinal session handling.
- Data-quality reporting.

### MRI

- MRI preprocessing.
- MRI quality control.
- Neuroanatomical segmentation/feature extraction.
- Regional volume and normalized volume features.

### Modeling

- MRI-only baseline.
- Multimodal MRI + genetics + clinical model.
- Continuous progression prediction.
- Disease-stage prediction.
- Calibration.

### Trust and fairness

- Demographic subgroup audit.
- Genetic-burden subgroup audit.
- Fairness metrics.
- Fairness mitigation experiments.
- Uncertainty estimation.
- OOD detection.

### Explainability

- Global feature importance.
- Patient-level explanations.
- Neuroanatomical feature mapping.

### Research infrastructure

- Experiment tracking.
- Reproducibility manifest.
- Automated audit report.
- Model card.
- GitHub-ready artifacts.

---

## V2

- External cohort/domain validation.
- More advanced 3D imaging model.
- Multi-task progression modeling.
- Longitudinal sequence model.
- Counterfactual explanation module.
- Survival/time-to-event formulation.
- Conformal prediction.
- Automated subgroup discovery.
- Interactive cohort explorer.
- More advanced domain-shift analysis.

---

## Later

- Prospective clinical validation.
- Clinical workflow integration.
- Privacy-preserving deployment.
- Federated training.
- Real-time clinical monitoring.
- Clinical trial integration.
- Regulatory-grade validation.
- Hospital EHR integration.

---

# 6. Detailed Functional Requirements Per MVP Feature

## F1. Dataset Ingestion and Cohort Builder

NeuroLens must:

- Accept the selected public HD research dataset(s).
- Maintain a versioned metadata manifest.
- Map records to unique patient identifiers.
- Separate patient IDs from session/image IDs.
- Support multiple longitudinal sessions per patient.
- Store source cohort/study information.
- Store acquisition metadata where available.
- Validate required fields before training.
- Generate patient-level train/validation/test partitions.
- Ensure no patient appears in more than one partition.
- Prevent temporal leakage.
- Record inclusion/exclusion criteria.
- Record random seed and split manifest.
- Freeze the final evaluation cohort before headline testing.

---

## F2. MRI Preprocessing and Quality Control

NeuroLens must:

- Standardize MRI orientation where appropriate.
- Standardize voxel-space conventions where appropriate.
- Run a documented preprocessing pipeline.
- Detect missing scans.
- Detect corrupted files.
- Detect incompatible dimensions.
- Record preprocessing failures.
- Record QC failures.
- Log every excluded scan and its reason.
- Never silently drop samples.
- Generate cohort-level QC summaries.
- Report QC by relevant subgroup where sample sizes allow.

---

## F3. Neuroanatomical Feature Extraction

NeuroLens should prioritize interpretable structural biomarkers.

At minimum, investigate:

- Caudate volume.
- Putamen volume.
- Ventricular volume.
- Additional standardized brain-region measurements where reliably available.

Requirements:

- Preserve raw measurements.
- Preserve normalized measurements separately.
- Normalize for intracranial volume where scientifically justified.
- Record the feature-generation version.
- Record segmentation/preprocessing software versions.
- Report feature distributions.
- Report missingness.
- Prevent future information from entering features.

---

## F4. Target Construction

NeuroLens must support two prediction tasks.

### Continuous progression

The exact endpoint must be finalized after dataset research.

Candidate classes include:

- Future clinical progression score.
- Future motor/cognitive measure.
- MRI-derived progression/atrophy measure.
- Another standardized longitudinal HD outcome.

Requirements:

- Define a fixed prediction horizon.
- Use only information available at the index time as model inputs.
- Require sufficient follow-up.
- Report target distribution.
- Report missing outcome counts.
- Version the target definition.

### Disease stage

The system should predict a clinically meaningful disease-stage label.

Requirements:

- Define stage using pre-specified criteria.
- Preserve stage ordering where clinically meaningful.
- Consider ordinal modeling if the data support it.
- Report class distribution.
- Report insufficient-label cases.
- Do not create arbitrary stage boundaries without justification.

**Open decision:** Exact progression endpoint and stage definition remain dataset-dependent.

---

## F5. Baseline and Multimodal Models

At minimum:

### Baseline 1

Regularized linear regression for continuous progression.

### Baseline 2

Logistic/ordinal regression for disease stage.

### Baseline 3

Gradient-boosted/nonlinear model.

### MRI-only model

MRI-derived biomarkers only.

### Multimodal model

MRI-derived biomarkers + CAG repeat length + permitted clinical variables.

Requirements:

- Use identical evaluation sets.
- Keep model capacity appropriate for sample size.
- Use leakage-resistant model selection.
- Store hyperparameters.
- Store random seeds.
- Store feature lists.
- Store model version.
- Store training metrics.

---

## F6. Continuous Progression Prediction

NeuroLens must return:

- Point prediction.
- MAE.
- RMSE.
- Calibration/reliability measures.
- Subgroup MAE.
- Subgroup RMSE.
- Worst-group error.
- Confidence intervals where statistically appropriate.

The system must:

- Report subgroup sample sizes.
- Avoid interpreting unstable subgroup estimates as definitive.
- Distinguish exploratory analyses from adequately powered analyses.

---

## F7. Disease-Stage Prediction

NeuroLens must report:

- Macro-F1.
- Balanced accuracy.
- AUROC where appropriate.
- Confusion matrix.
- Calibration.
- Per-class performance.
- Subgroup performance.

Accuracy alone must not be the primary stage metric when class imbalance exists.

If stage is ordinal, NeuroLens should evaluate whether ordinal regression provides a better representation than ordinary multiclass classification.

---

## F8. Fairness Audit

Audit groups should be defined before final testing.

Potential groups:

- Sex.
- Age strata.
- CAG repeat burden.
- Disease stage.
- Acquisition/source cohort.
- Race/ethnicity/ancestry only if genuinely available and sufficiently represented.

The system must calculate:

- Subgroup performance.
- Error gaps.
- Calibration gaps.
- Worst-group performance.
- Sample sizes.
- Confidence intervals where appropriate.

Intersectional analysis should only be performed when cell sizes are adequate.

NeuroLens must support:

**PASS**

**WARN**

**INSUFFICIENT DATA**

rather than forcing every subgroup into a binary fair/unfair label.

---

## F9. Fairness Mitigation

The MVP should compare:

### Model A — No mitigation

Standard training.

### Model B — Reweighting

Adjust sample weights based on predeclared subgroup structure.

### Model C — Group-aware objective

Use only if subgroup representation is sufficient.

Requirements:

- Keep the test set untouched.
- Use identical splits across mitigation methods.
- Compare overall performance.
- Compare worst-group performance.
- Compare calibration.
- Compare uncertainty.
- Document trade-offs.

Preferred model selection rule:

> Reduce worst-group error without unacceptable degradation in overall clinical prediction performance.

---

## F10. Uncertainty and OOD Detection

NeuroLens must not present a raw "confidence score" without defining what it means.

The system should implement at least one defensible uncertainty method, such as:

- Ensemble-based uncertainty.
- Monte Carlo methods where compatible.
- Conformal prediction where assumptions are defensible.

Outputs should include:

- Prediction interval or calibrated uncertainty.
- Uncertainty score with a defined interpretation.
- Error-vs-uncertainty analysis.

### OOD detection

NeuroLens should identify samples that differ substantially from the validated training distribution using a validated feature-space/density/distance method.

The system must test whether:

- OOD cases have higher uncertainty.
- OOD cases have higher error.
- Distribution-shift cohorts are correctly identified.

A high-confidence but incorrect prediction must be treated as an explicit failure mode.

---

## F11. Explainability

### Global

Provide:

- Feature importance.
- Permutation importance where appropriate.
- SHAP where statistically/methodologically appropriate.

### Patient-level

For every supported prediction, show:

- Top contributing MRI biomarkers.
- Top contributing genetic variables.
- Top contributing clinical variables.
- Direction of contribution.
- Relative contribution.

### Neuroanatomical interpretation

Map features to readable anatomical structures.

Example:

> Reduced caudate volume contributed strongly toward the predicted progression estimate.

The system must explicitly distinguish:

**model association ≠ biological causation**

If a future pixel/voxel model is introduced, spatial attribution must undergo sanity checks before being presented as clinically meaningful.

---

## F12. Research Audit Dashboard / Report

The audit report must include:

### Cohort

- Total patients.
- Total imaging sessions.
- Inclusion/exclusion counts.
- Cohort composition.
- Missingness.
- Subgroup sizes.

### Model

- Architecture.
- Features.
- Hyperparameters.
- Dataset version.
- Split version.
- Random seed.

### Performance

- Overall metrics.
- Subgroup metrics.
- Confidence intervals.
- Calibration.

### Trust

- Uncertainty.
- OOD analysis.
- Failure cases.

### Explainability

- Global explanations.
- Representative patient explanations.
- Neuroanatomical feature contributions.

### Fairness

- Baseline fairness.
- Mitigated fairness.
- Overall-performance trade-offs.

### Release documentation

- Intended use.
- Limitations.
- Known failure modes.
- Dataset scope.
- Non-clinical status.

Exports should include:

- JSON.
- Markdown/HTML.
- Figures.
- Model card.

---

## F13. Reproducibility and Experiment Tracking

Every experiment must have:

- Unique run ID.
- Dataset version.
- Split hash.
- Random seed.
- Preprocessing version.
- Feature list.
- Model configuration.
- Hyperparameters.
- Package versions.
- Evaluation configuration.

The repository must provide:

- One main Google Colab entry point.
- Environment/setup instructions.
- Smoke test.
- Reproduction instructions.
- Saved metrics.
- Saved predictions.
- Experiment manifests.

Deterministic settings should be used where practical, with GPU-dependent variability documented.

---

# MVP Acceptance Criteria

The MVP is complete when:

1. A new researcher can run the documented Colab pipeline from dataset manifest to audit report.
2. Patient-level leakage is automatically checked.
3. Continuous progression prediction is implemented.
4. Disease-stage prediction is implemented.
5. MRI-only and multimodal models are compared.
6. Fairness audits are generated.
7. Fairness mitigation experiments are completed.
8. Uncertainty is empirically evaluated.
9. OOD detection is empirically evaluated.
10. Patient-level explanations are generated.
11. A final audit report is automatically generated.
12. A model card is generated.
13. The main results can be reproduced from a clean Colab runtime.
14. All unsupported/underpowered subgroup analyses are explicitly marked.

---

# 7. Data Model Sketch

## Patient

**Fields**

- `patient_id`
- `cohort_id`
- `sex`
- `age_at_baseline`
- `available_demographic_fields`

One record per person.

Patients must never be split across train/validation/test.

---

## ImagingSession

**Fields**

- `session_id`
- `patient_id`
- `acquisition_date`
- `modality`
- `sequence`
- `source_cohort`
- `QC_status`

One patient can have multiple sessions.

---

## MRIFeatures

**Fields**

- `session_id`
- `region`
- `raw_volume`
- `normalized_volume`
- `feature_version`

---

## GeneticProfile

**Fields**

- `patient_id`
- `CAG_repeat_length`
- `genetic_group`

The raw genetic value must be retained separately from derived groups.

---

## ClinicalAssessment

**Fields**

- `patient_id`
- `session_id`
- `assessment_date`
- `stage`
- `motor_variables`
- `cognitive_variables`
- `other_predeclared_variables`

Only information available at prediction time may enter the model.

---

## Outcome

**Fields**

- `patient_id`
- `index_session_id`
- `target_definition_version`
- `future_progression`
- `future_stage`
- `followup_time`

---

## Split

**Fields**

- `patient_id`
- `split_name`
- `split_version`
- `seed`
- `split_hash`

Splits should be immutable after release.

---

## ExperimentRun

**Fields**

- `run_id`
- `model_version`
- `dataset_version`
- `split_version`
- `config_hash`
- `seed`

---

## Prediction

**Fields**

- `run_id`
- `patient_id`
- `prediction`
- `uncertainty_lower`
- `uncertainty_upper`
- `stage_probabilities`
- `OOD_score`

---

## AuditResult

**Fields**

- `run_id`
- `subgroup`
- `n`
- `metric`
- `estimate`
- `confidence_interval`
- `gap`
- `status`

---

## Explanation

**Fields**

- `run_id`
- `patient_id`
- `feature`
- `attribution`
- `rank`
- `explanation_version`

---

## ModelCard

**Fields**

- `model_version`
- `intended_use`
- `limitations`
- `training_scope`
- `known_failure_modes`
- `dataset_version`

---

# 8. Edge Cases and Failure States

| Failure | Required behavior |
|---|---|
| Insufficient subgroup size | Mark as INSUFFICIENT DATA and report n. |
| Missing CAG repeat length | Use MRI-only pathway if predeclared; otherwise exclude from multimodal analysis and record reason. |
| Multiple CAG measurements | Use the value available at prediction time under a versioned rule. |
| Single MRI | Permit only tasks supported by cross-sectional information; do not fabricate longitudinal progression. |
| Insufficient follow-up | Exclude from the relevant task or use a predeclared censored/survival formulation. |
| Patient appears across studies | Deduplicate where linkage is available; otherwise flag duplication risk. |
| MRI preprocessing failure | Log the failure and surface the failure rate. |
| Severe class imbalance | Use appropriate balanced/ordinal methods and avoid accuracy as the primary metric. |
| Confident but wrong prediction | Audit uncertainty calibration and OOD detection. |
| OOD sample | Return output with explicit reliability warning. |
| Mitigation harms another group | Do not select based on one subgroup alone; apply the predeclared multi-objective rule. |
| Implausible explanation | Flag as an explanation failure and investigate leakage/artifact dependence. |
| Dataset access changes | Freeze dataset manifest/version and document access requirements. |
| Colab GPU memory limit | Prefer regional feature models, caching, smaller batches, and mixed precision where appropriate. |
| Random seed instability | Run repeated seeds for headline models and report variability. |

---

# 9. Success Metrics

## Primary Metrics

### Reproducibility

Headline results reproduced within a predeclared tolerance from a clean Colab runtime.

### Leakage

**Target: 0 patients shared across train/validation/test.**

### Continuous prediction

Report:

- MAE.
- RMSE.
- Calibration/reliability.
- Subgroup errors.

The final numeric performance threshold must be set after baseline measurement and dataset characterization.

### Stage prediction

Report:

- Macro-F1.
- Balanced accuracy.
- AUROC where appropriate.
- Calibration.

### Worst-group performance

The preferred model should reduce worst-group error relative to the unmitigated baseline without unacceptable overall performance degradation.

### Uncertainty

Demonstrate empirically that uncertainty is meaningfully associated with prediction error and/or distribution shift.

### OOD detection

Demonstrate that held-out distribution-shift cases have measurably different reliability characteristics from in-distribution cases.

### Explainability

100% of released predictions must have traceable explanation objects.

### Audit completeness

100% of final model releases must include:

- Cohort audit.
- Subgroup analysis.
- Performance.
- Calibration.
- Uncertainty.
- Explainability.
- Limitations.
- Known failure modes.

---

## Guardrails

NeuroLens must never:

- Make a clinical-use claim.
- Claim fairness without subgroup sample sizes and uncertainty.
- Compare models using different test sets.
- Use future clinical information as input.
- Redistribute restricted patient-level data.
- Present correlation/attribution as causation.

---

# 10. Open Questions

These are intentionally unresolved and must be answered through dataset/literature research before implementation is frozen.

1. Which exact public Huntington's cohort/version will be the primary dataset?
2. What is its current access/license status?
3. What exact continuous progression endpoint should be used?
4. What follow-up horizon provides sufficient samples while remaining clinically meaningful?
5. Which disease-stage definition has sufficient labels?
6. Should disease stage be binary, multiclass, or ordinal?
7. Which MRI sequence(s) are consistently available?
8. Which segmentation pipeline can be reproduced within Google Colab GPU limits?
9. Which demographic fields are actually available?
10. Which demographic subgroups are sufficiently represented for meaningful fairness analysis?
11. Is ancestry available with sufficient sample size and provenance?
12. Should the main fairness axis be genetic burden, demographics, acquisition cohort, or a hierarchy of all three?
13. How should cross-study distribution shift be constructed without introducing confounding?
14. Which uncertainty method is most defensible for the final model and sample size?
15. Should the primary continuous prediction represent a future outcome at a fixed horizon or longitudinal rate of change?
16. Which clinical utility proxy should govern the fairness-performance trade-off?
17. Which model family provides enough capacity without overfitting the available sample size?
18. Which findings are strong enough for a publication claim versus exploratory evidence?

---

# Appendix A — Recommended MVP Research Architecture

## Stage 1 — Data Audit

Inventory every candidate cohort:

- Patient count.
- MRI availability.
- CAG availability.
- Demographics.
- Clinical outcomes.
- Follow-up.
- Access restrictions.
- Licensing.

---

## Stage 2 — Cohort Freeze

Select:

- Primary cohort.
- Independent validation cohort if available.

Freeze:

- Inclusion criteria.
- Exclusion criteria.
- Target population.
- Data version.

---

## Stage 3 — Target Freeze

Define:

- Continuous progression endpoint.
- Disease-stage endpoint.
- Prediction horizon.

Ensure inputs do not contain future information.

---

## Stage 4 — Leakage-Safe Splits

Create:

- Patient-level train set.
- Validation set.
- Test set.

For longitudinal data, evaluate whether temporal validation is necessary.

---

## Stage 5 — MRI Features

Extract interpretable regional biomarkers.

Run:

- QC.
- Missingness analysis.
- Distribution analysis.
- Outlier analysis.

---

## Stage 6 — Baselines

Start with simple statistical models.

Do not jump directly to complex deep learning.

---

## Stage 7 — Multimodal Model

Add:

- CAG burden.
- MRI biomarkers.
- Predeclared clinical variables.

Measure the incremental value of each modality.

---

## Stage 8 — Fairness Audit

Evaluate:

- Overall performance.
- Demographic subgroups.
- Genetic burden groups.
- Cohort/domain groups.

---

## Stage 9 — Uncertainty/OOD

Determine:

- Whether uncertainty tracks error.
- Whether OOD cases can be identified.
- Whether uncertainty can support abstention/warnings.

---

## Stage 10 — Fairness Mitigation

Compare:

**No mitigation → reweighting → group-aware approach**

using the same evaluation protocol.

---

## Stage 11 — Explainability

Generate:

- Global feature importance.
- Patient-level explanations.
- Neuroanatomical interpretation.

---

## Stage 12 — Final Evaluation

Lock the model.

Run the untouched test set once for headline results.

Generate:

- Audit report.
- Model card.
- Figures.
- Tables.
- Experiment manifest.
- Reproduction instructions.

---

# Appendix B — Product Output

A final NeuroLens case-level research view should expose:

1. Predicted continuous progression.
2. Prediction horizon and units.
3. Prediction interval/calibrated uncertainty.
4. Predicted disease stage.
5. Stage probabilities.
6. CAG repeat length/group used by the model.
7. Top MRI-derived neuroanatomical contributors.
8. Top non-imaging contributors.
9. OOD/reliability status.
10. Relevant subgroup performance context.
11. Explicit statement that NeuroLens is a research prototype and is not clinically validated.

---

# Appendix C — Definition of Done

NeuroLens is considered complete when:

- The exact dataset is frozen and documented.
- Target definitions are frozen.
- Split methodology is frozen.
- The entire pipeline runs in Google Colab GPU.
- No hidden local dependency is required.
- At least one interpretable baseline is evaluated.
- At least one nonlinear baseline is evaluated.
- At least one multimodal model is evaluated.
- Continuous progression results are reported.
- Disease-stage results are reported.
- Fairness audits are completed.
- Unsupported subgroup analyses are explicitly marked.
- Fairness mitigation experiments are completed.
- Uncertainty is empirically evaluated.
- OOD detection is empirically evaluated.
- Patient-level explanations are generated.
- A final audit report is generated.
- A model card is generated.
- Experiment metadata is reproducible.
- The GitHub repository is understandable without private project context.
- The final results are rigorous enough to support a research manuscript/blog rather than merely a software demonstration.

---

**Status:** Research PRD — dataset-dependent decisions intentionally remain open until the dataset and literature investigation is complete.
