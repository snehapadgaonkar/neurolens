"""Audit report rendering: figures, Markdown, HTML, and the model card.

Outputs follow PRD F12 (audit report) and Appendix B (case-level research view).
Every metric block carries its sample size and interval; every subgroup row
carries its adequacy status; and the research-use notice appears at the top of
every document.
"""

from __future__ import annotations

import html
import json
import os
from typing import Any, Dict, List, Optional, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

__all__ = ["render_figures", "render_markdown", "render_html", "render_model_card"]

# Design tokens from DESIGN.md section 3 — the report and the UI share them.
INK_950 = "#17212B"
INK_700 = "#3B4A57"
INK_500 = "#687784"
PAPER_25 = "#F7F8F6"
SLATE_200 = "#D9E0E2"
TEAL_700 = "#146C70"
AMBER_700 = "#9A5B00"
CRIMSON_700 = "#A43D45"
VIOLET_700 = "#5B4B8A"
BLUE_700 = "#2E5E8C"
OLIVE_700 = "#5D6D2D"

FAMILY_COLORS = {
    "mri": BLUE_700, "genetics": VIOLET_700,
    "clinical": OLIVE_700, "demographic": INK_700, "other": INK_500,
}
STATUS_COLORS = {"PASS": TEAL_700, "WARN": AMBER_700, "INSUFFICIENT DATA": CRIMSON_700}


def _style(axis) -> None:
    axis.spines[["top", "right"]].set_visible(False)
    axis.spines[["left", "bottom"]].set_color(SLATE_200)
    axis.tick_params(colors=INK_700, labelsize=8)
    for label in axis.get_xticklabels() + axis.get_yticklabels():
        label.set_color(INK_700)
    axis.grid(axis="y", color=SLATE_200, linewidth=0.6, alpha=0.7)
    axis.set_axisbelow(True)


def _save(fig, path: str, dpi: int) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def _fmt(value: Any, digits: int = 3) -> str:
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if np.isnan(number):
        return "—"
    return f"{number:.{digits}f}"


def _ci(value: Any, ci_value: Any, digits: int = 3) -> str:
    point = _fmt(value, digits)
    if not ci_value or len(ci_value) != 2:
        return point
    low, high = ci_value
    if low is None or (isinstance(low, float) and np.isnan(low)):
        return point
    return f"{point} [{_fmt(low, digits)}, {_fmt(high, digits)}]"


