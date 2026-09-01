#!/usr/bin/env python
"""Standalone smoke test for NeuroLens.

Runs the full pipeline in its fast configuration against real data and prints
what happened, so the result can be read without opening the UI. This is the
same code path as ``neurolens smoke-test``; it exists as a script so it can be
pasted into a Colab cell or wired into CI without installing the package.

Usage:
    python scripts/smoke_test.py
    python scripts/smoke_test.py --dataset openneuro-ds004856 --data-dir data/raw/ds004856

Exits non-zero if any verification check fails. No data is generated: if the
real participants table cannot be fetched, the script says so and fails.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from neurolens.config import NeuroLensConfig  # noqa: E402
from neurolens.pipeline import smoke_test  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=None, help="dataset manifest key")
    parser.add_argument("--data-dir", default=None, help="directory holding the real data")
    parser.add_argument("--output-dir", default=None, help="where to write the run")
    args = parser.parse_args()

    config = NeuroLensConfig()
    if args.dataset:
        config.data.dataset = args.dataset
    if args.data_dir:
        config.data.data_dir = args.data_dir
    if args.output_dir:
        config.report.output_dir = args.output_dir

    try:
        result = smoke_test(config)
    except FileNotFoundError as error:
        print(f"\nSmoke test could not start: {error}", file=sys.stderr)
        print("NeuroLens never generates stand-in data. Fetch the real dataset first "
              "with `neurolens fetch-data --dataset <key>`.", file=sys.stderr)
        return 2

    report_path = os.path.join(result["run_dir"], "audit_report.json")
    with open(report_path, "r", encoding="utf-8") as handle:
        report = json.load(handle)

    cohort = report["cohort"]
    print("\n" + "=" * 74)
    print("NeuroLens smoke test")
    print("=" * 74)
    print(f"run                 {result['run_id']}")
    print(f"dataset             {cohort['dataset']} ({cohort['dataset_access']}, "
          f"{cohort['dataset_license']})")
    print(f"cohort              {cohort['n_indexed']} indexed -> "
          f"{cohort['n_analysed']} analysed")
    print(f"split               {cohort['split']['counts']} "
          f"leakage_free={cohort['split']['leakage_free']} "
          f"hash={cohort['split']['split_hash']}")
    print(f"modalities          {cohort['modalities_available']}")
    print(f"target              {cohort['target_definition']['units']}")

    continuous = report["tasks"]["continuous"].get("metrics", {})
    if continuous:
        print(f"continuous MAE      {continuous['mae']:.4f} "
              f"95% CI [{continuous['mae_ci'][0]:.4f}, {continuous['mae_ci'][1]:.4f}] "
              f"(n={continuous['n']})")
    stage = report["tasks"]["stage"].get("metrics", {})
    if stage:
        distribution = report["tasks"]["stage"].get("outcome_distribution", {})
        print(f"stage macro-F1      {stage['macro_f1']:.4f}  "
              f"accuracy {stage['accuracy']:.4f}  "
              f"balanced accuracy {stage['balanced_accuracy']:.4f}")
        if distribution:
            print(f"stage classes       {distribution['counts']} "
                  f"({distribution['verdict']}; majority-class floor "
                  f"{distribution['majority_class_accuracy']:.3f})")

    trust = report["trust"]
    print(f"uncertainty/error   Spearman {trust['uncertainty_error']['spearman']:.3f} "
          f"-> {trust['uncertainty_error']['verdict']}")
    ood_auroc = trust["ood"]["auroc_shift_detection"]
    ood_text = "n/a" if ood_auroc is None else f"{float(ood_auroc):.3f}"
    print(f"OOD separation      AUROC {ood_text} -> {trust['ood']['verdict']}")
    print(f"confident & wrong   {trust['confident_and_wrong']['n']} of "
          f"{trust['confident_and_wrong']['n_total']} test cases")

    fairness = report["fairness"]
    counts: dict[str, int] = {}
    for row in fairness["rows"]:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    print(f"subgroup statuses   {counts}")
    print(f"worst group         {fairness['worst_group'].get('worst_group')} on "
          f"{fairness['worst_group'].get('worst_axis')} "
          f"(n={fairness['worst_group'].get('worst_n')})")

    readiness = report["release_readiness"]
    print(f"release             {'READY' if readiness['release_ready'] else 'BLOCKED'}")
    if readiness["blockers"]:
        for blocker in readiness["blockers"]:
            print(f"  blocker: {blocker}")
    print(f"run directory       {result['run_dir']}")
    print("=" * 74)

    print("\nVerification checks")
    for name, passed in result["checks"].items():
        if name == "all_passed":
            continue
        print(f"  [{'x' if passed else ' '}] {name}")

    print("\n" + report["research_use_notice"])
    return 0 if result["checks"]["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
