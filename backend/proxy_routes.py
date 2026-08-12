"""
Proxy router that forwards QC analytics calls to the solar_ai_agents backend.

Why a proxy?
  - This app has no user-facing auth; the frontend can't hold a JWT.
  - solar_ai_agents requires a Bearer token on every analytics call.
  - The service token stays here as a server-side env var and never reaches
    the browser.

Required environment variables:
  SOLAR_AGENTS_API_BASE      e.g. https://agent-live.solaragenthub.com
  SOLAR_AGENTS_SERVICE_TOKEN long-lived JWT signed with solar_ai_agents' JWT_SECRET_KEY
"""

import logging
import os
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, HTTPException, Query

# WHICH ANALYTICS ROUTER TO TALK TO.
#
# solar_ai_agents mounts TWO analytics routers at different prefixes — the V1
# agent's under /api/v1 and the V2 agent's under /api/v2 — and they expose the
# SAME four paths. This dashboard reports on Quality Check V2, so it must ask
# /api/v2; pointed at /api/v1 it silently returns V1's numbers instead, which
# look plausible and are about a different agent entirely.
_API_VERSION = os.getenv("SOLAR_AGENTS_API_VERSION", "/api/v2").rstrip("/")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/qc-analytics", tags=["QC Analytics Proxy"])

async def _forward(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """Forward a GET to solar_ai_agents and surface its response or error verbatim."""
    # Read env at request time — avoids import-order issues where this module
    # is imported before load_dotenv() runs in main.py.
    base = os.getenv("SOLAR_AGENTS_API_BASE", "").rstrip("/")
    token = os.getenv("SOLAR_AGENTS_SERVICE_TOKEN", "")
    timeout = float(os.getenv("SOLAR_AGENTS_TIMEOUT_SECS", "45"))

    if not base or not token:
        raise HTTPException(
            status_code=500,
            detail="SOLAR_AGENTS_API_BASE or SOLAR_AGENTS_SERVICE_TOKEN env var is not set.",
        )

    url = f"{base}{path}"
    headers = {"Authorization": f"Bearer {token}"}
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url, params=clean_params, headers=headers)
    except httpx.RequestError as e:
        logger.error("Upstream unreachable: %s", e)
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {e}")

    if r.status_code >= 400:
        logger.warning("Upstream %s returned %s: %s", path, r.status_code, r.text[:200])
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/states")
async def states(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward(f"{_API_VERSION}/qc/analytics/states", {"from": date_from, "to": date_to})


@router.get("/section")
async def section(
    dimension: str = Query(..., description="'ahj' or 'utility'"),
    state: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward(f"{_API_VERSION}/qc/analytics/section", {
        "dimension": dimension, "state": state, "from": date_from, "to": date_to,
    })


@router.get("/state-trend")
async def state_trend(
    dimension: str = Query(..., description="'ahj' or 'utility'"),
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward(f"{_API_VERSION}/qc/analytics/state-trend", {
        "dimension": dimension, "from": date_from, "to": date_to,
    })


@router.get("/general/section")
async def general_section(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward(f"{_API_VERSION}/qc/analytics/general/section", {
        "from": date_from, "to": date_to,
    })