# --------------------------------------------------------------------------- #
# Figures
# --------------------------------------------------------------------------- #
def render_figures(report: Dict[str, Any], out_dir: str, dpi: int = 150) -> Dict[str, str]:
    figures: Dict[str, str] = {}

    # 1. Predicted vs observed (continuous headline) ----------------------- #
    continuous = report.get("tasks", {}).get("continuous", {})
    cases = continuous.get("predictions", [])
    if cases:
        fig, axis = plt.subplots(figsize=(4.4, 4.0))
        truth = [c["truth"] for c in cases]
        predicted = [c["prediction"] for c in cases]
        lower = [c["interval"][0] for c in cases]
        upper = [c["interval"][1] for c in cases]
        axis.vlines(truth, lower, upper, color=SLATE_200, linewidth=1.0,
                    label=f"{100*(1-continuous.get('alpha', 0.1)):.0f}% interval")
        axis.scatter(truth, predicted, s=18, color=TEAL_700, alpha=0.85,
                     edgecolor="white", linewidth=0.4, label="prediction")
        lo = min(min(truth), min(lower))
        hi = max(max(truth), max(upper))
        axis.plot([lo, hi], [lo, hi], color=INK_500, linewidth=1.0, linestyle="--",
                  label="identity")
        axis.set_xlabel("Observed progression")
        axis.set_ylabel("Predicted progression")
        axis.set_title("Continuous progression: predicted vs observed",
                       fontsize=10, color=INK_950)
        axis.legend(fontsize=7, frameon=False)
        _style(axis)
        figures["predicted_vs_observed"] = _save(
            fig, os.path.join(out_dir, "predicted_vs_observed.png"), dpi)

    # 2. Subgroup error gaps with CIs -------------------------------------- #
    fairness_rows = report.get("fairness", {}).get("rows", [])
    reportable = [row for row in fairness_rows if row["status"] != "INSUFFICIENT DATA"]
    if reportable:
        frame = pd.DataFrame(reportable).sort_values("gap")
        frame = frame[frame["axis"] == frame["axis"].iloc[0]] if frame["axis"].nunique() else frame
        fig, axis = plt.subplots(figsize=(5.6, max(2.4, 0.32 * len(frame))))
        colours = [STATUS_COLORS.get(status, INK_500) for status in frame["status"]]
        axis.barh(range(len(frame)), frame["gap"], color=colours, alpha=0.85, height=0.62)
        errors = np.vstack([
            frame["gap"] - frame["gap_ci"].apply(lambda c: c[0]),
            frame["gap_ci"].apply(lambda c: c[1]) - frame["gap"],
        ])
        axis.errorbar(frame["gap"], range(len(frame)), xerr=np.abs(errors), fmt="none",
                      ecolor=INK_700, elinewidth=0.9, capsize=2)
        axis.set_yticks(range(len(frame)))
        axis.set_yticklabels([f"{row['subgroup']} (n={row['n']})" for row in frame.to_dict("records")],
                             fontsize=7)
        axis.axvline(0, color=INK_500, linewidth=0.9)
        axis.set_xlabel(f"Error gap vs reference ({frame['axis'].iloc[0]} axis)")
        axis.set_title("Subgroup error gaps with 95% CI", fontsize=10, color=INK_950)
        axis.grid(axis="x", color=SLATE_200, linewidth=0.6)
        axis.grid(axis="y", visible=False)
        _style(axis)
        figures["subgroup_gaps"] = _save(fig, os.path.join(out_dir, "subgroup_gaps.png"), dpi)

    # 3. Reliability / calibration ----------------------------------------- #
    calibration = continuous.get("calibration") or {}
    reliability = calibration.get("reliability") if isinstance(calibration, dict) else None
    if reliability:
        fig, axis = plt.subplots(figsize=(4.2, 3.8))
        bins = [item["bin"] for item in reliability]
        axis.bar(range(len(bins)), [item["accuracy"] for item in reliability],
                 color=TEAL_700, alpha=0.75, label="observed accuracy")
        axis.plot(range(len(bins)), [item["confidence"] for item in reliability],
                  color=CRIMSON_700, marker="o", markersize=4, linewidth=1.2,
                  label="mean confidence")
        axis.set_xticks(range(len(bins)))
        axis.set_xticklabels(bins, rotation=45, ha="right", fontsize=6)
        axis.set_xlabel("Confidence bin")
        axis.set_ylabel("Accuracy / confidence")
        axis.set_title(f"Reliability (ECE {_fmt(calibration.get('ece'))})", fontsize=10,
                       color=INK_950)
        axis.legend(fontsize=7, frameon=False)
        _style(axis)
        figures["reliability"] = _save(fig, os.path.join(out_dir, "reliability.png"), dpi)

    # 4. Risk–coverage (selective prediction) ------------------------------ #
    risk = report.get("trust", {}).get("risk_coverage", {})
    curve = risk.get("curve", [])
    if curve:
        fig, axis = plt.subplots(figsize=(4.4, 3.6))
        axis.plot([p["abstention_fraction"] for p in curve], [p["mae"] for p in curve],
                  color=TEAL_700, marker="o", markersize=3.5, linewidth=1.4)
        axis.axhline(risk.get("mae_full", np.nan), color=INK_500, linestyle="--",
                     linewidth=1.0, label="no abstention")
        axis.set_xlabel("Fraction abstained (highest uncertainty first)")
        axis.set_ylabel("MAE on retained cases")
        axis.set_title(f"Risk–coverage (AURC {_fmt(risk.get('aurc'))})", fontsize=10,
                       color=INK_950)
        axis.legend(fontsize=7, frameon=False)
        _style(axis)
        figures["risk_coverage"] = _save(fig, os.path.join(out_dir, "risk_coverage.png"), dpi)

    # 5. OOD score distribution ------------------------------------------- #
    ood = report.get("trust", {}).get("ood", {})
    histogram = ood.get("score_histogram")
    if histogram:
        fig, axis = plt.subplots(figsize=(4.4, 3.4))
        centres = histogram["bin_centres"]
        axis.bar([c - histogram["bin_width"] / 2 for c in centres], histogram["in_distribution"],
                 width=histogram["bin_width"], color=TEAL_700, alpha=0.8,
                 label="in distribution")
        axis.bar([c + histogram["bin_width"] / 2 for c in centres], histogram["shift"],
                 width=histogram["bin_width"], color=CRIMSON_700, alpha=0.8,
                 label="shift cohort")
        if ood.get("threshold") is not None:
            axis.axvline(ood["threshold"], color=INK_950, linestyle="--", linewidth=1.0,
                         label="flag threshold")
        axis.set_xlabel("OOD score (training percentile)")
        axis.set_ylabel("Cases")
        axis.set_title(f"OOD score (AUROC {_fmt(ood.get('auroc_shift_detection'), 2)})",
                       fontsize=10, color=INK_950)
        axis.legend(fontsize=7, frameon=False)
        _style(axis)
        figures["ood_scores"] = _save(fig, os.path.join(out_dir, "ood_scores.png"), dpi)

    # 6. Global feature importance ---------------------------------------- #
    importance = report.get("explainability", {}).get("global_importance", [])
    if importance:
        top = importance[:15][::-1]
        fig, axis = plt.subplots(figsize=(5.4, max(2.6, 0.28 * len(top))))
        colours = [FAMILY_COLORS.get(item.get("family", "other"), INK_500) for item in top]
        axis.barh(range(len(top)), [item["importance"] for item in top], color=colours,
                  alpha=0.85, height=0.65)
        axis.set_yticks(range(len(top)))
        axis.set_yticklabels([item.get("label", item["feature"]) for item in top], fontsize=7)
        axis.set_xlabel(f"Δ {top[0].get('metric', 'score')} when permuted")
        axis.set_title("Global permutation importance", fontsize=10, color=INK_950)
        _style(axis)
        figures["global_importance"] = _save(fig, os.path.join(out_dir, "global_importance.png"), dpi)

    # 7. Representative case attribution ---------------------------------- #
    case = (report.get("explainability", {}).get("cases") or [{}])[0]
    contributions = case.get("top", [])
    if contributions:
        items = contributions[::-1]
        fig, axis = plt.subplots(figsize=(5.4, max(2.6, 0.3 * len(items))))
        colours = [FAMILY_COLORS.get(item["family"], INK_500) for item in items]
        axis.barh(range(len(items)), [item["attribution"] for item in items], color=colours,
                  alpha=0.85, height=0.62)
        axis.set_yticks(range(len(items)))
        axis.set_yticklabels([item["label"] for item in items], fontsize=7)
        axis.axvline(0, color=INK_950, linewidth=0.9)
        axis.set_xlabel("SHAP attribution")
        axis.set_title(f"Case {case.get('patient_id', '')}: top contributors",
                       fontsize=10, color=INK_950)
        _style(axis)
        figures["case_attribution"] = _save(fig, os.path.join(out_dir, "case_attribution.png"), dpi)

    # 8. Mitigation trade-off --------------------------------------------- #
    mitigation = report.get("fairness", {}).get("mitigation_comparison", [])
    if len(mitigation) > 1:
        fig, axis = plt.subplots(figsize=(4.6, 3.6))
        axis.scatter([m["overall"] for m in mitigation], [m["worst_group"] for m in mitigation],
                     s=40, color=TEAL_700, alpha=0.85, edgecolor="white")
        for item in mitigation:
            axis.annotate(item.get("mitigation", ""), (item["overall"], item["worst_group"]),
                          textcoords="offset points", xytext=(5, 3), fontsize=7, color=INK_700)
        axis.set_xlabel("Overall error")
        axis.set_ylabel("Worst-group error")
        axis.set_title("Fairness mitigation trade-off", fontsize=10, color=INK_950)
        _style(axis)
        figures["mitigation_tradeoff"] = _save(fig, os.path.join(out_dir, "mitigation.png"), dpi)

    # 9. Target distribution ---------------------------------------------- #
    distribution = report.get("cohort", {}).get("target_histogram")
    if distribution:
        fig, axis = plt.subplots(figsize=(4.4, 3.2))
        axis.bar(distribution["bin_centres"], distribution["counts"],
                 width=distribution["bin_width"], color=BLUE_700, alpha=0.85)
        axis.set_xlabel(report.get("cohort", {}).get("target_units", "target"))
        axis.set_ylabel("Patients")
        axis.set_title("Continuous target distribution", fontsize=10, color=INK_950)
        _style(axis)
        figures["target_distribution"] = _save(fig, os.path.join(out_dir, "target.png"), dpi)

    return figures


