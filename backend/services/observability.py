"""LangSmith observability shims for the QC Checklist Creator backend.

This service makes Gemini calls via the modern `google-genai` SDK. LangSmith
doesn't auto-wrap that SDK, so we use:

  - `@traced_llm(name, model)` on each function that makes an LLM call —
    captures inputs, outputs, latency, and errors on the dashboard.
  - `record_gemini_usage(response, model)` immediately after each
    `client.models.generate_content(...)` call — forwards Gemini's
    `usage_metadata` (prompt_token_count, candidates_token_count) to the
    active LangSmith run so cost shows up correctly.

If `langsmith` isn't installed or `LANGCHAIN_TRACING_V2` is not "true",
every helper becomes a no-op — the service runs unchanged with zero overhead.
"""

import os
from typing import Any, Callable

try:
    from langsmith import traceable as _ls_traceable
    from langsmith.run_helpers import get_current_run_tree
    _LS_AVAILABLE = True
except Exception:
    _LS_AVAILABLE = False
    _ls_traceable = None
    get_current_run_tree = None  # type: ignore


_TRACING_ON = (
    _LS_AVAILABLE
    and os.getenv("LANGCHAIN_TRACING_V2", "").lower() == "true"
)


def is_enabled() -> bool:
    """Returns True iff LangSmith tracing is active in this process."""
    return _TRACING_ON


def traced_llm(name: str, model: str = "", provider: str = "google_genai") -> Callable:
    """Decorator: marks a function as an LLM call-site in LangSmith.

    When tracing is off (or langsmith is missing) this returns the function
    unchanged, so there is zero overhead unless LANGCHAIN_TRACING_V2 is "true".
    """
    if not _TRACING_ON:
        def _noop(fn):
            return fn
        return _noop

    metadata = {"ls_model_name": model, "ls_provider": provider} if model else None
    return _ls_traceable(name=name, run_type="llm", metadata=metadata)


def record_gemini_usage(response: Any, model: str = "") -> None:
    """Attach a Gemini response's token usage to the active LangSmith run.

    google-genai responses carry `usage_metadata` with `prompt_token_count`,
    `candidates_token_count`, and `total_token_count`. LangSmith reads
    `usage_metadata` for cost computation. Safe to call when tracing is off —
    it just no-ops.
    """
    if not _TRACING_ON or get_current_run_tree is None:
        return
    try:
        run = get_current_run_tree()
        if run is None:
            return
        usage = getattr(response, "usage_metadata", None)
        if usage is None:
            return
        input_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        output_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)
        total = int(getattr(usage, "total_token_count", input_tokens + output_tokens) or 0)
        run.add_metadata({
            "usage_metadata": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total,
            },
            "ls_model_name": model,
            "ls_provider": "google_genai",
        })
    except Exception:
        # Telemetry must NEVER raise.
        pass
