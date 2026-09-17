"""Tests for the evidence-workspace API."""

from __future__ import annotations

import json
import os
import re
import shutil

import pytest

pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from neurolens.server.app import GLOSSARY, create_app  # noqa: E402


@pytest.fixture(scope="module")
def client(smoke_run):
    return TestClient(create_app(run_dir=smoke_run["run_dir"],
                                 runs_root=os.path.dirname(smoke_run["run_dir"])))


def test_health(client):
    payload = client.get("/api/health").json()
    assert payload["status"] == "ok"
    assert payload["n_runs"] >= 1
    assert "research prototype" in payload["research_use_notice"]


def test_root_is_a_json_api_index_not_a_web_page(client):
    """The API host must serve no UI.

    `:8000` used to host a second, no-build single-page app alongside the
    Next.js workspace. Two front ends reading the same report meant every field
    rename had to be made twice, and only one of them was covered by types.
    This asserts the API root describes the API instead.
    """
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    payload = response.json()
    assert payload["service"] == "neurolens-evidence-api"

    # Every listed endpoint must actually exist, or the index is a lie.
    # Compare against the route table rather than probing URLs: a templated
    # path like /api/case/{patient_id} cannot be fetched without a real id,
    # and a 404 there would say nothing about whether the route is registered.
    # FastAPI's converter syntax ({name:path}) is stripped so the index can
    # advertise the plain, human-readable form.
    def canonical(path: str) -> str:
        return re.sub(r"\{(\w+):\w+\}", r"{\1}", path)

    registered = {canonical(r.path) for r in client.app.routes if hasattr(r, "path")}
    for path in payload["endpoints"]:
        assert path in registered, f"index advertises {path}, which is not a route"


def test_no_static_frontend_is_served_by_the_api(client):
    """Regression guard: the removed SPA must not come back."""
    assert client.get("/static/app.js").status_code == 404
    assert client.get("/static/styles.css").status_code == 404
    assert client.get("/static/index.html").status_code == 404


def test_runs_listing(client):
    runs = client.get("/api/runs").json()["runs"]
    assert runs
    assert {"run_id", "dataset", "split_hash", "config_hash", "release_ready"}.issubset(runs[0])


def test_datasets_endpoint_exposes_access_tiers(client):
    datasets = client.get("/api/datasets").json()["datasets"]
    keys = {d["key"] for d in datasets}
    assert "openneuro-ds004856" in keys
    assert "chdi-hd-bids" in keys
    by_key = {d["key"]: d for d in datasets}
    assert by_key["openneuro-ds004856"]["access"] == "open"
    assert by_key["chdi-hd-bids"]["access"] == "dua"
    assert by_key["chdi-hd-bids"]["redistributable"] is False


def test_report_endpoint_carries_the_evidence_sections(client):
    report = client.get("/api/report").json()
    for section in ("manifest", "cohort", "tasks", "fairness", "trust",
                    "explainability", "limitations", "known_failure_modes",
                    "release_readiness"):
        assert section in report, f"missing {section}"
    assert report["research_use_notice"]
    assert report["cohort"]["split"]["leakage_free"] is True
    # The heavy per-model arrays must be stripped from the overview payload.
    for cell in report["model_comparison"]:
        assert "predictions" not in cell


def test_cases_endpoint_and_filters(client):
    payload = client.get("/api/cases?limit=5").json()
    assert payload["total"] > 0
    assert len(payload["cases"]) <= 5
    for case in payload["cases"]:
        assert {"patient_id", "truth", "prediction", "interval", "uncertainty"}.issubset(case)

    first = payload["cases"][0]["patient_id"]
    assert client.get(f"/api/cases?search={first}").json()["total"] == 1
    assert client.get("/api/cases?search=definitely-not-a-patient").json()["total"] == 0
    assert "total" in client.get("/api/cases?flagged_only=true").json()


def test_cases_endpoint_sorting_actually_reorders(client):
    """Regression: `sort` used to be accepted and then silently ignored.

    The client sent sort=error and got back the default order, so the case
    table's "Sort by" control appeared to work while changing nothing.
    """
    def order(sort, order_="desc"):
        rows = client.get(f"/api/cases?sort={sort}&order={order_}&limit=500").json()["cases"]
        return [r["patient_id"] for r in rows]

    # Each key must produce its own ordering, not the same default one.
    by_uncertainty = order("uncertainty")
    by_error = order("error")
    by_patient = order("patient_id")
    assert by_uncertainty != by_error
    assert by_uncertainty != by_patient
    assert len(by_uncertainty) == len(by_error)

    # And the values must really be in the claimed order.
    unc = [r["uncertainty"] for r in
           client.get("/api/cases?sort=uncertainty&order=desc&limit=500").json()["cases"]]
    assert unc == sorted(unc, reverse=True)
    asc = [r["uncertainty"] for r in
           client.get("/api/cases?sort=uncertainty&order=asc&limit=500").json()["cases"]]
    assert asc == sorted(asc)
    # Ascending and descending must be genuine mirrors of each other, and both
    # must cover the same patients -- sorting may reorder rows, never lose them.
    assert asc == list(reversed(unc))
    assert asc == sorted(unc)

    # "error" is derived from |prediction - truth| rather than stored.
    err = [abs(r["prediction"] - r["truth"]) for r in
           client.get("/api/cases?sort=error&order=desc&limit=500").json()["cases"]]
    assert err == sorted(err, reverse=True)