# --------------------------------------------------------------------------- #
# Markdown / HTML
# --------------------------------------------------------------------------- #
def _metric_table(rows: Sequence[Dict[str, Any]], columns: Sequence[str]) -> str:
    if not rows:
        return "_No rows._\n"
    header = "| " + " | ".join(columns) + " |\n"
    header += "|" + "|".join(["---"] * len(columns)) + "|\n"
    body = ""
    for row in rows:
        body += "| " + " | ".join(str(row.get(column, "—")) for column in columns) + " |\n"
    return header + body


def render_markdown(report: Dict[str, Any]) -> str:
    notice = report.get("research_use_notice", "")
    manifest = report.get("manifest", {})
    cohort = report.get("cohort", {})
    split = cohort.get("split", {})
    continuous = report.get("tasks", {}).get("continuous", {})
    stage = report.get("tasks", {}).get("stage", {})
    fairness = report.get("fairness", {})
    trust = report.get("trust", {})
    explain = report.get("explainability", {})

    out: List[str] = []
    out.append(f"# NeuroLens audit report — {report.get('project_name', '')}\n")
    out.append(f"> **{notice}**\n")
    out.append("## Provenance\n")
    out.append(_metric_table([{
        "run_id": manifest.get("run_id"),
        "dataset": cohort.get("dataset"),
        "dataset_version": cohort.get("dataset_version"),
        "dataset_access": cohort.get("dataset_access"),
        "target_version": cohort.get("target_definition", {}).get("version"),
        "split_version": split.get("split_version"),
        "split_hash": split.get("split_hash"),
        "seed": manifest.get("seed"),
        "config_hash": manifest.get("config_hash"),
    }], ["run_id", "dataset", "dataset_version", "dataset_access", "target_version",
          "split_version", "split_hash", "seed", "config_hash"]))

    out.append("\n## 1. Cohort\n")
    out.append(_metric_table([{
        "indexed": cohort.get("n_indexed"),
        "analysed": cohort.get("n_analysed"),
        "excluded": cohort.get("n_excluded"),
        "imaging": cohort.get("modalities_available", {}).get("mri"),
        "genetics": cohort.get("modalities_available", {}).get("genetics"),
        "clinical": cohort.get("modalities_available", {}).get("clinical"),
    }], ["indexed", "analysed", "excluded", "imaging", "genetics", "clinical"]))
    out.append(f"\n**Exclusion reasons:** {json.dumps(cohort.get('exclusion_reasons', {}))}\n")
    out.append(f"\n**Target:** {cohort.get('target_definition', {}).get('outcome_measure')} "
               f"{cohort.get('target_definition', {}).get('index_session')} → "
               f"{cohort.get('target_definition', {}).get('outcome_session')}, "
               f"units: {cohort.get('target_definition', {}).get('units')}\n")
    distribution = cohort.get("target_distribution", {})
    out.append(f"\n**Target distribution:** n={distribution.get('n')}, "
               f"mean={_fmt(distribution.get('mean'))}, sd={_fmt(distribution.get('sd'))}, "
               f"range [{_fmt(distribution.get('min'))}, {_fmt(distribution.get('max'))}]\n")
    out.append(f"\n**Stage distribution:** {json.dumps(cohort.get('stage_distribution', {}))}\n")

    out.append("\n### Leakage check\n")
    out.append(_metric_table([{
        "overlap_train_validation": split.get("patient_overlap", {}).get("train∩validation"),
        "overlap_train_test": split.get("patient_overlap", {}).get("train∩test"),
        "overlap_validation_test": split.get("patient_overlap", {}).get("validation∩test"),
        "leakage_free": split.get("leakage_free"),
    }], ["overlap_train_validation", "overlap_train_test", "overlap_validation_test",
          "leakage_free"]))

    out.append("\n## 2. Continuous progression\n")
    metrics = continuous.get("metrics", {})
    out.append(_metric_table([{
        "n": metrics.get("n"),
        "mae": _ci(metrics.get("mae"), metrics.get("mae_ci")),
        "rmse": _ci(metrics.get("rmse"), metrics.get("rmse_ci")),
        "r2": _fmt(metrics.get("r2")),
        "bias": _fmt(metrics.get("bias")),
    }], ["n", "mae", "rmse", "r2", "bias"]))
    calibration = continuous.get("calibration_regression", {})
    out.append(f"\n**Calibration:** slope {_fmt(calibration.get('slope'))}, "
               f"intercept {_fmt(calibration.get('intercept'))} — {calibration.get('interpretation')}\n")
    intervals = continuous.get("intervals", {})
    out.append(f"\n**Interval coverage:** target {intervals.get('target_coverage')}, "
               f"observed {_fmt(intervals.get('picp'))} (n={intervals.get('n')}), "
               f"mean width {_fmt(intervals.get('mean_interval_width'))}, "
               f"Winkler {_fmt(intervals.get('winkler_score'))}\n")

    out.append("\n## 3. Disease stage\n")
    stage_metrics = stage.get("metrics", {})
    out.append(_metric_table([{
        "n": stage_metrics.get("n"),
        "macro_f1": _fmt(stage_metrics.get("macro_f1")),
        "balanced_accuracy": _fmt(stage_metrics.get("balanced_accuracy")),
        "auroc_ovr": _fmt(stage_metrics.get("auroc_ovr_macro")),
        "accuracy_not_primary": _fmt(stage_metrics.get("accuracy")),
    }], ["n", "macro_f1", "balanced_accuracy", "auroc_ovr", "accuracy_not_primary"]))
    out.append("\n" + _metric_table(
        [{"class": k, **{kk: _fmt(vv, 3) if isinstance(vv, float) else vv
                         for kk, vv in v.items()}}
         for k, v in (stage_metrics.get("per_class") or {}).items()],
        ["class", "support", "predicted", "precision", "recall", "f1"]))

    out.append("\n## 4. Fairness audit\n")
    rows = []
    for row in fairness.get("rows", []):
        rows.append({
            "axis": row["axis"], "subgroup": row["subgroup"], "n": row["n"],
            "estimate": _fmt(row["estimate"]), "ci": f"[{_fmt(row['ci'][0])}, {_fmt(row['ci'][1])}]",
            "gap": _fmt(row["gap"]), "gap_ci": f"[{_fmt(row['gap_ci'][0])}, {_fmt(row['gap_ci'][1])}]",
            "relative_gap": _fmt(row["relative_gap"]),
            "adequacy": row["adequacy"], "status": row["status"],
        })
    out.append(_metric_table(rows, ["axis", "subgroup", "n", "estimate", "ci", "gap",
                                    "gap_ci", "relative_gap", "adequacy", "status"]))
    worst = fairness.get("worst_group", {})
    out.append(f"\n**Worst group:** {worst.get('worst_group')} on axis "
               f"{worst.get('worst_axis')} — {_fmt(worst.get('worst_estimate'))} "
               f"(n={worst.get('worst_n')}); spread vs best {_fmt(worst.get('spread'))}\n")
    out.append(f"\n**Preferred model:** {fairness.get('preferred_model')} — "
               f"{fairness.get('preferred_rationale')}\n")

    out.append("\n## 5. Reliability, uncertainty and OOD\n")
    association = trust.get("uncertainty_error", {})
    out.append(f"\n**Uncertainty vs error:** Spearman ρ {_fmt(association.get('spearman'))} "
               f"(p={_fmt(association.get('p_value'))}, n={association.get('n')}) — "
               f"{association.get('verdict')}\n")
    ood = trust.get("ood", {})
    out.append(f"\n**OOD:** AUROC {ood.get('auroc_shift_detection', '—')}, "
               f"flagged {ood.get('n_flagged_shift')} of {ood.get('n')} — {ood.get('verdict')}\n")
    failures = trust.get("confident_and_wrong", {})
    out.append(f"\n**High-confidence but wrong:** {failures.get('n')} of "
               f"{failures.get('n_total')} cases ({failures.get('rate')})\n")

    out.append("\n## 6. Explainability\n")
    out.append(_metric_table(
        [{"feature": item.get("label", item["feature"]), "family": item.get("family"),
          "importance": _fmt(item["importance"])}
         for item in explain.get("global_importance", [])[:12]],
        ["feature", "family", "importance"]))
    for case in explain.get("cases", [])[:3]:
        out.append(f"\n### Case {case.get('patient_id')}\n")
        out.append(f"Prediction {_fmt(case.get('prediction'))}; base {_fmt(case.get('base_value'))}; "
                   f"explanation residual {_fmt(case.get('residual'))} "
                   f"({_fmt(case.get('residual_fraction'), 3)} of prediction).\n")
        out.append(_metric_table(
            [{"contributor": item["label"], "family": item["family"],
              "value": _fmt(item["value"], 2), "attribution": _fmt(item["attribution"]),
              "direction": item["direction"]}
             for item in case.get("top", [])],
            ["contributor", "family", "value", "attribution", "direction"]))
    out.append(f"\n> {explain.get('causation_notice', '')}\n")

    out.append("\n## 7. Limitations and known failure modes\n")
    for item in report.get("limitations", []):
        out.append(f"- {item}")
    out.append("\n## 8. Reproduction\n")
    out.append("```bash\n" + report.get("reproduce_command", "") + "\n```\n")
    out.append(f"\nPackage versions: {json.dumps(manifest.get('package_versions', {}))}\n")
    return "\n".join(out)


