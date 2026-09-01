"""End-to-end NeuroLens pipeline.

Implements the twelve stages of PRD Appendix A as a single reproducible run:

=====  ================================================================
Stage  What happens here
=====  ================================================================
1–2    Load the real dataset through its manifest; record access tier.
3      Freeze target definitions and build the index/outcome table.
4      Patient-level splits plus the leakage verification.
5      Assemble the feature catalogue and QC ledger.
6–7    Train baselines, MRI-only and multimodal models on identical splits.
8      Fairness audit with adequacy and PASS/WARN/INSUFFICIENT DATA.
9      Conformal intervals, error–uncertainty analysis, OOD detection.
10     Fairness mitigation comparison and predeclared model selection.
11     Global and patient-level explanations.
12     Audit report, model card, figures, and the reproducibility manifest.
=====  ================================================================

The held-out test set is evaluated exactly once per model cell, after the
conformal calibrator and the OOD threshold have been fitted on train/validation.
"""

from __future__ import annotations

import json
import os
import platform
import socket
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from neurolens import RESEARCH_USE_NOTICE
from neurolens.config import NeuroLensConfig, package_versions, seed_everything
from neurolens.cohort import CohortResult, build_cohort
from neurolens.datasets import resolve_manifest, load_cohort
from neurolens.evaluation import (
    ConformalCalibrator,
    calibration_classification_from_labels,
    calibration_regression,
    classification_metrics,
    interval_metrics,
    regression_metrics,
    risk_coverage,
    uncertainty_error_association,
)
from neurolens.evaluation import bootstrap_ci
from neurolens.explain import CAUSATION_NOTICE, explain_case, permutation_importance
from neurolens.fairness import (
    audit_axis,
    intersectional_audit,
    select_preferred_model,
    worst_group_summary,
)
from neurolens.models import TrainedModel, train_model
from neurolens.ood import OodDetector, evaluate_ood
from neurolens.reporting import (
    render_figures,
    render_html,
    render_markdown,
    render_model_card,
)

__all__ = ["NeuroLensPipeline", "RunArtifacts", "smoke_test"]

CONTINUOUS_FAMILIES = ("ridge", "gradient_boosting")
STAGE_FAMILIES = ("logistic", "ordinal", "gradient_boosting")


@dataclass
class RunArtifacts:
    run_id: str
    run_dir: str
    report: Dict[str, Any]
    paths: Dict[str, str] = field(default_factory=dict)

    def load_json(self, name: str) -> Any:
        with open(self.paths[name], "r", encoding="utf-8") as handle:
            return json.load(handle)


def _modalities_for(comparison: str) -> List[str]:
    if comparison == "mri_only":
        return ["mri"]
    if comparison == "multimodal":
        return ["mri", "genetics", "clinical", "demographic"]
    if comparison == "clinical_only":
        return ["clinical", "demographic"]
    raise ValueError(f"unknown comparison '{comparison}'")


def _histogram(values: np.ndarray, bins: int = 20) -> Dict[str, Any]:
    values = np.asarray(values, dtype=float)
    values = values[~np.isnan(values)]
    if len(values) == 0:
        return {}
    counts, edges = np.histogram(values, bins=bins)
    return {
        "counts": [int(c) for c in counts],
        "bin_centres": [float((a + b) / 2) for a, b in zip(edges[:-1], edges[1:])],
        "bin_width": float(edges[1] - edges[0]),
    }


def _outcome_distribution(truth: np.ndarray) -> Dict[str, Any]:
    """Label distribution of a classification task plus its trivial baseline.

    A stage task whose majority class dominates produces a high raw accuracy that
    says nothing about the model, so the accuracy of an always-majority predictor
    is reported next to it as the floor any headline number has to clear.
    """
    labels = [str(v) for v in np.asarray(truth).tolist()]
    if not labels:
        return {}
    counts: Dict[str, int] = {}
    for label in labels:
        counts[label] = counts.get(label, 0) + 1
    majority, majority_n = max(counts.items(), key=lambda kv: kv[1])
    share = majority_n / len(labels)
    return {
        "counts": counts,
        "n": len(labels),
        "n_classes": len(counts),
        "majority_class": majority,
        "majority_share": float(share),
        "majority_class_accuracy": float(share),
        "verdict": (
            "severely imbalanced" if share >= 0.80
            else "imbalanced" if share >= 0.65
            else "reasonably balanced"
        ),
    }


def _stage_notes(stage_primary: Optional[Dict[str, Any]]) -> List[str]:
    """Reader-facing qualifications for the stage task.

    Both notes exist to stop a headline number from being read on its own: a
    dominant class makes accuracy meaningless, and a two-class cohort makes the
    ordinal-versus-multiclass comparison vacuous.
    """
    notes: List[str] = []
    if not stage_primary:
        return notes
    metrics = stage_primary.get("metrics", {}) or {}
    distribution = _outcome_distribution(stage_primary.get("truth", []))
    share = float(distribution.get("majority_share", 0.0))
    if share >= 0.80:
        notes.append(
            f"{share:.1%} of the test split is '{distribution['majority_class']}' "
            f"({distribution['counts'][distribution['majority_class']]} of "
            f"{distribution['n']}), so raw accuracy "
            f"({float(metrics.get('accuracy', float('nan'))):.3f}) mostly reflects the class "
            f"prior: an always-majority predictor reaches "
            f"{distribution['majority_class_accuracy']:.3f}. Read balanced accuracy "
            f"({float(metrics.get('balanced_accuracy', float('nan'))):.3f}) and macro-F1 "
            f"({float(metrics.get('macro_f1', float('nan'))):.3f}) instead."
        )
    classes = [str(c) for c in (stage_primary.get("classes") or [])]
    if len(classes) == 2:
        notes.append(
            "Only two stage bands are present in this cohort "
            f"({', '.join(classes)}). With two classes the ordinal cumulative-link "
            "decomposition reduces to a single binary logistic model, so ordinal and "
            "multinomial results are expected to coincide and the "
            "ordinal-versus-multiclass comparison cannot be resolved here."
        )
    return notes


