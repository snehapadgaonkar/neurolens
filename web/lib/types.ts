/**
 * Types for the NeuroLens evidence-workspace API.
 *
 * These mirror the audit report the pipeline actually writes; field names were
 * taken from live `/api/report` responses rather than inferred, so a rename in
 * `reporting.py` shows up here as a type error instead of a blank card.
 */

export type Adequacy = "ADEQUATE" | "EXPLORATORY" | "INSUFFICIENT DATA";
export type Verdict = "PASS" | "WARN" | "INSUFFICIENT DATA";

export interface ResearchUse {
  research_use_notice: string;
}

export interface PackageVersions {
  python: string;
  platform: string;
  numpy: string;
  pandas: string;
  scipy: string;
  sklearn: string;
  matplotlib: string;
  joblib: string;
  yaml: string;
  neurolens: string;
}

export interface ReportManifest {
  run_id: string;
  config_hash: string;
  seed: number;
  created_utc: string;
  hostname: string;
  model_version: string;
  package_versions: PackageVersions;
  pipeline_stages: string[];
}

export interface StageBand {
  label: string;
  range: string;
}

export interface TargetDefinition {
  outcome_measure: string;
  index_session: string;
  outcome_session: string;
  annualized: boolean;
  sign_convention: string;
  stage_cutpoints: number[];
  stage_labels: string[];
  stage_bands: StageBand[];
  stage_definition: string;
  version: string;
  units: string;
}

export interface SplitInfo {
  split_version: string;
  strategy: string;
  seed: number;
  split_hash: string;
  counts: Record<string, number>;
  n_patients: number;
  patient_overlap: Record<string, number>;
  total_overlap: number;
  leakage_free: boolean;
  stratified_on: string | null;
}

export interface QcRecord {
  entity_type: string;
  entity_id: string;
  reason: string;
  severity: string;
  detail: string;
  stage: string;
}

export interface Cohort {
  dataset: string;
  dataset_title: string;
  dataset_version: string;
  dataset_access: string;
  dataset_license: string;
  dataset_citation: string;
  dataset_url: string;
  dataset_notes: string;
  redistributable: boolean;
  n_indexed: number;
  n_analysed: number;
  n_excluded: number;
  exclusion_reasons: Record<string, number>;
  modalities_available: Record<string, boolean>;
  modality_feature_counts: Record<string, number>;
  features: string[];
  feature_missingness: Record<string, number>;
  subgroup_sizes: Record<string, Record<string, number>>;
  stage_distribution: Record<string, number>;
  target_definition: TargetDefinition;
  target_distribution: {
    n: number;
    mean: number;
    sd: number;
    min: number;
    max: number;
  };
  shift_cohort: {
    definition: { column: string; operator: string; value: number };
    n: number;
  };
  split: SplitInfo;
  target_units: string;
  target_histogram: {
    counts: number[];
    bin_centres: number[];
    bin_width: number;
  };
  qc_ledger: QcRecord[];
  qc_reasons: Record<string, number>;
  n_qc_events: number;
}

export interface RegressionMetrics {
  n: number;
  mae: number;
  mae_ci: [number, number];
  rmse: number;
  rmse_ci: [number, number];
  r2: number;
  bias: number;
  sd_true: number;
}

export interface IntervalMetrics {
  n: number;
  target_coverage: number;
  picp: number;
  mean_interval_width: number;
  median_interval_width: number;
  winkler_score: number;
  normal_reference_z: number;
}

export interface CalibrationRegression {
  n: number;
  slope: number;
  intercept: number;
  interpretation: string;
}