def render_html(report: Dict[str, Any], markdown_text: str) -> str:
    """Render a self-contained HTML audit report using the DESIGN.md tokens."""
    body = _markdown_to_html(markdown_text)
    figures = report.get("figures", {})
    gallery = "".join(
        f'<figure><img src="{html.escape(os.path.basename(path))}" alt="{html.escape(name)}">'
        f"<figcaption>{html.escape(name.replace('_', ' '))}</figcaption></figure>"
        for name, path in figures.items()
    )
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NeuroLens audit report — {html.escape(str(report.get('project_name', '')))}</title>
<style>
:root {{
  --ink-950:{INK_950}; --ink-700:{INK_700}; --ink-500:{INK_500};
  --paper-0:#FFFFFF; --paper-25:{PAPER_25}; --paper-100:#EDF0ED; --slate-200:{SLATE_200};
  --teal-700:{TEAL_700}; --teal-100:#D9EFEC; --amber-700:{AMBER_700}; --amber-100:#FFF0D1;
  --crimson-700:{CRIMSON_700}; --crimson-100:#F8DFE1;
  --violet-700:{VIOLET_700}; --blue-700:{BLUE_700}; --olive-700:{OLIVE_700};
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--paper-25); color:var(--ink-950);
  font-family:"IBM Plex Sans","Segoe UI",system-ui,sans-serif; font-size:14px; line-height:21px; }}