def test_cases_endpoint_rejects_unknown_sort_and_order(client):
    """An unrecognised key must fail loudly, not return unsorted rows."""
    bad_sort = client.get("/api/cases?sort=not-a-column")
    assert bad_sort.status_code == 400
    assert "unknown sort key" in bad_sort.json()["detail"]

    bad_order = client.get("/api/cases?order=sideways")
    assert bad_order.status_code == 400
    assert "unknown order" in bad_order.json()["detail"]

    # Omitting them entirely is still valid and returns the default order.
    assert client.get("/api/cases?limit=5").status_code == 200


def test_cases_sorting_is_declared_in_the_openapi_schema(client):
    """Guard the contract the browser depends on: sort/order must be advertised."""
    schema = client.get("/openapi.json").json()
    params = {p["name"] for p in schema["paths"]["/api/cases"]["get"]["parameters"]}
    assert {"sort", "order"}.issubset(params)


def test_case_endpoint_returns_prediction_uncertainty_and_caveats(client):
    patient = client.get("/api/cases?limit=1").json()["cases"][0]["patient_id"]
    payload = client.get(f"/api/case/{patient}").json()
    assert payload["patient_id"] == patient
    assert payload["units"]
    assert "research prototype" in payload["research_use_notice"]
    assert payload["prediction"]["interval"] and len(payload["prediction"]["interval"]) == 2


def test_case_endpoint_404s_for_unknown_patients(client):
    assert client.get("/api/case/not-a-real-patient").status_code == 404


def test_glossary_endpoint(client):
    terms = client.get("/api/glossary").json()["terms"]
    assert len(terms) == len(GLOSSARY)
    for term in terms:
        assert term["term"] and term["definition"]


def test_artifact_and_figure_endpoints(client, smoke_run):
    for name in ("audit_report.json", "model_card.md", "predictions.csv",
                 "fairness_audit.csv", "manifest.json"):
        response = client.get(f"/api/artifact/{name}")
        assert response.status_code == 200, name
    assert client.get("/api/artifact/does-not-exist.csv").status_code == 404

    assert client.get("/api/figures/nope.png").status_code == 404


def test_every_figure_key_resolves_even_when_it_is_not_the_filename(figure_run, tmp_path):
    """Two figure keys differ from the file names they were written to."""
    app_client = TestClient(create_app(run_dir=figure_run.run_dir,
                                       runs_root=os.path.dirname(figure_run.run_dir)))
    figures = app_client.get("/api/report").json().get("figures", {})
    assert len(figures) == 8, list(figures)

    on_disk = set(os.listdir(os.path.join(figure_run.run_dir, "figures")))
    mismatched = [key for key, value in figures.items()
                  if os.path.basename(value) != f"{key}.png"]
    assert {"mitigation_tradeoff", "target_distribution"} <= set(mismatched)
    for key in mismatched:
        assert f"{key}.png" not in on_disk, f"{key} unexpectedly matches its filename"

    # Every semantic key must serve its image through the report mapping.
    for key in figures:
        response = app_client.get(f"/api/figures/{key}.png")
        assert response.status_code == 200, key
        assert response.headers["content-type"] == "image/png"
        assert response.content[:8] == b"\x89PNG\r\n\x1a\n"

    # The bare file name keeps working too.
    assert app_client.get("/api/figures/mitigation.png").status_code == 200
    assert app_client.get("/api/figures/does-not-exist.png").status_code == 404

    # Every manifest entry — including run-relative figure paths — must be
    # fetchable through the artifact route.
    manifest = app_client.get("/api/artifact/manifest.json").json()
    assert len(manifest["artifacts"]) == 18
    for entry in manifest["artifacts"]:
        response = app_client.get(f"/api/artifact/{entry}")
        assert response.status_code == 200, f"{entry} -> {response.status_code}"

    # Path traversal must not escape the run directory.
    for attempt in ("/api/artifact/../../etc/passwd",
                    "/api/artifact/..%2f..%2f..%2fetc%2fpasswd",
                    "/api/artifact/figures/../../config.yaml",
                    "/api/artifact/%2e%2e%2f%2e%2e%2fetc%2fpasswd"):
        assert app_client.get(attempt).status_code in (400, 404), attempt


