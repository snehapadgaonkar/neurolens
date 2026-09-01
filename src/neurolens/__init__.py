"""NeuroLens — auditable AI for neurodegenerative disease progression.

NeuroLens is a research-grade pipeline and evidence workspace. It pairs a
progression prediction with the evidence that qualifies it: cohort provenance,
leakage checks, subgroup behaviour, calibrated uncertainty, out-of-distribution
risk, and neuroanatomical explanations.

Heavy submodules are imported lazily (PEP 562) so that ``import neurolens``
stays cheap and so a partially installed optional dependency cannot break the
whole package.

.. warning::
   NeuroLens is a research prototype. It does not diagnose disease, does not
   recommend treatment, and is not clinically validated.
"""

from typing import Any

__version__ = "0.1.0"

#: Shown verbatim in every report, every UI surface, and every exported artifact.
RESEARCH_USE_NOTICE = (
    "NeuroLens is a research prototype for neurodegenerative disease progression "
    "modelling. It is not clinically validated, must not be used for diagnosis or "
    "treatment decisions, and its feature attributions describe model association "
    "rather than biological causation."
)

_LAZY = {
    "NeuroLensConfig": "neurolens.config",
    "NeuroLensPipeline": "neurolens.pipeline",
    "RunArtifacts": "neurolens.pipeline",
    "load_cohort": "neurolens.datasets",
    "MANIFESTS": "neurolens.datasets",
}

__all__ = ["__version__", "RESEARCH_USE_NOTICE", *_LAZY]


def __getattr__(name: str) -> Any:  # PEP 562
    if name in _LAZY:
        import importlib

        module = importlib.import_module(_LAZY[name])
        return getattr(module, name)
    raise AttributeError(f"module 'neurolens' has no attribute {name!r}")


def __dir__() -> list:
    return sorted(__all__)
