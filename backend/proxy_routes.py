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

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/qc-analytics", tags=["QC Analytics Proxy"])

SOLAR_AGENTS_BASE = os.getenv("SOLAR_AGENTS_API_BASE", "").rstrip("/")
SOLAR_AGENTS_TOKEN = os.getenv("SOLAR_AGENTS_SERVICE_TOKEN", "")
HTTP_TIMEOUT = float(os.getenv("SOLAR_AGENTS_TIMEOUT_SECS", "30"))


async def _forward(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    """Forward a GET to solar_ai_agents and surface its response or error verbatim."""
    if not SOLAR_AGENTS_BASE or not SOLAR_AGENTS_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="SOLAR_AGENTS_API_BASE or SOLAR_AGENTS_SERVICE_TOKEN env var is not set.",
        )

    url = f"{SOLAR_AGENTS_BASE}{path}"
    headers = {"Authorization": f"Bearer {SOLAR_AGENTS_TOKEN}"}
    clean_params = {k: v for k, v in (params or {}).items() if v is not None}

    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            r = await client.get(url, params=clean_params, headers=headers)
    except httpx.RequestError as e:
        logger.error("Upstream unreachable: %s", e)
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {e}")

    if r.status_code >= 400:
        logger.warning("Upstream %s returned %s: %s", path, r.status_code, r.text[:200])
        raise HTTPException(status_code=r.status_code, detail=r.text)
    return r.json()


@router.get("/overview")
async def overview(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward("/api/v1/qc/analytics/overview", {"from": date_from, "to": date_to})


@router.get("/by-ahj")
async def by_ahj(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward("/api/v1/qc/analytics/by-ahj", {"from": date_from, "to": date_to})


@router.get("/by-utility")
async def by_utility(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward("/api/v1/qc/analytics/by-utility", {"from": date_from, "to": date_to})


@router.get("/by-state")
async def by_state(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
):
    return await _forward("/api/v1/qc/analytics/by-state", {"from": date_from, "to": date_to})


@router.get("/top-failing-checks")
async def top_failing_checks(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    ahj: Optional[str] = Query(None),
    utility: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    limit: int = Query(10, ge=1, le=100),
):
    return await _forward("/api/v1/qc/analytics/top-failing-checks", {
        "from": date_from, "to": date_to,
        "ahj": ahj, "utility": utility, "state": state, "limit": limit,
    })
