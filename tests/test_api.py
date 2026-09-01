"""Tests for the evidence-workspace API."""

from __future__ import annotations

import os

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


def test_index_and_static_assets_are_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "NeuroLens" in response.text
    for asset in ("/static/styles.css", "/static/app.js"):
        assert client.get(asset).status_code == 200


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