export interface ClassMetrics {
  support: number;
  predicted: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ClassificationMetrics {
  n: number;
  classes: string[];
  macro_f1: number;
  balanced_accuracy: number;
  accuracy: number;
  confusion_matrix: number[][];
  confusion_labels: string[];
  per_class: Record<string, ClassMetrics>;
  auroc_ovr_macro: number | null;
  auroc_per_class: Record<string, number>;
  brier_per_class: Record<string, number>;
}

export interface StageOutcomeDistribution {
  counts: Record<string, number>;
  n: number;
  n_classes: number;
  majority_class: string;
  majority_share: number;
  majority_class_accuracy: number;
  verdict: string;
}

export interface ContinuousTask {
  model: string | null;
  metrics: Partial<RegressionMetrics>;
  calibration_regression: Partial<CalibrationRegression>;
  intervals: Partial<IntervalMetrics>;
  conformal: Record<string, unknown>;
  alpha: number;
  predictions: unknown[];
}

export interface StageTask {
  model: string | null;
  metrics: Partial<ClassificationMetrics>;
  calibration: Record<string, unknown>;
  classes: string[];
  outcome_distribution: Partial<StageOutcomeDistribution>;
  notes: string[];
}

export interface ModelCell {
  name: string;
  task: string;
  family: string;
  comparison: string;
  mitigation: string;
  n_features: number;
  modalities: string[];
  features: string[];
  n_train: number;
  n_validation: number;
  n_test: number;
  metrics: Partial<RegressionMetrics> & Partial<ClassificationMetrics>;
  calibration_regression?: Partial<CalibrationRegression>;
  intervals?: Partial<IntervalMetrics>;
  conformal?: Record<string, unknown>;
  calibration?: Record<string, unknown>;
  per_group_error: Record<string, number>;
  worst_group_error: number;
  overall_error: number;
  mitigation_axis: string;
}

export interface FairnessRow {
  axis: string;
  subgroup: string;
  n: number;
  metric: string;
  estimate: number | null;
  ci: [number | null, number | null];
  reference: string;
  reference_estimate?: number | null;
  gap: number | null;
  gap_ci: [number | null, number | null];
  relative_gap: number | null;
  adequacy: Adequacy;
  status: Verdict;
  note: string;
  calibration_gap?: number;
}

export interface MitigationRow {
  name: string;
  task: string;
  mitigation: string;
  overall: number;
  worst_group: number;
  metric: string;
  per_group: Record<string, { n: number; error: number }>;
}

export interface Fairness {
  axes: string[];
  rows: FairnessRow[];
  by_task: Record<string, Record<string, unknown>>;
  worst_group: {
    worst_group: string | null;
    worst_axis: string | null;
    worst_estimate: number | null;
    worst_n: number | null;
    best_group: string | null;
    best_axis: string | null;
    best_estimate: number | null;
    best_n: number | null;
    spread: number | null;
    relative_spread: number | null;
    n_reportable: number;
    n_warn: number;
    n_insufficient: number;
    note?: string;
  };
  preferred_by_task: Record<string, { model: string; rationale: string }>;
  mitigation_comparison: MitigationRow[];
  preferred_model: string;
  preferred_rationale: string;
}

export interface GroupComparison {
  n_shift: number;
  n_in_distribution: number;
  mean_in_distribution: number;
  mean_shift: number;
  difference: number;
  difference_ci: [number, number];
  shift_is_worse: boolean;
}

export interface Trust {
  uncertainty_error: {
    n: number;
    spearman: number;
    p_value: number;
    verdict: string;
  };
  risk_coverage: {
    n: number;
    curve: {
      abstention_fraction: number;
      coverage: number;
      n_retained: number;
      mae: number;
    }[];
    aurc: number;
    mae_full: number;
    mae_at_50pct_abstention: number;
  };
  ood: {
    n: number;
    n_flagged_shift: number;
    n_in_distribution: number;
    auroc_shift_detection: number | null;
    absolute_error: GroupComparison;
    uncertainty: GroupComparison;
    interval_width: GroupComparison;
    verdict: string;
    method: {
      method: string;
      knn_k: number;
      threshold_quantile: number;
      threshold: number;
      n_train: number;
      n_features: number;
      interpretation: string;
    };
    scores: number[];
    threshold: number;
    score_histogram: {
      bin_centres: number[];
      bin_width: number;
      in_distribution: number[];
      shift: number[];
    };
  };
  confident_and_wrong: {
    n: number;
    n_total: number;
    rate: number;
    definition: string;
    patient_ids: string[];
  };
}

export interface Contribution {
  feature: string;
  label: string;
  family: string;
  anatomical_system: string;
  attribution: number;
  direction: string;
  value: number;
  rank: number;
}

export interface ExplanationCase {
  patient_id: string;
  prediction: number;
  base_value: number;
  sum_of_attributions: number;
  reconstruction: number;
  residual: number;
  residual_fraction: number;
  n_coalitions: number;
  n_background: number;
  top: Contribution[];
  contributions: Contribution[];
  by_family: Record<string, Contribution[]>;
  share_of_absolute_attribution: Record<string, number>;
  causation_notice: string;
  explanation_version: string;
  selection_reason: string;
  truth: number;
  absolute_error: number;
  uncertainty: number;
  interval: [number, number];
  // An axis -> level map, as recorded by the explanation, e.g. {"sex": "male"}.
  // This is NOT the same shape as CaseDetail.subgroup_context.
  subgroup_context: Record<string, string>;
}

export interface GlobalImportance {
  feature: string;
  importance: number;
  importance_sd: number;
  baseline_score: number;
  metric: string;
  family: string;
  label: string;
}

export interface Explainability {
  global_importance: GlobalImportance[];
  cases: ExplanationCase[];
  causation_notice: string;
  method: { global: string; local: string; version: string };
}

export interface AuditReport extends ResearchUse {
  project_name: string;
  research_question: string;
  generated_utc: string;
  runtime_seconds: number;
  manifest: ReportManifest;
  cohort: Cohort;
  tasks: { continuous: ContinuousTask; stage: StageTask };
  model_comparison: ModelCell[];
  skipped_comparisons: { comparison: string; reason: string }[];
  fairness: Fairness;
  trust: Trust;
  explainability: Explainability;
  reproduce_command: string;
  limitations: string[];
  known_failure_modes: string[];
  intended_use: string;
  release_readiness: {
    checks: Record<string, boolean>;
    blockers: string[];
    release_ready: boolean;
  };
  figures: Record<string, string>;
}

export interface CaseRow {
  patient_id: string;
  split: string;
  truth: number;
  prediction: number;
  interval: [number, number];
  uncertainty: number;
  interval_width: number;
  ood_score: number;
  ood_threshold: number;
  stage_probabilities: number[];
  stage_classes: string[];
  units: string;
}

export interface CasesResponse {
  total: number;
  offset: number;
  limit: number;
  cases: CaseRow[];
}

export interface CaseDetail {
  patient_id: string;
  prediction: CaseRow;
  explanation: ExplanationCase | null;
  units: string;
  // The full fairness rows for the subgroups this patient belongs to. The
  // subgroup label lives in `subgroup`, not `level`.
  subgroup_context: FairnessRow[];
  research_use_notice: string;
  causation_notice: string;
}

export interface RunSummary {
  run_id: string;
  directory: string;
  dataset: string;
  dataset_access: string;
  split_hash: string;
  config_hash: string;
  release_ready: boolean;
  blockers: string[];
  artifacts: string[];
}

export interface DatasetManifest {
  key: string;
  title: string;
  version: string;
  disease: string;
  access: string;
  license: string;
  url: string;
  citation: string;
  loader: string;
  modalities: string[];
  download_command: string;
  notes: string;
  redistributable: boolean;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}