main {{ max-width:1100px; margin:0 auto; padding:48px 24px 96px; }}
h1 {{ font-size:32px; line-height:38px; margin:0 0 16px; }}
h2 {{ font-size:20px; line-height:26px; margin:32px 0 12px; padding-bottom:6px;
  border-bottom:1px solid var(--slate-200); }}
h3 {{ font-size:16px; line-height:22px; margin:24px 0 8px; }}
blockquote {{ margin:0 0 24px; padding:12px 16px; background:var(--amber-100);
  border-left:3px solid var(--amber-700); border-radius:4px; color:var(--ink-950); }}
blockquote p {{ margin:0; }}
table {{ border-collapse:collapse; width:100%; background:var(--paper-0);
  border:1px solid var(--slate-200); border-radius:6px; overflow:hidden; margin:12px 0 20px; }}
th, td {{ padding:8px 12px; text-align:left; font-size:12px; line-height:18px;
  border-bottom:1px solid var(--paper-100); }}
th {{ background:var(--paper-100); font-size:11px; text-transform:uppercase;
  letter-spacing:.04em; color:var(--ink-700); }}
tr:nth-child(even) td {{ background:#FCFDFB; }}
code, pre {{ font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:12px; line-height:18px; }}
pre {{ background:var(--paper-0); border:1px solid var(--slate-200); border-radius:6px;
  padding:12px; overflow-x:auto; }}
figure {{ margin:0 0 20px; background:var(--paper-0); border:1px solid var(--slate-200);
  border-radius:6px; padding:12px; }}
figure img {{ max-width:100%; height:auto; display:block; }}
figcaption {{ font-size:12px; color:var(--ink-500); margin-top:8px; }}
.gallery {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:16px; }}
.provenance {{ font-family:"IBM Plex Mono",monospace; font-size:12px; color:var(--ink-700);
  background:var(--paper-0); border:1px solid var(--slate-200); border-radius:6px;
  padding:12px 16px; margin-bottom:24px; }}
</style></head><body><main>
<div class="provenance">run {html.escape(str(report.get('manifest', {}).get('run_id', '')))}
 · dataset {html.escape(str(report.get('cohort', {}).get('dataset', '')))}
 · split {html.escape(str(report.get('cohort', {}).get('split', {}).get('split_hash', '')))}
 · config {html.escape(str(report.get('manifest', {}).get('config_hash', '')))}</div>
{body}
<h2>Figures</h2><div class="gallery">{gallery or '<p>No figures were generated.</p>'}</div>
</main></body></html>"""


def _markdown_to_html(text: str) -> str:
    """Small dependency-free Markdown subset renderer (headings, tables, lists,
    blockquotes, code fences, inline code/emphasis)."""
    lines = text.split("\n")
    out: List[str] = []
    in_code = False
    in_table = False
    in_list = False

    def inline(value: str) -> str:
        value = html.escape(value)
        value = value.replace("`", "&#96;")
        import re as _re
        value = _re.sub(r"&#96;([^&]+)&#96;", r"<code>\1</code>", value)
        value = _re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
        return value

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            out.append("</code></pre>" if in_code else "<pre><code>")
            in_code = not in_code
            continue
        if in_code:
            out.append(html.escape(line))
            continue
        if stripped.startswith("|"):
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            if set("".join(cells)) <= {"-", ":", " "}:
                continue
            if not in_table:
                out.append("<table>")
                tag = "th"
                in_table = True
            else:
                tag = "td"
            out.append("<tr>" + "".join(f"<{tag}>{inline(c)}</{tag}>" for c in cells) + "</tr>")
            continue
        if in_table:
            out.append("</table>")
            in_table = False
        if stripped.startswith("# "):
            out.append(f"<h1>{inline(stripped[2:])}</h1>")
        elif stripped.startswith("## "):
            out.append(f"<h2>{inline(stripped[3:])}</h2>")
        elif stripped.startswith("### "):
            out.append(f"<h3>{inline(stripped[4:])}</h3>")
        elif stripped.startswith("> "):
            out.append(f"<blockquote><p>{inline(stripped[2:])}</p></blockquote>")
        elif stripped.startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{inline(stripped[2:])}</li>")
        elif stripped == "":
            if in_list:
                out.append("</ul>")
                in_list = False
        else:
            if in_list:
                out.append("</ul>")
                in_list = False
            out.append(f"<p>{inline(stripped)}</p>")
    if in_table:
        out.append("</table>")
    if in_list:
        out.append("</ul>")
    if in_code:
        out.append("</code></pre>")
    return "\n".join(out)


def render_model_card(report: Dict[str, Any]) -> str:
    manifest = report.get("manifest", {})
    cohort = report.get("cohort", {})
    continuous = report.get("tasks", {}).get("continuous", {})
    stage = report.get("tasks", {}).get("stage", {})
    fairness = report.get("fairness", {})
    trust = report.get("trust", {})
    metrics = continuous.get("metrics", {})
    stage_metrics = stage.get("metrics", {})

    lines = [
        "# Model card — NeuroLens",
        "",
        f"> {report.get('research_use_notice', '')}",
        "",
        "## Model details",
        "",
        f"- **Model version:** `{manifest.get('model_version')}`",
        f"- **Run ID:** `{manifest.get('run_id')}`",
        f"- **Config hash:** `{manifest.get('config_hash')}`",
        f"- **Seed:** `{manifest.get('seed')}`",
        f"- **Trained:** {manifest.get('created_utc')}",
        f"- **Primary task:** continuous progression — "
        f"{cohort.get('target_definition', {}).get('units', 'n/a')}",
        f"- **Secondary task:** disease stage — "
        f"{cohort.get('target_definition', {}).get('stage_definition', 'n/a')}",
        "",
        "## Intended use",
        "",
        report.get("intended_use", ""),
        "",
        "## Out of scope",
        "",
        "- Diagnosis of any disease.",
        "- Treatment, medication, or care recommendations.",
        "- Replacement of clinician judgement.",
        "- Deployment as a hospital production system.",
        "- Causal claims about any feature or biomarker.",
        "",
        "## Training scope",
        "",
        f"- **Dataset:** {cohort.get('dataset')} ({cohort.get('dataset_version')})",
        f"- **Access tier:** {cohort.get('dataset_access')}",
        f"- **License:** {cohort.get('dataset_license')}",
        f"- **Citation:** {cohort.get('dataset_citation')}",
        f"- **Patients analysed:** {cohort.get('n_analysed')} "
        f"(from {cohort.get('n_indexed')} indexed)",
        f"- **Modalities present:** {json.dumps(cohort.get('modalities_available', {}))}",
        f"- **Split:** {json.dumps(cohort.get('split', {}).get('counts', {}))} — "
        f"hash `{cohort.get('split', {}).get('split_hash')}`",
        f"- **Leakage-free:** {cohort.get('split', {}).get('leakage_free')}",
        "",
        "## Evaluation",
        "",
        f"- **Continuous:** n={metrics.get('n')}, MAE {_fmt(metrics.get('mae'))} "
        f"[{_fmt((metrics.get('mae_ci') or [None])[0])}, "
        f"{_fmt((metrics.get('mae_ci') or [None, None])[1])}], "
        f"RMSE {_fmt(metrics.get('rmse'))}, R² {_fmt(metrics.get('r2'))}",
        f"- **Stage:** macro-F1 {_fmt(stage_metrics.get('macro_f1'))}, "
        f"balanced accuracy {_fmt(stage_metrics.get('balanced_accuracy'))}, "
        f"AUROC(OvR) {_fmt(stage_metrics.get('auroc_ovr_macro'))}",
        f"- **Coverage:** observed {_fmt(continuous.get('intervals', {}).get('picp'))} "
        f"vs target {continuous.get('intervals', {}).get('target_coverage')}",
        f"- **Uncertainty–error association:** "
        f"{trust.get('uncertainty_error', {}).get('verdict')}",
        f"- **OOD detection:** {trust.get('ood', {}).get('verdict')}",
        "",
        "## Subgroup performance",
        "",
        f"- **Worst group:** {fairness.get('worst_group', {}).get('worst_group')} "
        f"(n={fairness.get('worst_group', {}).get('worst_n')}) at "
        f"{_fmt(fairness.get('worst_group', {}).get('worst_estimate'))}",
        f"- **Preferred configuration:** {fairness.get('preferred_model')}",
        f"- **Selection rationale:** {fairness.get('preferred_rationale')}",
        f"- **Subgroups marked INSUFFICIENT DATA:** "
        f"{fairness.get('worst_group', {}).get('n_insufficient')}",
        "",
        "## Known failure modes",
        "",
    ]
    for item in report.get("known_failure_modes", []):
        lines.append(f"- {item}")
    lines += [
        "",
        "## Limitations",
        "",
    ]
    for item in report.get("limitations", []):
        lines.append(f"- {item}")
    lines += [
        "",
        "## Reproduction",
        "",
        "```bash",
        report.get("reproduce_command", ""),
        "```",
        "",
        f"Package versions: `{json.dumps(manifest.get('package_versions', {}))}`",
        "",
    ]
    return "\n".join(lines)