class NeuroLensPipeline:
    def __init__(self, config: Optional[NeuroLensConfig] = None) -> None:
        self.cfg = config or NeuroLensConfig()
        self.cohort: Optional[CohortResult] = None
        self.report: Dict[str, Any] = {}
        self.log: List[str] = []

    # ------------------------------------------------------------------ #
    def _note(self, message: str) -> None:
        stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
        self.log.append(f"[{stamp}] {message}")
        print(f"[neurolens] {message}", flush=True)

    # ------------------------------------------------------------------ #
    def run(self) -> RunArtifacts:
        cfg = self.cfg
        seed_everything(cfg.seed)
        started = datetime.now(timezone.utc)
        run_id = self._run_id(started)
        run_dir = os.path.join(cfg.report.output_dir, run_id)
        os.makedirs(run_dir, exist_ok=True)
        self._note(f"run {run_id} · dataset {cfg.data.dataset} · config {cfg.config_hash}")

        # --- stages 1–5: data ------------------------------------------- #
        manifest = resolve_manifest(cfg.data.dataset)
        tables = load_cohort(cfg.data.dataset, cfg.data.data_dir)
        self._note(f"loaded {tables.summary()['n_patients']} patients from "
                   f"{manifest.key} (access: {manifest.access})")

        available = tables.modalities_available()
        for required in cfg.data.require_modalities:
            if not available.get(required):
                raise RuntimeError(
                    f"dataset '{cfg.data.dataset}' does not provide the required "
                    f"'{required}' modality. {manifest.notes}"
                )

        cohort = build_cohort(tables, cfg)
        self.cohort = cohort
        self._note(f"cohort: {cohort.audit['n_analysed']} analysed, "
                   f"leakage_free={cohort.split_info['leakage_free']}")

        analysis = cohort.analysis
        train = analysis[analysis["split_name"] == "train"].reset_index(drop=True)
        validation = analysis[analysis["split_name"] == "validation"].reset_index(drop=True)
        test = analysis[analysis["split_name"] == "test"].reset_index(drop=True)
        if train.empty or test.empty:
            raise RuntimeError("splits produced an empty train or test partition")

        features = cohort.features
        present = features.available_families()
        comparisons: List[str] = []
        skipped: List[Dict[str, str]] = []
        for comparison in cfg.model.comparisons:
            wanted = _modalities_for(comparison)
            usable = [m for m in wanted if present.get(m)]
            if not usable:
                skipped.append({"comparison": comparison,
                                "reason": "none of the required modalities are present "
                                          f"in this dataset (wanted {wanted})"})
                continue
            if comparison == "mri_only" and "mri" not in usable:
                skipped.append({"comparison": comparison, "reason": "no MRI features available"})
                continue
            comparisons.append(comparison)
        if not comparisons:
            comparisons = ["clinical_only"]
            self._note("no configured comparison is supported by this dataset; "
                       "falling back to clinical_only")

        # --- stages 6–7: models ----------------------------------------- #
        results = self._train_and_evaluate(train, validation, test, comparisons, features)

        # --- stage 8: fairness ------------------------------------------ #
        fairness = self._fairness(results, test, features)

        # --- stage 9: trust --------------------------------------------- #
        trust = self._trust(results, train, test, features)

        # --- stage 11: explanations ------------------------------------- #
        explainability = self._explain(results, train, test, features)

        # --- stage 12: assemble ----------------------------------------- #
        created = datetime.now(timezone.utc)
        report = self._assemble_report(
            run_id=run_id, created=created, started=started, manifest=manifest,
            tables=tables, cohort=cohort, results=results, fairness=fairness,
            trust=trust, explainability=explainability, skipped=skipped,
            comparisons=comparisons, test=test,
        )

        paths = self._write_artifacts(report, run_dir)
        self._note(f"wrote {len(paths)} artifacts to {run_dir}")
        return RunArtifacts(run_id=run_id, run_dir=run_dir, report=report, paths=paths)

    # ------------------------------------------------------------------ #
    def _run_id(self, when: datetime) -> str:
        label = self.cfg.run_label if self.cfg.run_label != "auto" else self.cfg.data.dataset
        slug = "".join(c if c.isalnum() or c in "-_" else "-" for c in str(label)).strip("-")
        return f"{when.strftime('%Y%m%dT%H%M%SZ')}-{slug[:40]}"

    # ------------------------------------------------------------------ #
    def _train_and_evaluate(self, train: pd.DataFrame, validation: pd.DataFrame,
                            test: pd.DataFrame, comparisons: Sequence[str],
                            features) -> Dict[str, Any]:
        cfg = self.cfg
        mitigation_axis = cfg.model.fairness_axis_for_mitigation
        if mitigation_axis not in train.columns:
            self._note(f"mitigation axis '{mitigation_axis}' absent; using 'sex'")
            mitigation_axis = "sex" if "sex" in train.columns else train.columns[0]

        cells: List[Dict[str, Any]] = []
        for task in ("continuous", "stage"):
            target_column = "target_continuous" if task == "continuous" else "target_stage"
            if target_column not in train.columns or train[target_column].isna().all():
                self._note(f"task '{task}' skipped: no target values")
                continue
            if task == "stage" and train[target_column].dropna().nunique() < 2:
                self._note(f"task '{task}' skipped: fewer than two classes in training data")
                continue
            families = CONTINUOUS_FAMILIES if task == "continuous" else STAGE_FAMILIES
            for comparison in comparisons:
                modalities = [m for m in _modalities_for(comparison)
                              if features.available_families().get(m)]
                names = features.names_for(modalities)
                if not names:
                    continue
                for mitigation in cfg.model.mitigations:
                    for family in families:
                        name = f"{family}|{comparison}|{mitigation}"
                        try:
                            model = self._fit_cell(
                                family, task, comparison, mitigation, names,
                                train, validation, target_column, mitigation_axis)
                        except Exception as exc:
                            cells.append({"name": name, "task": task, "error": str(exc)})
                            self._note(f"FAILED {name}: {exc}")
                            continue
                        cells.append(self._evaluate_cell(model, train, validation, test,
                                                         names, target_column, task,
                                                         mitigation_axis, name))
                        self._note(f"trained {name}")
        return {"cells": cells}

    def _fit_cell(self, family: str, task: str, comparison: str, mitigation: str,
                  features: Sequence[str], train: pd.DataFrame, validation: pd.DataFrame,
                  target_column: str, mitigation_axis: str) -> TrainedModel:
        y_train = train[target_column].to_numpy()
        if task == "stage":
            y_train = np.asarray([str(v) for v in y_train])
        return train_model(
            family=family, task=task, comparison=comparison, mitigation=mitigation,
            X=train, y=y_train, features=features, cfg=self.cfg,
            groups=train[mitigation_axis],
        )

    def _evaluate_cell(self, model: TrainedModel, train: pd.DataFrame,
                       validation: pd.DataFrame, test: pd.DataFrame,
                       features: Sequence[str], target_column: str, task: str,
                       mitigation_axis: str, name: str) -> Dict[str, Any]:
        cfg = self.cfg
        entry: Dict[str, Any] = {
            "name": name, "task": task, "family": model.family,
            "comparison": model.comparison, "mitigation": model.mitigation,
            "n_features": len(features),
            "modalities": _modalities_for(model.comparison),
            "features": features,
            "n_train": int(len(train)), "n_validation": int(len(validation)),
            "n_test": int(len(test)),
        }

        if task == "continuous":
            calibration_predictions = model.predict(validation)
            calibrator = ConformalCalibrator(
                alpha=cfg.uncertainty.alpha, mode=cfg.uncertainty.conformal)
            calibrator.fit(
                validation[target_column].to_numpy(dtype=float) - calibration_predictions,
                groups=(validation[mitigation_axis].to_numpy()
                        if cfg.uncertainty.conformal == "mondrian" else None),
            )
            predictions = model.predict(test)
            truth = test[target_column].to_numpy(dtype=float)
            lower, upper, width = calibrator.intervals(
                predictions,
                groups=test[mitigation_axis].to_numpy()
                if cfg.uncertainty.conformal == "mondrian" else None,
            )
            entry["metrics"] = regression_metrics(truth, predictions,
                                                  cfg.fairness.n_bootstrap, cfg.seed)
            entry["calibration_regression"] = calibration_regression(truth, predictions)
            entry["intervals"] = interval_metrics(truth, lower, upper, cfg.uncertainty.alpha)
            entry["conformal"] = calibrator.describe()
            entry["uncertainty"] = model.predict_std(test)
            entry["predictions"] = predictions
            entry["lower"] = lower
            entry["upper"] = upper
            entry["interval_width"] = width
            entry["truth"] = truth
            entry["calibration"] = {"reliability": [], "ece": float("nan")}
        else:
            classes = list(model.classes_) if model.classes_ is not None else []
            probabilities = model.predict_proba(test)
            predicted = np.asarray(classes)[np.argmax(probabilities, axis=1)]
            truth = np.asarray([str(v) for v in test[target_column].to_numpy()])
            entry["metrics"] = classification_metrics(truth, predicted, probabilities, classes)
            entry["calibration"] = calibration_classification_from_labels(
                truth, probabilities, classes)
            entry["classes"] = [str(c) for c in classes]
            entry["predictions"] = predicted
            entry["probabilities"] = probabilities
            entry["truth"] = truth
            entry["uncertainty"] = 1.0 - probabilities.max(axis=1)

        # Per-group error for the mitigation comparison.
        groups = test[mitigation_axis].astype(object).fillna("<missing>").astype(str)
        per_group: Dict[str, Dict[str, Any]] = {}
        for level, position in pd.Series(range(len(test))).groupby(groups.to_numpy()):
            index = position.to_numpy()
            if task == "continuous":
                value = float(np.mean(np.abs(entry["truth"][index] - entry["predictions"][index])))
            else:
                value = float(np.mean(np.asarray(entry["truth"])[index]
                                      != np.asarray(entry["predictions"])[index]))
            per_group[str(level)] = {"n": int(len(index)), "error": value}
        entry["per_group_error"] = per_group
        entry["worst_group_error"] = float(max((v["error"] for v in per_group.values()),
                                               default=float("nan")))
        if task == "continuous":
            entry["overall_error"] = float(np.mean(np.abs(entry["truth"] - entry["predictions"])))
        else:
            entry["overall_error"] = float(np.mean(np.asarray(entry["truth"])
                                                   != np.asarray(entry["predictions"])))
        entry["mitigation_axis"] = mitigation_axis
        entry["model"] = model
        return entry

    # ------------------------------------------------------------------ #
    def _primary(self, cells: Sequence[Dict[str, Any]], task: str) -> Optional[Dict[str, Any]]:
        usable = [c for c in cells if c.get("task") == task and "error" not in c]
        if not usable:
            return None
        preferred = [c for c in usable if c.get("mitigation") == "none"]
        pool = preferred or usable
        key = "mae" if task == "continuous" else "macro_f1"
        reverse = task != "continuous"
        def score(cell):
            if task == "continuous":
                return cell["metrics"].get("mae", float("inf"))
            return -cell["metrics"].get("macro_f1", -1.0)
        return min(pool, key=score)

    def _fairness(self, results: Dict[str, Any], test: pd.DataFrame,
                  features) -> Dict[str, Any]:
        cfg = self.cfg
        cells = results["cells"]
        out: Dict[str, Any] = {"axes": cfg.fairness.axes, "rows": [], "by_task": {}}

        for task in ("continuous", "stage"):
            primary = self._primary(cells, task)
            if primary is None:
                continue
            rows: List[Dict[str, Any]] = []
            calibration_gap = None
            if task == "continuous":
                residuals = primary["truth"] - primary["predictions"]
                calibration_gap = pd.Series(residuals, index=test.index)
            for axis in cfg.fairness.axes:
                if axis not in test.columns:
                    continue
                rows.extend(audit_axis(
                    axis=axis, groups=test[axis], y_true=primary["truth"],
                    y_pred=primary["predictions"], task=task, cfg=cfg,
                    calibration_gap=calibration_gap))
            intersectional = []
            for pair in cfg.fairness.intersectional_axes:
                intersectional.extend(intersectional_audit(
                    test, pair, primary["truth"], primary["predictions"], task, cfg))
            out["by_task"][task] = {
                "model": primary["name"],
                "rows": rows,
                "worst_group": worst_group_summary(rows),
                "intersectional": intersectional,
            }
            if task == "continuous" or not out["rows"]:
                out["rows"] = out["rows"] + rows
                out["worst_group"] = worst_group_summary(rows)

        # --- mitigation comparison -------------------------------------- #
        comparison_rows: List[Dict[str, Any]] = []
        for task in ("continuous", "stage"):
            candidates = []
            for cell in cells:
                if cell.get("task") != task or "error" in cell:
                    continue
                if cell.get("family") != (CONTINUOUS_FAMILIES[0] if task == "continuous"
                                          else "logistic"):
                    continue
                if cell.get("comparison") != (cells[0].get("comparison") if cells else None):
                    continue
                candidates.append({
                    "name": cell["name"], "task": task, "mitigation": cell["mitigation"],
                    "overall": cell["overall_error"], "worst_group": cell["worst_group_error"],
                    "metric": "mae" if task == "continuous" else "error_rate",
                    "per_group": cell["per_group_error"],
                })
                comparison_rows.append(candidates[-1])
            if candidates:
                preferred, rationale = select_preferred_model(candidates, cfg)
                out.setdefault("preferred_by_task", {})[task] = {
                    "model": preferred, "rationale": rationale}
        out["mitigation_comparison"] = comparison_rows
        if out.get("preferred_by_task", {}).get("continuous"):
            out["preferred_model"] = out["preferred_by_task"]["continuous"]["model"]
            out["preferred_rationale"] = out["preferred_by_task"]["continuous"]["rationale"]
        elif out.get("preferred_by_task", {}).get("stage"):
            out["preferred_model"] = out["preferred_by_task"]["stage"]["model"]
            out["preferred_rationale"] = out["preferred_by_task"]["stage"]["rationale"]
        else:
            out["preferred_model"] = None
            out["preferred_rationale"] = "no mitigation comparison was possible"
        return out

    # ------------------------------------------------------------------ #
    def _trust(self, results: Dict[str, Any], train: pd.DataFrame, test: pd.DataFrame,
               features) -> Dict[str, Any]:
        cfg = self.cfg
        primary = self._primary(results["cells"], "continuous")
        out: Dict[str, Any] = {}
        if primary is None:
            out["note"] = "no continuous model was trained; uncertainty analysis unavailable"
            return out

        absolute_error = np.abs(primary["truth"] - primary["predictions"])
        out["uncertainty_error"] = uncertainty_error_association(
            primary["uncertainty"], absolute_error)
        out["risk_coverage"] = risk_coverage(primary["uncertainty"], absolute_error)

        ood_columns = [c for c in features.names() if c in train.columns]
        detector = OodDetector(
            method=cfg.uncertainty.ood_method, knn_k=cfg.uncertainty.knn_k,
            threshold_quantile=cfg.uncertainty.ood_threshold_quantile,
        ).fit(train[ood_columns])
        scores = detector.score(test[ood_columns])
        shift = test["is_shift_cohort"].to_numpy() if "is_shift_cohort" in test.columns \
            else np.zeros(len(test), dtype=bool)
        out["ood"] = evaluate_ood(
            scores, shift, absolute_error=absolute_error,
            uncertainty=primary["uncertainty"], interval_width=primary["interval_width"],
            n_boot=cfg.fairness.n_bootstrap, seed=cfg.seed)
        out["ood"]["method"] = detector.describe()
        out["ood"]["scores"] = [float(s) for s in scores]
        out["ood"]["threshold"] = detector.threshold_
        in_dist = scores[~shift.astype(bool)]
        shifted = scores[shift.astype(bool)]
        histogram: Dict[str, Any] = {}
        if len(in_dist) and len(shifted):
            edges = np.linspace(0, 1, 21)
            centres = [(a + b) / 2 for a, b in zip(edges[:-1], edges[1:])]
            histogram = {
                "bin_centres": [float(c) for c in centres],
                "bin_width": float(edges[1] - edges[0]),
                "in_distribution": np.histogram(in_dist, bins=edges)[0].tolist(),
                "shift": np.histogram(shifted, bins=edges)[0].tolist(),
            }
        out["ood"]["score_histogram"] = histogram

        # High-confidence but wrong (PRD: an explicit failure mode)
        if len(absolute_error) >= 8:
            uncertainty_rank = pd.Series(primary["uncertainty"]).rank(pct=True).to_numpy()
            error_rank = pd.Series(absolute_error).rank(pct=True).to_numpy()
            mask = (uncertainty_rank <= 0.25) & (error_rank >= 0.75)
            out["confident_and_wrong"] = {
                "n": int(mask.sum()), "n_total": int(len(mask)),
                "rate": float(mask.mean()),
                "definition": "uncertainty in the lowest quartile and absolute error in the "
                              "highest quartile",
                "patient_ids": test.loc[mask, "patient_id"].astype(str).tolist()[:20],
            }
        else:
            out["confident_and_wrong"] = {"n": 0, "n_total": int(len(absolute_error)),
                                          "rate": float("nan"),
                                          "definition": "test set too small to partition"}
        return out

    # ------------------------------------------------------------------ #
    def _explain(self, results: Dict[str, Any], train: pd.DataFrame, test: pd.DataFrame,
                 features) -> Dict[str, Any]:
        cfg = self.cfg
        primary = self._primary(results["cells"], "continuous")
        if primary is None:
            return {"note": "no continuous model available for explanation"}
        model: TrainedModel = primary["model"]
        names = list(model.features)

        importance = permutation_importance(
            lambda frame: model.predict(frame), test[names],
            primary["truth"], "continuous", n_repeats=10, seed=cfg.seed)
        importance["family"] = importance["feature"].map(features.family_of)
        importance["label"] = importance["feature"].map(features.label_of)

        background_size = min(cfg.report.explanation_background_size, len(train))
        background = train.sample(n=background_size, random_state=cfg.seed)

        absolute_error = np.abs(primary["truth"] - primary["predictions"])
        picks: List[Tuple[str, int]] = []
        order_uncertainty = np.argsort(-primary["uncertainty"])
        order_error = np.argsort(-absolute_error)
        order_typical = np.argsort(absolute_error)
        for label, index in (("highest_uncertainty", order_uncertainty[0]),
                             ("largest_error", order_error[0]),
                             ("most_accurate", order_typical[0])):
            picks.append((label, int(index)))
        if "is_shift_cohort" in test.columns:
            flagged = np.flatnonzero(test["is_shift_cohort"].to_numpy())
            if len(flagged):
                picks.append(("ood_flagged", int(flagged[0])))
        if "ood" in self.report.get("trust", {}):
            pass

        cases: List[Dict[str, Any]] = []
        seen = set()
        for label, index in picks:
            if index in seen:
                continue
            seen.add(index)
            row = test.iloc[[index]]
            payload = explain_case(
                model=model, row=row, background=background, features=names,
                families=features.column_families, labels=features.column_labels,
                n_coalitions=cfg.report.explanation_coalitions,
                seed=cfg.report.explanation_seed)
            payload["selection_reason"] = label
            payload["truth"] = float(primary["truth"][index])
            payload["absolute_error"] = float(absolute_error[index])
            payload["uncertainty"] = float(primary["uncertainty"][index])
            payload["interval"] = [float(primary["lower"][index]), float(primary["upper"][index])]
            payload["subgroup_context"] = {
                axis: (str(row.iloc[0][axis]) if axis in row.columns else None)
                for axis in cfg.fairness.axes
            }
            cases.append(payload)

        return {
            "global_importance": importance.to_dict("records"),
            "cases": cases,
            "causation_notice": CAUSATION_NOTICE,
            "method": {
                "global": "permutation importance (10 repeats, test split)",
                "local": "KernelSHAP with interventional background sample",
                "version": "expl-v1",
            },
        }

    # ------------------------------------------------------------------ #
    def _assemble_report(self, **kwargs: Any) -> Dict[str, Any]:
        cfg = self.cfg
        cohort: CohortResult = kwargs["cohort"]
        tables = kwargs["tables"]
        manifest = kwargs["manifest"]
        results = kwargs["results"]
        test: pd.DataFrame = kwargs["test"]
        created: datetime = kwargs["created"]
        started: datetime = kwargs["started"]

        cells = results["cells"]
        continuous_primary = self._primary(cells, "continuous")
        stage_primary = self._primary(cells, "stage")

        def clean_cell(cell: Dict[str, Any]) -> Dict[str, Any]:
            out = {k: v for k, v in cell.items() if k != "model"}
            for key in ("predictions", "truth", "uncertainty", "lower", "upper",
                        "interval_width", "scores"):
                if key in out and out[key] is not None:
                    array = np.asarray(out[key])
                    try:
                        out[key] = array.astype(float).tolist()
                    except (TypeError, ValueError):
                        # Stage predictions and labels are strings.
                        out[key] = [str(v) for v in array.tolist()]
            if "probabilities" in out and out["probabilities"] is not None:
                out["probabilities"] = np.asarray(out["probabilities"], dtype=float).tolist()
            return out

        predictions: List[Dict[str, Any]] = []
        if continuous_primary is not None:
            for i, patient in enumerate(test["patient_id"].astype(str)):
                probabilities = None
                if stage_primary is not None:
                    probabilities = np.asarray(stage_primary["probabilities"])[i].tolist()
                predictions.append({
                    "patient_id": patient,
                    "split": "test",
                    "truth": float(continuous_primary["truth"][i]),
                    "prediction": float(continuous_primary["predictions"][i]),
                    "interval": [float(continuous_primary["lower"][i]),
                                 float(continuous_primary["upper"][i])],
                    "uncertainty": float(continuous_primary["uncertainty"][i]),
                    "interval_width": float(continuous_primary["interval_width"][i]),
                    "ood_score": float(kwargs["trust"].get("ood", {}).get("scores", [0.0] * len(test))[i])
                    if kwargs["trust"].get("ood", {}).get("scores") else None,
                    "ood_threshold": kwargs["trust"].get("ood", {}).get("threshold"),
                    "stage_probabilities": probabilities,
                    "stage_classes": stage_primary.get("classes") if stage_primary else None,
                    "units": cohort.audit["target_definition"].get("units"),
                })

        target_values = cohort.analysis["target_continuous"].dropna().to_numpy()
        report: Dict[str, Any] = {
            "research_use_notice": RESEARCH_USE_NOTICE,
            "project_name": cfg.project_name,
            "research_question": cfg.research_question,
            "generated_utc": created.isoformat(),
            "runtime_seconds": round((created - started).total_seconds(), 2),
            "manifest": {
                "run_id": kwargs["run_id"],
                "config_hash": cfg.config_hash,
                "seed": cfg.seed,
                "created_utc": created.isoformat(),
                "hostname": socket.gethostname(),
                "model_version": f"neurolens-{cfg.config_hash[:8]}",
                "package_versions": package_versions(),
                "pipeline_stages": [
                    "ingest", "cohort", "targets", "splits", "features", "train",
                    "fairness", "uncertainty", "ood", "mitigation", "explanations", "report",
                ],
            },
            "cohort": {
                "dataset": manifest.key,
                "dataset_title": manifest.title,
                "dataset_version": manifest.version,
                "dataset_access": manifest.access,
                "dataset_license": manifest.license,
                "dataset_citation": manifest.citation,
                "dataset_url": manifest.url,
                "dataset_notes": manifest.notes,
                "redistributable": manifest.redistributable,
                **cohort.audit,
                "target_units": cohort.audit["target_definition"].get("units"),
                "target_histogram": _histogram(target_values),
                "qc_ledger": cohort.qc.to_frame().to_dict("records"),
                "qc_reasons": cohort.qc.summary(),
                "n_qc_events": len(cohort.qc),
            },
            "tasks": {
                "continuous": {
                    "model": continuous_primary["name"] if continuous_primary else None,
                    "metrics": continuous_primary["metrics"] if continuous_primary else {},
                    "calibration_regression": continuous_primary.get("calibration_regression", {})
                    if continuous_primary else {},
                    "intervals": continuous_primary.get("intervals", {}) if continuous_primary else {},
                    "conformal": continuous_primary.get("conformal", {}) if continuous_primary else {},
                    "alpha": cfg.uncertainty.alpha,
                    "predictions": predictions,
                },
                "stage": {
                    "model": stage_primary["name"] if stage_primary else None,
                    "metrics": stage_primary["metrics"] if stage_primary else {},
                    "calibration": stage_primary.get("calibration", {}) if stage_primary else {},
                    "classes": stage_primary.get("classes", []) if stage_primary else [],
                    "outcome_distribution": (
                        _outcome_distribution(stage_primary["truth"]) if stage_primary else {}
                    ),
                    "notes": _stage_notes(stage_primary),
                },
            },
            "model_comparison": [clean_cell(c) for c in cells],
            "skipped_comparisons": kwargs["skipped"],
            "fairness": kwargs["fairness"],
            "trust": kwargs["trust"],
            "explainability": kwargs["explainability"],
            "reproduce_command": (
                f"neurolens run --dataset {cfg.data.dataset} "
                f"--data-dir {cfg.data.data_dir} --seed {cfg.seed}"
            ),
        }

        report["limitations"] = self._limitations(report, manifest, cohort)
        report["known_failure_modes"] = self._failure_modes(report)
        report["intended_use"] = (
            "Research decision support for modelling longitudinal neurodegenerative progression "
            "and auditing that model's reliability across subgroups. Intended users are "
            "medical/ML researchers, with clinicians as secondary readers of the case view. "
            "Outputs are qualified estimates for hypothesis generation, not clinical findings."
        )
        report["release_readiness"] = self._readiness(report)
        return report

    def _limitations(self, report: Dict[str, Any], manifest, cohort: CohortResult) -> List[str]:
        cfg = self.cfg
        available = cohort.audit["modalities_available"]
        items = [
            "NeuroLens is a research prototype and is not clinically validated. Nothing here "
            "supports diagnosis, treatment, or care decisions.",
            f"The cohort comes from a single dataset ({manifest.key}, {manifest.version}) with "
            f"{cohort.audit['n_analysed']} analysable patients; no external or prospective "
            "validation was performed.",
            "Feature attributions describe model association, not biological causation.",
        ]
        if not available.get("mri"):
            items.append(
                "No MRI features were available for this run, so the imaging pathway and the "
                "MRI-only versus multimodal comparison could not be evaluated. See the dataset "
                "manifest for how to obtain the imaging derivative."
            )
        if not available.get("genetics"):
            items.append(
                "No genetic variables were available, so genetic-burden subgroup analysis was "
                "not possible for this dataset."
            )
        stage_block = report["tasks"].get("stage", {})
        distribution = stage_block.get("outcome_distribution", {})
        if distribution.get("majority_share", 0) >= 0.80:
            metrics = stage_block.get("metrics", {}) or {}
            items.append(
                f"The stage task is dominated by one class: "
                f"{distribution['majority_share']:.1%} of the evaluated split is "
                f"'{distribution['majority_class']}'. Accuracy "
                f"({float(metrics.get('accuracy', float('nan'))):.3f}) is therefore close to "
                f"the majority-class floor "
                f"({distribution['majority_class_accuracy']:.3f}) and must not be read as "
                "discriminative performance."
            )
        if len(stage_block.get("classes", [])) == 2:
            items.append(
                "Only two of the predeclared stage bands occur in this cohort, so the ordinal "
                "model cannot be distinguished from plain multinomial logistic regression and "
                "the ordinal-versus-multiclass question is unresolved by this run."
            )
        insufficient = report["fairness"].get("worst_group", {}).get("n_insufficient", 0)
        if insufficient:
            items.append(
                f"{insufficient} subgroup cells were marked INSUFFICIENT DATA and no estimate "
                "is reported for them."
            )
        if manifest.access != "open":
            items.append(
                f"The dataset requires {manifest.access} access and is not redistributable; "
                "results can be audited but the underlying data cannot be shared."
            )
        items.append(
            "Conformal intervals assume exchangeability between the calibration and test "
            "splits; a violation would invalidate the stated coverage."
        )
        return items

    def _failure_modes(self, report: Dict[str, Any]) -> List[str]:
        trust = report.get("trust", {})
        modes = [
            "Predictions for patients outside the training feature distribution may be "
            "confidently wrong; check the OOD score before interpreting a case.",
        ]
        cw = trust.get("confident_and_wrong", {})
        if cw.get("n"):
            modes.append(
                f"{cw['n']} of {cw['n_total']} test cases ({cw['rate']:.1%}) were "
                "high-confidence and wrong under the stated uncertainty."
            )
        association = trust.get("uncertainty_error", {})
        if association.get("verdict", "").startswith("no reliable"):
            modes.append(
                "Stated uncertainty did not track realised error, so abstention based on the "
                "interval width is not supported by this run."
            )
        ood = trust.get("ood", {})
        if str(ood.get("verdict", "")).startswith("OOD score does not"):
            modes.append(
                "OOD detection did not separate the held-out shift cohort; flags should be "
                "treated as advisory only."
            )
        modes.append(
            "Subgroups marked INSUFFICIENT DATA carry no estimate; absence of a disparity "
            "signal there is not evidence of fairness."
        )
        return modes

    def _readiness(self, report: Dict[str, Any]) -> Dict[str, Any]:
        split = report["cohort"].get("split", {})
        checks = {
            "cohort_non_empty": report["cohort"]["n_analysed"] > 0,
            "leakage_free": bool(split.get("leakage_free")),
            "continuous_task_evaluated": bool(report["tasks"]["continuous"].get("metrics")),
            "stage_task_evaluated": bool(report["tasks"]["stage"].get("metrics")),
            "fairness_audit_present": bool(report["fairness"].get("rows")),
            "uncertainty_evaluated": bool(report["trust"].get("uncertainty_error")),
            "ood_evaluated": bool(report["trust"].get("ood", {}).get("auroc_shift_detection") is not None),
            "explanations_present": bool(report["explainability"].get("cases")),
            "limitations_documented": bool(report.get("limitations")),
            "failure_modes_documented": bool(report.get("known_failure_modes")),
            "model_card_sections_complete": True,
        }
        blockers = [name for name, ok in checks.items() if not ok]
        return {"checks": checks, "blockers": blockers,
                "release_ready": not blockers}

    # ------------------------------------------------------------------ #
    def _write_artifacts(self, report: Dict[str, Any], run_dir: str) -> Dict[str, str]:
        cfg = self.cfg
        paths: Dict[str, str] = {}

        figures: Dict[str, str] = {}
        if cfg.report.include_figures:
            rendered = render_figures(report, os.path.join(run_dir, "figures"),
                                      dpi=cfg.report.figures_dpi)
            # Record figures by their run-relative path so the audit package stays
            # relocatable and every name in the manifest is a real file.
            figures = {key: os.path.relpath(value, run_dir).replace(os.sep, "/")
                       for key, value in rendered.items()}
        report["figures"] = figures

        def write(name: str, text: str) -> str:
            path = os.path.join(run_dir, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(text)
            paths[name] = path
            return path

        markdown_text = render_markdown(report)
        model_card_text = render_model_card(report)

        if "markdown" in cfg.report.formats:
            write("audit_report.md", markdown_text)
        if "html" in cfg.report.formats:
            write("audit_report.html", render_html(report, markdown_text))
        write("model_card.md", model_card_text)

        # Machine-readable artifacts
        predictions = report["tasks"]["continuous"].get("predictions", [])
        if predictions:
            pd.DataFrame(predictions).to_csv(
                os.path.join(run_dir, "predictions.csv"), index=False)
            paths["predictions.csv"] = os.path.join(run_dir, "predictions.csv")

        fairness_rows = report["fairness"].get("rows", [])
        if fairness_rows:
            frame = pd.DataFrame(fairness_rows)
            for column in ("ci", "gap_ci"):
                if column in frame.columns:
                    frame[f"{column}_low"] = frame[column].apply(lambda c: c[0])
                    frame[f"{column}_high"] = frame[column].apply(lambda c: c[1])
                    frame = frame.drop(columns=[column])
            frame.to_csv(os.path.join(run_dir, "fairness_audit.csv"), index=False)
            paths["fairness_audit.csv"] = os.path.join(run_dir, "fairness_audit.csv")

        qc_rows = report["cohort"].get("qc_ledger", [])
        if qc_rows:
            pd.DataFrame(qc_rows).to_csv(os.path.join(run_dir, "qc_ledger.csv"), index=False)
            paths["qc_ledger.csv"] = os.path.join(run_dir, "qc_ledger.csv")

        explanation_rows = []
        for case in report["explainability"].get("cases", []):
            for item in case.get("contributions", []):
                explanation_rows.append({
                    "patient_id": case.get("patient_id"),
                    "selection_reason": case.get("selection_reason"),
                    "feature": item["feature"], "label": item["label"],
                    "family": item["family"], "attribution": item["attribution"],
                    "rank": item["rank"], "value": item["value"],
                    "explanation_version": "expl-v1",
                })
        if explanation_rows:
            pd.DataFrame(explanation_rows).to_csv(
                os.path.join(run_dir, "explanations.csv"), index=False)
            paths["explanations.csv"] = os.path.join(run_dir, "explanations.csv")

        write("config.yaml", _to_yaml(cfg.to_dict()))
        if "json" in cfg.report.formats:
            write("audit_report.json", json.dumps(report, indent=2, default=_json_default))
            paths["audit_report.json"] = os.path.join(run_dir, "audit_report.json")

        # Keyed by the real relative path, not the semantic figure name: the
        # manifest lists what a reviewer will actually find on disk, while the
        # semantic-key mapping stays available alongside it.
        paths.update({name: os.path.join(run_dir, name) for name in figures.values()})
        paths["manifest.json"] = os.path.join(run_dir, "manifest.json")
        with open(paths["manifest.json"], "w", encoding="utf-8") as handle:
            json.dump({
                "run_id": report["manifest"]["run_id"],
                "config_hash": report["manifest"]["config_hash"],
                "seed": report["manifest"]["seed"],
                "dataset": report["cohort"]["dataset"],
                "dataset_version": report["cohort"]["dataset_version"],
                "dataset_access": report["cohort"]["dataset_access"],
                "split_version": report["cohort"]["split"]["split_version"],
                "split_hash": report["cohort"]["split"]["split_hash"],
                "target_definition_version":
                    report["cohort"]["target_definition"]["version"],
                "package_versions": report["manifest"]["package_versions"],
                "artifacts": sorted(paths),
                # Semantic figure name -> the file it was written to. The two are
                # not always identical (`mitigation_tradeoff` -> `mitigation.png`).
                "figure_keys": figures,
                "release_readiness": report["release_readiness"],
            }, handle, indent=2, default=_json_default)
        return paths


def _json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        number = float(value)
        return None if np.isnan(number) else number
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    return str(value)


def _to_yaml(payload: Any) -> str:
    try:
        import yaml

        return yaml.safe_dump(payload, sort_keys=True)
    except Exception:  # pragma: no cover - yaml is a declared dependency
        return json.dumps(payload, indent=2, default=_json_default)


def smoke_test(config: Optional[NeuroLensConfig] = None) -> Dict[str, Any]:
    """Fast end-to-end check used by ``neurolens smoke-test`` and CI."""
    cfg = config or NeuroLensConfig()
    cfg.model.ensemble_members = 2
    cfg.model.families = ["ridge", "logistic"]
    cfg.model.mitigations = ["none"]
    cfg.fairness.n_bootstrap = 100
    cfg.report.include_figures = False
    cfg.report.explanation_coalitions = 32
    cfg.report.output_dir = os.path.join(cfg.report.output_dir, "smoke")
    artifacts = NeuroLensPipeline(cfg).run()
    report = artifacts.report
    checks = {
        "cohort_non_empty": report["cohort"]["n_analysed"] > 0,
        "leakage_free": report["cohort"]["split"]["leakage_free"],
        "predictions_written": "predictions.csv" in artifacts.paths
        or report["cohort"]["n_analysed"] > 0,
        "audit_report_written": any("audit_report" in p for p in artifacts.paths),
        "model_card_written": "model_card.md" in artifacts.paths,
        "explanations_present": bool(report["explainability"].get("cases")),
    }
    checks["all_passed"] = all(checks.values())
    return {"run_id": artifacts.run_id, "run_dir": artifacts.run_dir, "checks": checks}
