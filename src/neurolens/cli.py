"""NeuroLens command-line interface."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

from neurolens import RESEARCH_USE_NOTICE, __version__
from neurolens.config import NeuroLensConfig, config_from_dict
from neurolens.datasets import MANIFESTS, fetch_openneuro_tabular, resolve_manifest

__all__ = ["main", "build_parser"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="neurolens",
        description="Auditable AI for neurodegenerative disease progression.",
        epilog=RESEARCH_USE_NOTICE,
    )
    parser.add_argument("--version", action="version", version=f"neurolens {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    listing = sub.add_parser("datasets", help="list registered real-dataset manifests")
    listing.add_argument("--json", action="store_true", help="emit JSON")

    fetch = sub.add_parser("fetch-data", help="download a dataset's open tabular metadata")
    fetch.add_argument("--dataset", required=True)
    fetch.add_argument("--data-dir", default=None)

    run = sub.add_parser("run", help="run the full audit pipeline")
    run.add_argument("--config", default=None, help="YAML or JSON config file")
    run.add_argument("--dataset", default=None)
    run.add_argument("--data-dir", default=None)
    run.add_argument("--seed", type=int, default=None)
    run.add_argument("--output-dir", default=None)
    run.add_argument("--no-figures", action="store_true")
    run.add_argument("--quiet", action="store_true")

    report = sub.add_parser("report", help="re-render reports for an existing run")
    report.add_argument("run_dir")

    card = sub.add_parser("model-card", help="print the model card for an existing run")
    card.add_argument("run_dir")

    serve = sub.add_parser("serve", help="serve the evidence workspace UI")
    serve.add_argument("--run-dir", default=None, help="run to display (default: newest)")
    serve.add_argument("--runs-root", default="runs")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)

    smoke = sub.add_parser("smoke-test", help="fast end-to-end verification")
    smoke.add_argument("--dataset", default=None)
    smoke.add_argument("--data-dir", default=None)
    return parser


def _load_config(args: argparse.Namespace) -> NeuroLensConfig:
    config_path = getattr(args, "config", None)
    if config_path:
        if config_path.endswith((".yaml", ".yml")):
            config = NeuroLensConfig.from_yaml(config_path)
        else:
            config = NeuroLensConfig.from_json(config_path)
    else:
        config = NeuroLensConfig()
    if getattr(args, "dataset", None):
        config.data.dataset = args.dataset
    if getattr(args, "data_dir", None):
        config.data.data_dir = args.data_dir
    if getattr(args, "seed", None) is not None:
        config.seed = args.seed
        config.data.seed = args.seed
        config.split.seed = args.seed
    if getattr(args, "output_dir", None):
        config.report.output_dir = args.output_dir
    if getattr(args, "no_figures", False):
        config.report.include_figures = False
    return config


def _default_data_dir(dataset: str) -> str:
    suffix = dataset.replace("openneuro-", "")
    return os.path.join("data", "raw", suffix)


def _newest_run(root: str) -> Optional[str]:
    if not os.path.isdir(root):
        return None
    candidates = [
        os.path.join(root, name) for name in sorted(os.listdir(root), reverse=True)
        if os.path.exists(os.path.join(root, name, "audit_report.json"))
    ]
    return candidates[0] if candidates else None


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "datasets":
        if getattr(args, "json", False):
            print(json.dumps([m.to_dict() for m in MANIFESTS.values()], indent=2))
            return 0
        for manifest in MANIFESTS.values():
            print(f"{manifest.key}")
            print(f"  title    : {manifest.title}")
            print(f"  disease  : {manifest.disease}")
            print(f"  access   : {manifest.access}  |  license: {manifest.license}")
            print(f"  url      : {manifest.url}")
            print(f"  loader   : {manifest.loader}")
            print()
        print(RESEARCH_USE_NOTICE)
        return 0

    if args.command == "fetch-data":
        manifest = resolve_manifest(args.dataset)
        if manifest.access == "dua":
            print(f"'{manifest.key}' requires a data-use agreement and cannot be "
                  f"fetched automatically.\n\n{manifest.download_command}")
            return 2
        dataset_id = args.dataset.replace("openneuro-", "")
        data_dir = args.data_dir or _default_data_dir(args.dataset)
        written = fetch_openneuro_tabular(dataset_id, data_dir)
        if not written:
            print(f"could not download anything for {dataset_id} into {data_dir}",
                  file=sys.stderr)
            return 1
        print(f"wrote {len(written)} file(s) to {data_dir}:")
        for name, path in written.items():
            print(f"  {name} -> {path}")
        return 0

    if args.command == "run":
        from neurolens.pipeline import NeuroLensPipeline

        config = _load_config(args)
        if not os.path.isdir(config.data.data_dir):
            os.makedirs(config.data.data_dir, exist_ok=True)
        artifacts = NeuroLensPipeline(config).run()
        readiness = artifacts.report["release_readiness"]
        print(f"\nrun        : {artifacts.run_id}")
        print(f"directory  : {artifacts.run_dir}")
        print(f"leakage    : {artifacts.report['cohort']['split']['leakage_free']}")
        print(f"release    : {'ready' if readiness['release_ready'] else readiness['blockers']}")
        print(f"\n{RESEARCH_USE_NOTICE}")
        return 0

    if args.command in ("report", "model-card"):
        path = os.path.join(args.run_dir, "audit_report.json")
        if not os.path.exists(path):
            print(f"no audit_report.json in {args.run_dir}", file=sys.stderr)
            return 1
        from neurolens.reporting import render_markdown, render_model_card

        with open(path, "r", encoding="utf-8") as handle:
            report = json.load(handle)
        text = render_model_card(report) if args.command == "model-card" else render_markdown(report)
        name = "model_card.md" if args.command == "model-card" else "audit_report.md"
        out_path = os.path.join(args.run_dir, name)
        with open(out_path, "w", encoding="utf-8") as handle:
            handle.write(text)
        print(out_path)
        return 0

    if args.command == "serve":
        from neurolens.server.app import serve

        run_dir = args.run_dir or _newest_run(args.runs_root)
        return serve(run_dir=run_dir, runs_root=args.runs_root,
                     host=args.host, port=args.port)

    if args.command == "smoke-test":
        from neurolens.pipeline import smoke_test

        config = _load_config(args)
        result = smoke_test(config)
        print(json.dumps(result, indent=2))
        return 0 if result["checks"]["all_passed"] else 1

    parser.error(f"unknown command {args.command}")
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
