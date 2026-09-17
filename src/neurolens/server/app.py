"""Evidence-workspace API.

Serves the artifacts of a completed NeuroLens run as JSON and hosts the static
single-page UI. The server is read-only: it never mutates a run, so an audit
package that has been reviewed cannot be changed behind a reviewer's back.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from neurolens import RESEARCH_USE_NOTICE
from neurolens.datasets import MANIFESTS

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

GLOSSARY = [
    {"term": "Prediction interval",
     "definition": "A range that is expected to contain the true future value for a given "
                   "patient with a stated probability (here 90%). Built by split conformal "
                   "prediction on the validation split."},
    {"term": "Coverage (PICP)",
     "definition": "The proportion of held-out cases whose true value fell inside the "
                   "prediction interval. It should be close to the nominal level."},
    {"term": "Calibration",
     "definition": "Whether stated confidence matches observed correctness. For a continuous "
                   "model this is the slope of truth regressed on prediction (1.0 is ideal); "
                   "for a classifier it is summarised by the expected calibration error."},
    {"term": "Out-of-distribution (OOD)",
     "definition": "A case whose feature values sit far from the training distribution. "
                   "Scored by Mahalanobis and k-nearest-neighbour distance, expressed as a "
                   "percentile against training data."},
    {"term": "Adequacy",
     "definition": "Whether a subgroup has enough patients for its estimate to mean anything: "
                   "ADEQUATE (n >= 30), EXPLORATORY (10 <= n < 30), or INSUFFICIENT DATA "
                   "(n < 10, no estimate reported)."},
    {"term": "Error gap",
     "definition": "A subgroup's error minus the reference group's error. The reference is "
                   "the largest level of the axis, fixed before evaluation. Only adverse "
                   "(worse) gaps are flagged."},
    {"term": "Worst-group error",
     "definition": "The highest error across all reportable subgroups. The model selection "
                   "rule tries to reduce it without unacceptable overall degradation."},
    {"term": "KernelSHAP attribution",
     "definition": "A per-feature contribution to one patient's prediction, computed by "
                   "weighted regression over feature coalitions. Attributions sum to the "
                   "prediction minus the base value."},
    {"term": "Association vs causation",
     "definition": "Attributions describe what the fitted model used. They are not evidence "
                   "that a biomarker causes progression."},
    {"term": "Split hash",
     "definition": "A digest over the patient-to-partition assignment. Two runs with the same "
                   "split hash were evaluated on identical partitions."},
]


def create_app(run_dir: Optional[str] = None, runs_root: str = "runs") -> FastAPI:
    app = FastAPI(
        title="NeuroLens evidence workspace",
        description=RESEARCH_USE_NOTICE,
        version="0.1.0",
    )
    state: Dict[str, Any] = {"run_dir": run_dir, "runs_root": runs_root}

    # ------------------------------------------------------------------ #
    def _run_dirs() -> List[str]:
        """Completed run directories, newest first.

        Only immediate children of ``runs_root`` count as runs. Recursing would
        let a nested scratch directory -- a seed sweep, a temporary export --
        show up in the run switcher and be mistaken for the newest run.
        """
        root = state["runs_root"]
        if not os.path.isdir(root):
            return []
        found: List[str] = []
        for name in os.listdir(root):
            candidate = os.path.join(root, name)
            if os.path.isfile(os.path.join(candidate, "audit_report.json")):
                found.append(candidate)
        return sorted(found, reverse=True)

    def _active_run_dir(explicit: Optional[str] = None) -> str:
        if explicit:
            candidates = [d for d in _run_dirs() if os.path.basename(d) == explicit or d == explicit]
            if candidates:
                return candidates[0]
            raise HTTPException(status_code=404, detail=f"run '{explicit}' not found")
        if state["run_dir"] and os.path.exists(os.path.join(state["run_dir"], "audit_report.json")):
            return state["run_dir"]
        found = _run_dirs()
        if not found:
            raise HTTPException(
                status_code=404,
                detail=f"No completed run found under '{state['runs_root']}'. "
                       "Run `neurolens run` first.",
            )
        return found[0]

    def _report(directory: Optional[str] = None) -> Dict[str, Any]:
        path = os.path.join(_active_run_dir(directory), "audit_report.json")
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)

    def _figures(directory: str) -> Dict[str, Any]:
        """Semantic figure key -> path as recorded by the run that produced it."""
        try:
            with open(os.path.join(directory, "audit_report.json"), "r",
                      encoding="utf-8") as handle:
                return json.load(handle).get("figures") or {}
        except (OSError, ValueError):
            return {}

    # ------------------------------------------------------------------ #
    @app.get("/api/health")
    def health() -> Dict[str, Any]:
        """Report the run that is actually being served.

        ``active_run`` must match what ``/api/report`` returns. Reporting the
        newest discovered run instead would let ``--run-dir`` pin one run while
        health advertises a different one -- which is exactly what a reviewer
        comparing the two endpoints would catch.
        """
        found = _run_dirs()
        try:
            active = os.path.basename(_active_run_dir())
        except HTTPException:
            active = None
        return {"status": "ok", "runs_root": state["runs_root"], "n_runs": len(found),
                "active_run": active,
                "research_use_notice": RESEARCH_USE_NOTICE}

    @app.get("/api/runs")
    def runs() -> Dict[str, Any]:
        items = []
        for directory in _run_dirs():
            try:
                with open(os.path.join(directory, "manifest.json"), "r", encoding="utf-8") as fh:
                    manifest = json.load(fh)
            except Exception:
                manifest = {}
            items.append({
                "run_id": manifest.get("run_id", os.path.basename(directory)),
                "directory": directory,
                "dataset": manifest.get("dataset"),
                "dataset_access": manifest.get("dataset_access"),
                "split_hash": manifest.get("split_hash"),
                "config_hash": manifest.get("config_hash"),
                "release_ready": (manifest.get("release_readiness") or {}).get("release_ready"),
                "blockers": (manifest.get("release_readiness") or {}).get("blockers", []),
                "artifacts": manifest.get("artifacts", []),
            })
        return {"runs": items}

    @app.get("/api/datasets")
    def datasets() -> Dict[str, Any]:
        return {"datasets": [m.to_dict() for m in MANIFESTS.values()]}

    @app.get("/api/glossary")
    def glossary() -> Dict[str, Any]:
        return {"terms": GLOSSARY}

    @app.get("/api/report")
    def report(run: Optional[str] = None) -> Dict[str, Any]:
        payload = _report(run)
        # Strip the per-model prediction arrays: they are large and the case
        # endpoints serve them on demand.
        for cell in payload.get("model_comparison", []):
            for key in ("predictions", "truth", "uncertainty", "lower", "upper",
                        "interval_width", "probabilities"):
                cell.pop(key, None)
        payload["tasks"]["continuous"]["predictions"] = payload["tasks"]["continuous"].get(
            "predictions", [])[:5]
        return payload

    # Sort keys the case table exposes. "error" is derived rather than stored,
    # so it needs its own accessor instead of a plain field lookup.
    CASE_SORTS: Dict[str, Callable[[Dict[str, Any]], Any]] = {
        "patient_id": lambda r: str(r.get("patient_id", "")),
        "truth": lambda r: r.get("truth"),
        "prediction": lambda r: r.get("prediction"),
        "uncertainty": lambda r: r.get("uncertainty"),
        "ood_score": lambda r: r.get("ood_score"),
        "interval_width": lambda r: r.get("interval_width"),
        "error": lambda r: (
            None
            if r.get("prediction") is None or r.get("truth") is None
            else abs(float(r["prediction"]) - float(r["truth"]))
        ),
    }

    @app.get("/api/cases")
    def cases(run: Optional[str] = None,
              flagged_only: bool = False, search: Optional[str] = None,
              sort: Optional[str] = None, order: str = "desc",
              limit: int = 200, offset: int = 0) -> Dict[str, Any]:
        # Reject unknown keys loudly. Silently ignoring an unrecognised sort is
        # what let this endpoint advertise sorting it never performed, so a
        # caller's mistake must surface as an error, not as unchanged rows.
        if sort is not None and sort not in CASE_SORTS:
            raise HTTPException(
                status_code=400,
                detail=f"unknown sort key {sort!r}; expected one of "
                       f"{', '.join(sorted(CASE_SORTS))}",
            )
        if order not in ("asc", "desc"):
            raise HTTPException(
                status_code=400, detail=f"unknown order {order!r}; expected 'asc' or 'desc'"
            )

        payload = _report(run)
        rows = list(payload["tasks"]["continuous"].get("predictions", []))
        if flagged_only:
            rows = [r for r in rows
                    if r.get("ood_score") is not None and r.get("ood_threshold") is not None
                    and r["ood_score"] > r["ood_threshold"]]
        if search:
            needle = search.lower()
            rows = [r for r in rows if needle in str(r.get("patient_id", "")).lower()]

        if sort is not None:
            accessor = CASE_SORTS[sort]
            reverse = order == "desc"
            # Missing values sort last regardless of direction, so ascending and
            # descending are genuine mirrors of each other rather than both
            # parking the same nulls at the top.
            rows = sorted(
                rows,
                key=lambda r: (accessor(r) is None, accessor(r) if accessor(r) is not None else 0,
                               str(r.get("patient_id", ""))),
                reverse=reverse,
            )
            # A reverse sort would drag the nulls to the front; put them back at
            # the end so "missing" always reads as the tail of the table.
            if reverse:
                present = [r for r in rows if accessor(r) is not None]
                missing = [r for r in rows if accessor(r) is None]
                rows = present + missing

        total = len(rows)
        return {"total": total, "offset": offset, "limit": limit,
                "cases": rows[offset:offset + limit]}

    @app.get("/api/case/{patient_id}")
    def case(patient_id: str, run: Optional[str] = None) -> Dict[str, Any]:
        payload = _report(run)
        prediction = next(
            (c for c in payload["tasks"]["continuous"].get("predictions", [])
             if str(c.get("patient_id")) == patient_id), None)
        explanation = next(
            (c for c in payload.get("explainability", {}).get("cases", [])
             if str(c.get("patient_id")) == patient_id), None)
        if prediction is None and explanation is None:
            raise HTTPException(status_code=404, detail=f"no prediction for {patient_id}")
        return {
            "patient_id": patient_id,
            "prediction": prediction,
            "explanation": explanation,
            "units": payload["cohort"]["target_definition"].get("units"),
            "subgroup_context": _subgroup_context(payload, prediction),
            "research_use_notice": RESEARCH_USE_NOTICE,
            "causation_notice": payload.get("explainability", {}).get("causation_notice"),
        }

    def _subgroup_context(payload: Dict[str, Any],
                          prediction: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Fairness rows for the subgroups a patient belongs to, where determinable."""
        if not prediction:
            return []
        explanation = next(
            (c for c in payload.get("explainability", {}).get("cases", [])
             if str(c.get("patient_id")) == str(prediction.get("patient_id"))), None)
        values = (explanation or {}).get("subgroup_context") or {}
        out = []
        for row in payload.get("fairness", {}).get("rows", []):
            axis = row.get("axis")
            if axis in values and str(values[axis]) == str(row.get("subgroup")):
                out.append(row)
        return out

    @app.get("/api/figures/{name}")
    def figure(name: str, run: Optional[str] = None):
        directory = _active_run_dir(run)
        stem = os.path.splitext(os.path.basename(name))[0]
        figures = _figures(directory)
        # The report maps a semantic key onto the file that was actually written,
        # and the two are not always the same string: `mitigation_tradeoff` is
        # saved as `mitigation.png` and `target_distribution` as `target.png`.
        # Resolve through the report instead of assuming the key is the filename.
        candidates: List[str] = []
        stored = figures.get(stem)
        if stored:
            candidates.append(os.path.join(directory, "figures", os.path.basename(str(stored))))
        candidates.append(os.path.join(directory, "figures", os.path.basename(name)))
        for path in candidates:
            if os.path.isfile(path):
                return FileResponse(path, media_type="image/png")
        raise HTTPException(status_code=404, detail=f"figure '{name}' not found")

    @app.get("/api/artifact/{name:path}")
    def artifact(name: str, run: Optional[str] = None):
        """Serve one file from the run directory.

        ``name`` may be a run-relative path, because the manifest lists figures as
        ``figures/mitigation.png``. Resolution is confined to the run directory:
        the canonical path must stay inside it, so ``..`` segments cannot escape.
        """
        directory = _active_run_dir(run)
        root = os.path.realpath(directory)
        relative = name.lstrip("/\\")
        path = os.path.realpath(os.path.join(root, relative))
        inside = path == root or path.startswith(root + os.sep)
        if not inside or not os.path.isfile(path):
            raise HTTPException(status_code=404, detail=f"artifact '{name}' not found")
        media = {
            ".json": "application/json", ".csv": "text/csv",
            ".md": "text/markdown", ".html": "text/html", ".yaml": "text/yaml",
            ".png": "image/png",
        }.get(os.path.splitext(path)[1], "text/plain")
        return FileResponse(path, media_type=media, filename=os.path.basename(path))

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def serve(run_dir: Optional[str] = None, runs_root: str = "runs",
          host: str = "0.0.0.0", port: int = 8000) -> int:
    import uvicorn

    app = create_app(run_dir=run_dir, runs_root=runs_root)
    print(f"[neurolens] evidence workspace on http://{host}:{port} "
          f"(runs root: {runs_root})")
    print(f"[neurolens] {RESEARCH_USE_NOTICE}")
    uvicorn.run(app, host=host, port=port, log_level="info")
    return 0