def test_path_traversal_is_not_possible(client):
    assert client.get("/api/artifact/..%2f..%2f..%2fetc%2fpasswd").status_code == 404


def test_run_discovery_ignores_nested_scratch_directories(smoke_run, tmp_path):
    """A scratch tree under the runs root must not become selectable runs.

    ``runs_root`` is walked for any directory holding ``audit_report.json``. When
    a seed sweep or a temporary export nests its own runs one level down, a
    recursive walk promotes all of them into the run switcher and lets one of
    them be mistaken for the newest run.
    """
    root = tmp_path / "runs"
    root.mkdir()
    # One real run at the top level.
    real = root / "20260101T000000Z-real"
    shutil.copytree(smoke_run["run_dir"], real)

    # Six scratch runs nested under a subdirectory, plus a deeper level.
    scratch = root / "seedcheck"
    for index in range(6):
        nested = scratch / f"20260101T00000{index}Z-scratch"
        nested.mkdir(parents=True)
        shutil.copy(os.path.join(smoke_run["run_dir"], "audit_report.json"),
                    os.path.join(nested, "audit_report.json"))
    deep = scratch / "nested" / "deeper"
    deep.mkdir(parents=True)
    shutil.copy(os.path.join(smoke_run["run_dir"], "audit_report.json"),
                os.path.join(deep, "audit_report.json"))

    app_client = TestClient(create_app(runs_root=str(root)))
    listed = app_client.get("/api/runs").json()["runs"]

    assert len(listed) == 1, [r["run_id"] for r in listed]
    assert app_client.get("/api/health").json()["n_runs"] == 1


def test_health_reports_the_run_actually_served(smoke_run, tmp_path):
    """``active_run`` must match what ``/api/report`` returns.

    With ``--run-dir`` pinning an older run, health used to advertise the newest
    run it could discover instead -- so the two endpoints disagreed about which
    run the workspace was showing.
    """
    root = tmp_path / "runs"
    root.mkdir()
    pinned = root / "20260101T000000Z-pinned"
    shutil.copytree(smoke_run["run_dir"], pinned)

    # A newer run that must NOT be reported as active.
    newer = root / "20260102T000000Z-newer"
    shutil.copytree(smoke_run["run_dir"], newer)

    app_client = TestClient(create_app(run_dir=str(pinned), runs_root=str(root)))
    health = app_client.get("/api/health").json()
    report = app_client.get("/api/report").json()

    assert health["active_run"] == pinned.name
    assert report["manifest"]["run_id"] == json.loads(
        (pinned / "audit_report.json").read_text(encoding="utf-8")
    )["manifest"]["run_id"]
    # The newer run is still listed as available, just not active. Note the
    # listing keys off the manifest's run_id, which both copies share, so the
    # distinguishing field is the directory each entry resolves to.
    assert health["n_runs"] == 2
    listed = {os.path.basename(r["directory"])
              for r in app_client.get("/api/runs").json()["runs"]}
    assert listed == {pinned.name, newer.name}
    assert health["active_run"] != newer.name


def test_active_run_follows_the_newest_run_without_a_restart(tmp_path):
    """A run created after the server starts must become active.

    The CLI used to resolve "newest" once at startup and pin it, so a run
    generated while the server was up never became active: /api/runs listed it
    newest-first while /api/health and every unscoped request still served the
    older one. The workspace would then show a report and a case table from two
    different models.
    """
    runs_root = tmp_path / "runs"
    runs_root.mkdir()

    def make_run(run_id: str) -> None:
        d = runs_root / run_id
        d.mkdir()
        (d / "audit_report.json").write_text(
            json.dumps({"manifest": {"run_id": run_id}, "tasks": {}, "cohort": {}})
        )

    make_run("20260101T000000Z-test")
    app = create_app(runs_root=str(runs_root))
    client = TestClient(app)
    assert client.get("/api/health").json()["active_run"] == "20260101T000000Z-test"

    # A newer run appears while the same app object is still serving.
    make_run("20260202T000000Z-test")
    assert client.get("/api/health").json()["active_run"] == "20260202T000000Z-test"
    assert client.get("/api/runs").json()["runs"][0]["run_id"] == "20260202T000000Z-test"


def test_explicit_run_dir_still_pins_the_active_run(tmp_path):
    """--run-dir is a deliberate choice and must not be overridden by "newest"."""
    runs_root = tmp_path / "runs"
    runs_root.mkdir()
    for run_id in ("20260101T000000Z-test", "20260202T000000Z-test"):
        d = runs_root / run_id
        d.mkdir()
        (d / "audit_report.json").write_text(
            json.dumps({"manifest": {"run_id": run_id}, "tasks": {}, "cohort": {}})
        )

    pinned = str(runs_root / "20260101T000000Z-test")
    client = TestClient(create_app(run_dir=pinned, runs_root=str(runs_root)))
    assert client.get("/api/health").json()["active_run"] == "20260101T000000Z-test"
