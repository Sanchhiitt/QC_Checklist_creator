#!/usr/bin/env python3
"""
permit_enrichment_agent_gemini.py  —  VERTEX AI edition (state-fallback build)
=============================================================================

AI data-enrichment agent for the "Permitting Application" sheets (Utility +
AHJ). Gemini 3 via Vertex AI (service-account auth) + Grounding with Google
Search. Fills the GREEN regulatory columns with REAL, source-cited data; every
value column is paired with a "<field> — Source" column, plus _confidence and
_needs_review. Nothing is guessed.

WHAT'S IN THIS BUILD
  • Forced JSON output (response_mime_type)  → no "no JSON object" failures.
  • MAX_TOKENS 16384 so Gemini-3 thinking can't truncate the JSON.
  • Technical failures are NOT cached → a re-run automatically retries them.
  • Source-sanity guard: if a cell's source clearly belongs to a DIFFERENT
    entity (and isn't a known authority), the value + link are KEPT but the cell
    is flagged REVIEW (nothing deleted/blocked — a human verifies via the link).
  • STATE-LEVEL FALLBACK (new): some fields are really set state-wide (net-
    metering framework, NEC code cycle, inspection, PE-stamp baseline). We
    research each state ONCE and use it to fill any per-entity blank in those
    fields — always at "low" confidence + a "(state-level default — verify
    locally)" note, so it's a flagged starting point, never a verified fact.
  • RETRY_NOT_FOUND (new, optional): on a re-run, re-research entities that
    still have blanks and MERGE results so coverage only grows.

NOTE: "non-text parts ... thought_signature" warnings are harmless (Gemini-3
thinking trace). Ignore them.

──────────────────────────────────────────────────────────────────────────
AUTH — VERTEX AI (service account): Vertex AI API enabled, SA has role
"Vertex AI User", service_account_key.json next to this script.

QUICK START
  1. pip install google-genai google-auth
  2. Put service_account_key.json in this folder, CSV under input/.
  3. DRY_RUN = True first; then DRY_RUN = False. LIMIT = 0 = whole sheet.
A .cache.jsonl (entities) and .states.cache.jsonl (state pass) are written so
re-running resumes where it left off.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field as dc_field

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from google import genai
    from google.genai import types
except ImportError:
    sys.exit("Missing dependency. In the VS Code terminal run:\n"
             "    pip install google-genai google-auth")


# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  EDIT THIS BLOCK — then press Run. Nothing else needs changing.           ║
# ╚══════════════════════════════════════════════════════════════════════════╝
SHEET   = "utility"                                     # "utility"  or  "ahj"
INPUT   = "input/Permitting Application - Utility.csv"  # path to your CSV
OUTPUT  = "Utility_enriched.csv"                        # where results go

LIMIT   = 0         # how many UNIQUE entities to research. 0 = ALL (~5,100)
DRY_RUN = False     # True = show dedup + cost estimate only, NO API calls

WORKERS = 10         # parallel API calls. Faster: 8–10. If many
                    # "429 / RESOURCE_EXHAUSTED" warnings, drop back to ~5.
MODEL   = "gemini-3.5-flash"     # default. Stronger reasoning: "gemini-3.1-pro-preview"
                                 # Cheaper: "gemini-3.1-flash-lite"

STATE_FALLBACK  = True    # fill blank state-level fields from a per-state lookup
                          # (always tagged "low / verify locally")
RETRY_NOT_FOUND = False   # on re-runs, re-research entities that still have blanks
                          # and MERGE (coverage only grows). Costs $ on each run.

# ── Vertex AI auth (service account) ─────────────────────────────────────────
USE_VERTEX           = True                        # True = Vertex AI; False = API key
SERVICE_ACCOUNT_FILE = "service_account_key.json"  # in project root
VERTEX_PROJECT       = ""        # blank = auto-read project_id from the key file
VERTEX_LOCATION      = "global"  # "global" (recommended for Gemini) or e.g. "us-central1"
# ── For the AHJ sheet, set:
#   SHEET="ahj"; INPUT="input/Permitting Application - AHJ.csv"; OUTPUT="AHJ_enriched.csv"
# ════════════════════════════════════════════════════════════════════════════

# Tunables you usually won't touch:
MAX_TOKENS = 16384            # generous so JSON isn't truncated by Gemini 3 thinking
REQUEST_RETRIES = 4
RETRY_BACKOFF_SECONDS = 8     # exponential: 8, 16, 32, ...
CONFIDENCE_LEVELS = {"high", "medium", "low", "not_found"}


# --------------------------------------------------------------------------- #
# Field schemas — the green columns, with source hints fed to the model
# --------------------------------------------------------------------------- #

@dataclass
class FieldSpec:
    name: str            # exact column header in the sheet
    description: str     # what we want + the allowed value shape
    sources: str         # where to look (steered, not invented)


IDENTITY_COLS = {        # first 5 columns of each sheet = YOUR data, untouched
    "utility": ["State", "Utility Name", "Designs", "2025", "2024"],
    "ahj":     ["State", "AHJ Name", "Designs", "2025", "2024"],
}
NAME_COL = {"utility": "Utility Name", "ahj": "AHJ Name"}

UTILITY_FIELDS = [
    FieldSpec("Utility Type",
              "One of: IOU | Municipal | Co-op | Federal/PUD.",
              "EIA-861 utility database; DSIRE; the utility's own 'About' page."),
    FieldSpec("Interconnection Portal / Method",
              "How a solar interconnection application is submitted "
              "(e.g. 'Online portal (PowerClerk)', 'Email submission', 'Paper').",
              "The utility's interconnection/'connect your solar' page; "
              "presence of PowerClerk or Lumin portals."),
    FieldSpec("Net Metering / Billing Program",
              "The actual export-compensation program name + mechanism "
              "(true NEM vs net billing vs buyback; note the rate if published). "
              "Do NOT assume NEM — many utilities pay a sub-retail buyback.",
              "DSIRE program detail page for this utility/state; the utility's "
              "net-metering or solar-rider tariff PDF."),
    FieldSpec("Max System Size (kW AC)",
              "Max eligible DG system size for the program (kW AC), or 'No cap'.",
              "DSIRE; the utility interconnection tariff."),
    FieldSpec("Sizing Rule",
              "Sizing limit relative to load (e.g. '<=100% of annual consumption').",
              "Utility tariff / interconnection rules."),
    FieldSpec("Required Documents",
              "Documents required for the interconnection application.",
              "Utility interconnection application form / checklist."),
    FieldSpec("PE Stamp Required",
              "Yes | No | Case-by-case — is a PE stamp required for the app.",
              "Utility interconnection requirements; state rule."),
    FieldSpec("External AC Disconnect",
              "Yes | No | Conditional — is a visible external AC disconnect required.",
              "Utility interconnection technical requirements."),
    FieldSpec("Bi-Directional Meter",
              "Yes | No — is a bi-directional / net meter installed.",
              "Utility metering/tariff rules."),
    FieldSpec("Application Fee",
              "The interconnection/application fee (e.g. '$75', '$0'). "
              "LOW availability — leave null unless you find a real fee schedule.",
              "Utility fee schedule / tariff. Do not estimate."),
    FieldSpec("Typical Approval TAT",
              "Typical approval turnaround. RARELY published — leave null unless "
              "the utility states a timeline; never guess.",
              "Utility interconnection page if it states an SLA."),
]

AHJ_FIELDS = [
    FieldSpec("Jurisdiction Type",
              "City | County | Town | State.",
              "Derivable from the AHJ name + US Census place data."),
    FieldSpec("Permit Submission Method",
              "How a solar permit is submitted "
              "(e.g. 'Online portal (e-permit)', 'SolarAPP+ (instant)', "
              "'Third-party portal (Accela)', 'In-person / paper').",
              "SunSpec AHJ Registry (ahjregistry.sunspec.org); the AHJ building "
              "department's permitting page."),
    FieldSpec("SolarAPP+ Enabled",
              "Yes | No — is this AHJ live on SolarAPP+.",
              "SolarAPP+ / NREL list of adopted AHJs (gosolarapp.org)."),
    FieldSpec("NEC Code Cycle",
              "The enforced NEC edition year (e.g. 2017 | 2020 | 2023 | 2026). "
              "Usually a STATE-level adoption — verify the state, note local amendments.",
              "NFPA / NEMA NEC adoption map; state building code; local amendments."),
    FieldSpec("Required Documents",
              "Documents required for the solar permit package.",
              "AHJ solar permit checklist; SunSpec AHJ Registry."),
    FieldSpec("Structural PE Stamp",
              "Yes | No | Case-by-case.",
              "AHJ permit requirements; state rule."),
    FieldSpec("Electrical PE Stamp",
              "Yes | No | Case-by-case.",
              "AHJ permit requirements; state rule."),
    FieldSpec("Fire Setback Requirements",
              "Roof setback / access-pathway requirement (e.g. 'Per IFC 1204/1205' "
              "or a local amendment).",
              "Adopted fire code (IFC) + local amendments."),
    FieldSpec("Wind/Snow Load Basis",
              "Design wind speed / snow load / seismic + ASCE 7 edition.",
              "AHJ 'design criteria' / building dept page; ASCE 7 hazard tool."),
    FieldSpec("Permit Fee",
              "The solar permit fee. LOW availability — null unless a real fee "
              "schedule is found. Never estimate.",
              "AHJ fee schedule."),
    FieldSpec("Plan Review TAT",
              "Plan-review turnaround. RARELY published — null unless stated.",
              "AHJ permitting page if it states a timeline."),
    FieldSpec("Inspection Required",
              "Yes | No — is a final inspection required (almost always Yes).",
              "AHJ permit process / state baseline."),
]

SHEET_FIELDS = {"utility": UTILITY_FIELDS, "ahj": AHJ_FIELDS}

# Fields that have a meaningful statewide baseline → eligible for state fallback.
STATE_LEVEL_FIELDS = {
    "utility": ["Net Metering / Billing Program", "PE Stamp Required",
                "External AC Disconnect", "Bi-Directional Meter"],
    "ahj":     ["NEC Code Cycle", "Structural PE Stamp", "Electrical PE Stamp",
                "Inspection Required"],
}


# --------------------------------------------------------------------------- #
# Entity normalization + dedup
# --------------------------------------------------------------------------- #

_NOISE_TOKENS = {
    "inc", "llc", "co", "corp", "corporation", "company", "cooperative",
    "coop", "cooperatives", "the", "of", "incorporated", "ltd",
    "department", "dept", "authority", "services", "service",
}
_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Lowercase, drop punctuation, strip corporate noise tokens, collapse ws."""
    s = _PUNCT_RE.sub(" ", (name or "").lower())
    toks = [t for t in _WS_RE.sub(" ", s).split() if t and t not in _NOISE_TOKENS]
    return " ".join(toks).strip()


@dataclass
class Entity:
    key: str
    state: str
    display_name: str
    row_indices: list = dc_field(default_factory=list)
    result: dict | None = None


def build_entities(rows: list, sheet: str) -> dict:
    """Cluster rows into unique entities by (state, normalized_name)."""
    name_col = NAME_COL[sheet]
    entities: dict = {}
    for i, row in enumerate(rows):
        state = (row.get("State") or "").strip().upper()
        raw_name = (row.get(name_col) or "").strip()
        if not raw_name:
            continue
        key = f"{state}|{normalize_name(raw_name)}"
        ent = entities.get(key)
        if ent is None:
            ent = Entity(key=key, state=state, display_name=raw_name)
            entities[key] = ent
        if len(raw_name) > len(ent.display_name):
            ent.display_name = raw_name
        ent.row_indices.append(i)
    return entities


# --------------------------------------------------------------------------- #
# CSV I/O  (handles the title banner in row 1; real header is row 2)
# --------------------------------------------------------------------------- #

def load_sheet(path: str, sheet: str):
    with open(path, newline="", encoding="utf-8") as f:
        raw = list(csv.reader(f))
    if len(raw) < 2:
        sys.exit(f"{path}: not enough rows.")
    header = [h.strip() for h in raw[1]]
    rows = [dict(zip(header, r)) for r in raw[2:] if any(c.strip() for c in r)]
    missing = [c for c in IDENTITY_COLS[sheet] if c not in header]
    if missing:
        sys.exit(f"{path}: expected columns missing: {missing}\n"
                 f"Is SHEET set correctly? (currently '{sheet}')")
    return header, rows


def write_output(path: str, sheet: str, rows: list, entities: dict) -> None:
    """identity cols (untouched) + for each green field: value + '<field> — Source',
    then _confidence and _needs_review."""
    fields = SHEET_FIELDS[sheet]
    id_cols = IDENTITY_COLS[sheet]

    out_header = list(id_cols)
    for fs in fields:
        out_header += [fs.name, f"{fs.name} — Source"]
    out_header += ["_confidence", "_needs_review"]

    idx_to_entity: dict = {}
    for ent in entities.values():
        for i in ent.row_indices:
            idx_to_entity[i] = ent

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(out_header)
        for i, row in enumerate(rows):
            ent = idx_to_entity.get(i)
            res = (ent.result if ent else None) or {}
            out = [row.get(c, "") for c in id_cols]
            conf_marks, needs_review = [], False
            for fs in fields:
                cell = res.get(fs.name) or {}
                val = cell.get("value")
                src = cell.get("source_url")
                conf = (cell.get("confidence") or "not_found").lower()
                out.append("" if val is None else str(val))
                out.append("" if not src else str(src))
                conf_marks.append(f"{fs.name}={conf}")
                if conf in ("low", "not_found"):
                    needs_review = True
            out.append(" | ".join(conf_marks))
            out.append("REVIEW" if needs_review else "")
            w.writerow(out)


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #

SYSTEM_PROMPT = """You are a meticulous data-research agent for solar \
permitting and utility interconnection. You enrich a database with REAL, \
source-cited facts.

ABSOLUTE RULES:
- Use Google Search grounding to verify EVERY value against a real, current source.
- For each field, return the value AND the exact source URL you took it from.
- If you cannot find a field in a credible source, set value to null, \
source_url to null, and confidence to "not_found". DO NOT GUESS — especially \
fees, turnaround times, and program names.
- Prefer authoritative/primary sources (the utility's or AHJ's own site, \
DSIRE, EIA, NREL/SolarAPP+, SunSpec AHJ Registry, NFPA) over blogs.
- The source_url for a field MUST be a page about THIS specific entity. Never \
use a different utility's or city's page as a source.
- Many utilities do NOT offer true net metering; they pay a sub-retail buyback. \
Report what the source actually says, not what is typical.
- confidence: "high" = stated on a primary/official source; "medium" = a \
credible secondary source or reasonable inference; "low" = weak/indirect; \
"not_found" = could not verify.
- Keep each value concise (a short phrase), matching the requested value shape.

OUTPUT: Return ONLY a single JSON object. Schema:
{ "<exact field name>": {"value": <string|null>, "source_url": <string|null>, \
"confidence": "high|medium|low|not_found"}, ... }
Include every requested field key, even if its value is null.
"""

STATE_SYSTEM_PROMPT = """You are a meticulous data-research agent for US solar \
permitting and utility interconnection regulations. Provide the STATE-LEVEL \
baseline for each field — the rule that applies across the state unless a \
specific utility or AHJ overrides it.

ABSOLUTE RULES:
- Use Google Search grounding and cite a real source: state PUC/PSC, the \
NFPA/NEMA NEC adoption map, the DSIRE state page, or the state building code.
- If there is NO statewide rule (it is set per utility/AHJ), say so explicitly: \
value = "No statewide rule; set by individual utility/AHJ", confidence "medium".
- If you cannot verify, use null + "not_found". DO NOT GUESS.
- confidence: "high" = stated on an official state source; "medium" = credible \
secondary source; "low" = weak/indirect; "not_found" = could not verify.

OUTPUT: Return ONLY a single JSON object. Schema:
{ "<exact field name>": {"value": <string|null>, "source_url": <string|null>, \
"confidence": "high|medium|low|not_found"}, ... }
Include every requested field key.
"""


def _build_user_prompt(entity: Entity, sheet: str, fields: list) -> str:
    kind = "electric utility" if sheet == "utility" else "permitting authority (AHJ)"
    lines = [
        f"Research the following {kind} and fill these fields with cited data.",
        f"State: {entity.state}",
        f"Name: {entity.display_name}",
        "",
        "Fields (return every key exactly as written):",
    ]
    for fs in fields:
        lines.append(f"- {fs.name}: {fs.description}  [look in: {fs.sources}]")
    lines += ["", "Return the JSON object described in the system prompt, "
              "with every field key present."]
    return "\n".join(lines)


def _build_state_prompt(state: str, sheet: str, fields: list) -> str:
    kind = "electric utilities" if sheet == "utility" else "solar permitting authorities (AHJs)"
    lines = [
        f"Give the STATE-LEVEL baseline rules for {kind} in this US state.",
        f"State: {state}",
        "",
        "For each field, provide the statewide default that applies unless a "
        "specific utility/AHJ overrides it. If there is no statewide rule, say so.",
        "",
        "Fields (return every key exactly as written):",
    ]
    for fs in fields:
        lines.append(f"- {fs.name}: {fs.description}  [look in: {fs.sources}]")
    lines += ["", "Return ONLY the JSON object, with every field key present."]
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# JSON helpers
# --------------------------------------------------------------------------- #

def _extract_json(text: str):
    """Pull the first balanced JSON object out of the model's text."""
    if not text:
        return None
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start = text.find("{")
    if start == -1:
        return None
    depth, in_str, esc = 0, False, False
    for j in range(start, len(text)):
        c = text[j]
        if in_str:
            esc = (c == "\\") and not esc
            if c == '"' and not esc:
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:j + 1])
                    except json.JSONDecodeError:
                        return None
    return None


def _resp_text(response) -> str:
    """Robustly pull text out of a Gemini response (grounded replies can carry
    extra non-text parts like thought signatures)."""
    try:
        if response.text:
            return response.text
    except Exception:
        pass
    out = []
    for cand in (getattr(response, "candidates", None) or []):
        content = getattr(cand, "content", None)
        for part in (getattr(content, "parts", None) or []):
            t = getattr(part, "text", None)
            if t:
                out.append(t)
    return "".join(out)


def _grounded_json(client, model: str, system_prompt: str, user_prompt: str):
    """One grounded call → (parsed_dict | None, error_str | None). Forced JSON."""
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=[types.Tool(google_search=types.GoogleSearch())],  # built-in grounding
        temperature=0,
        max_output_tokens=MAX_TOKENS,
        response_mime_type="application/json",   # force valid JSON (Gemini 3 + grounding)
    )
    last_err = None
    for attempt in range(REQUEST_RETRIES):
        try:
            response = client.models.generate_content(
                model=model, contents=user_prompt, config=config,
            )
            parsed = _extract_json(_resp_text(response))
            if parsed is None:
                raise ValueError("no JSON object in model response")
            return parsed, None
        except Exception as e:
            last_err = e
            if attempt < REQUEST_RETRIES - 1:
                time.sleep(RETRY_BACKOFF_SECONDS * (2 ** attempt))
    return None, str(last_err)


def _error_result(fields: list, err: str) -> dict:
    return {fs.name: {"value": None, "source_url": None,
                      "confidence": "not_found", "_error": err} for fs in fields}


# --------------------------------------------------------------------------- #
# Research calls
# --------------------------------------------------------------------------- #

def research_entity(client, entity: Entity, sheet: str, model: str) -> dict:
    fields = SHEET_FIELDS[sheet]
    parsed, err = _grounded_json(client, model, SYSTEM_PROMPT,
                                 _build_user_prompt(entity, sheet, fields))
    if parsed is None:
        return _error_result(fields, err)
    return _validate(parsed, fields, entity)


def research_state(client, state: str, sheet: str, model: str) -> dict:
    fields = [fs for fs in SHEET_FIELDS[sheet] if fs.name in STATE_LEVEL_FIELDS[sheet]]
    parsed, err = _grounded_json(client, model, STATE_SYSTEM_PROMPT,
                                 _build_state_prompt(state, sheet, fields))
    if parsed is None:
        return _error_result(fields, err)
    return _validate(parsed, fields, None)   # no entity-source guard at state level


# --------------------------------------------------------------------------- #
# Source sanity: does a citation actually belong to THIS entity?
# (Failing sources are NOT deleted — value + link stay; confidence drops to
#  "low" so the cell lands in REVIEW and a human verifies via the link.)
# --------------------------------------------------------------------------- #

AUTHORITY_DOMAINS = ("dsireusa.org", "eia.gov", "nrel.gov", "gosolarapp.org",
                     "sunspec.org", "ahjregistry", "nfpa.org", "energy.gov",
                     "census.gov", "openei.org", "tva.com", "energystar.gov")


def _domain(url: str) -> str:
    m = re.search(r"https?://([^/]+)", url or "")
    host = (m.group(1) if m else "").lower()
    return host[4:] if host.startswith("www.") else host


def _source_ok(entity: Entity, url: str) -> bool:
    """Trusted authority OR plausibly this entity's own site."""
    host = _domain(url)
    if not host:
        return False
    if host.endswith(".gov") or any(a in host for a in AUTHORITY_DOMAINS):
        return True
    tokens = [t for t in normalize_name(entity.display_name).split() if len(t) >= 5]
    dom = host.replace(".", "").replace("-", "")
    return any(t in dom for t in tokens)


def _validate(parsed: dict, fields: list, entity: Entity | None) -> dict:
    out = {}
    for fs in fields:
        cell = parsed.get(fs.name)
        if not isinstance(cell, dict):
            out[fs.name] = {"value": None, "source_url": None,
                            "confidence": "not_found"}
            continue
        conf = str(cell.get("confidence", "not_found")).lower()
        if conf not in CONFIDENCE_LEVELS:
            conf = "low"
        val = cell.get("value")
        src = cell.get("source_url")
        if val not in (None, "") and not src:        # value with no source = untrusted
            conf = "low"
        # source doesn't belong to this entity → keep value + link, but flag REVIEW
        if entity is not None and val not in (None, "", "null", "N/A") and src and conf in ("high", "medium"):
            if not _source_ok(entity, src):
                conf = "low"
        out[fs.name] = {
            "value": None if val in ("", "null", "N/A") else val,
            "source_url": src or None,
            "confidence": conf,
        }
    return out


def _had_error(result: dict) -> bool:
    """True if the call failed technically — so we should NOT cache it (retry next run)."""
    return any(isinstance(c, dict) and c.get("_error") for c in (result or {}).values())


# --------------------------------------------------------------------------- #
# Merge (for RETRY_NOT_FOUND) + state fallback
# --------------------------------------------------------------------------- #

_RANK = {"high": 3, "medium": 2, "low": 1, "not_found": 0}


def _cell_rank(cell: dict) -> int:
    if not cell or not cell.get("value"):
        return 0
    return _RANK.get((cell.get("confidence") or "not_found").lower(), 0)


def _merge(old: dict, new: dict) -> dict:
    """Field-by-field, keep whichever cell is stronger (has value > none; higher conf)."""
    out = {}
    for k in set(old) | set(new):
        o, n = old.get(k) or {}, new.get(k) or {}
        out[k] = n if _cell_rank(n) > _cell_rank(o) else o
    return out


def _entity_has_blanks(result: dict, fields: list) -> bool:
    return any(not (result.get(fs.name) or {}).get("value") for fs in fields)


def apply_state_fallback(entities: dict, state_results: dict, sheet: str) -> int:
    """Fill blank state-level fields from the per-state lookup. Always low + note."""
    sl = STATE_LEVEL_FIELDS[sheet]
    filled = 0
    for ent in entities.values():
        if not ent.result:
            continue
        st = state_results.get(ent.state)
        if not st:
            continue
        for fname in sl:
            if (ent.result.get(fname) or {}).get("value"):
                continue                                   # already have a real value
            scell = st.get(fname) or {}
            sval = scell.get("value")
            if sval and (scell.get("confidence") or "not_found") != "not_found":
                ent.result[fname] = {
                    "value": f"{sval}  (state-level default — verify locally)",
                    "source_url": scell.get("source_url"),
                    "confidence": "low",                   # always flagged for review
                }
                filled += 1
    return filled


# --------------------------------------------------------------------------- #
# Vertex AI client (service-account auth)
# --------------------------------------------------------------------------- #

def build_client():
    """Vertex AI + service account when USE_VERTEX is True; else API key."""
    if not USE_VERTEX:
        return genai.Client()   # reads GEMINI_API_KEY / GOOGLE_API_KEY from env

    try:
        from google.oauth2 import service_account
    except ImportError:
        sys.exit("Vertex AI needs google-auth. Run:\n    pip install google-auth")

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        sys.exit(f"Service account key not found: {SERVICE_ACCOUNT_FILE!r}\n"
                 f"Working directory: {os.getcwd()}\n"
                 f"→ Put the JSON key here, or fix SERVICE_ACCOUNT_FILE.")

    creds = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project = VERTEX_PROJECT or creds.project_id
    if not project:
        sys.exit("No project id. Set VERTEX_PROJECT or use a key with project_id.")

    print(f"Auth:    Vertex AI  (project={project}, location={VERTEX_LOCATION})")
    return genai.Client(
        vertexai=True,
        project=project,
        location=VERTEX_LOCATION,
        credentials=creds,
    )


# --------------------------------------------------------------------------- #
# Cache (JSONL, resumable)
# --------------------------------------------------------------------------- #

class Cache:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.done: dict = {}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        self.done[rec["key"]] = rec["result"]   # last line wins
                    except (json.JSONDecodeError, KeyError):
                        pass

    def get(self, key: str):
        return self.done.get(key)

    def put(self, key: str, result: dict) -> None:
        with self.lock:
            self.done[key] = result
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps({"key": key, "result": result}) + "\n")


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

def coverage_report(entities: dict, sheet: str) -> None:
    fields = SHEET_FIELDS[sheet]
    done = [e for e in entities.values() if e.result]
    n = len(done) or 1
    print("\n" + "=" * 64)
    print(f"COVERAGE — {sheet} ({len(done)} entities researched)")
    print("=" * 64)
    print(f"{'field':38s} {'filled':>7s} {'hi/med':>7s}")
    for fs in fields:
        filled = sum(1 for e in done if (e.result.get(fs.name) or {}).get("value"))
        strong = sum(1 for e in done
                     if (e.result.get(fs.name) or {}).get("confidence") in ("high", "medium")
                     and (e.result.get(fs.name) or {}).get("value"))
        print(f"{fs.name[:38]:38s} {filled/n:6.0%} {strong/n:6.0%}")
    print("=" * 64)
    print("'filled' includes low-confidence + state-level defaults; 'hi/med' is the "
          "trustworthy core. Check the _confidence column per field.\n")


# --------------------------------------------------------------------------- #
# State-level pass
# --------------------------------------------------------------------------- #

def run_state_pass(client, states: list, sheet: str, model: str,
                   state_cache: Cache, workers: int) -> dict:
    state_results: dict = {}
    todo = []
    for st in states:
        cached = state_cache.get(st)
        if cached is not None and not _had_error(cached):
            state_results[st] = cached
        else:
            todo.append(st)
    if not todo:
        print(f"State-level pass: all {len(states)} states from cache.")
        return state_results

    print(f"State-level pass: {len(states) - len(todo)} cached, {len(todo)} to research...")
    sl_fields = [fs for fs in SHEET_FIELDS[sheet] if fs.name in STATE_LEVEL_FIELDS[sheet]]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(research_state, client, st, sheet, model): st for st in todo}
        for fut in as_completed(futs):
            st = futs[fut]
            try:
                res = fut.result()
            except Exception as e:
                res = _error_result(sl_fields, str(e))
                print(f"  ! state {st}: {e}", file=sys.stderr)
            state_results[st] = res
            if not _had_error(res):
                state_cache.put(st, res)
    return state_results


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(add_help=True,
                                 description="Enrich permitting sheets with cited data (Gemini / Vertex AI).")
    ap.add_argument("--sheet", default=SHEET, choices=["utility", "ahj"])
    ap.add_argument("--input", default=INPUT)
    ap.add_argument("--output", default=OUTPUT)
    ap.add_argument("--limit", type=int, default=LIMIT)
    ap.add_argument("--workers", type=int, default=WORKERS)
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--dry-run", action="store_true", default=DRY_RUN)
    args, _ = ap.parse_known_args()

    cache_path = args.output + ".cache.jsonl"
    state_cache_path = args.output + ".states.cache.jsonl"

    # 1) input file present?
    if not os.path.exists(args.input):
        here = os.getcwd()
        csvs = [f for f in os.listdir(here) if f.lower().endswith(".csv")]
        sys.exit(f"\nCan't find input file: {args.input!r}\n"
                 f"Working directory: {here}\n"
                 f"CSV files here: {csvs or 'none'}\n"
                 f"→ Put your CSV in this folder and set INPUT to its path.\n")

    # 2) load + dedup
    header, rows = load_sheet(args.input, args.sheet)
    entities = build_entities(rows, args.sheet)
    targets = list(entities.values())
    if args.limit:
        targets = targets[:args.limit]

    n = len(targets)
    states = sorted({ent.state for ent in targets if ent.state})
    lo, hi = n * 0.03, n * 0.08   # rough $ ballpark for gemini-3.5-flash + grounding
    print(f"\nSheet:   {args.sheet}   ({args.input})")
    print(f"Rows:    {len(rows)}  →  {len(entities)} unique entities "
          f"(dedup {len(rows)/max(len(entities),1):.2f}x)")
    print(f"Running: {n} entities" + ("  [FULL DATASET]" if args.limit == 0 else f"  (LIMIT={args.limit})"))
    print(f"Model:   {args.model}   Workers: {args.workers}")
    print(f"State fallback: {'ON' if STATE_FALLBACK else 'off'} "
          f"({len(states)} states)   Retry blanks: {'ON' if RETRY_NOT_FOUND else 'off'}")
    print(f"Rough cost estimate: ${lo:,.2f}–${hi:,.2f}\n")

    # 3) dry run stops here — no API calls, no charges
    if args.dry_run:
        print("DRY_RUN is True → no API calls made, nothing charged.")
        print("Set DRY_RUN = False to research the above entities.\n")
        return

    # 4) auth check for real runs
    if USE_VERTEX:
        if not os.path.exists(SERVICE_ACCOUNT_FILE):
            sys.exit(f"Vertex AI selected but {SERVICE_ACCOUNT_FILE!r} not found.\n"
                     f"→ Put the service-account JSON key in this folder, or set "
                     f"USE_VERTEX = False to use an API key instead.\n")
    elif not (os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")):
        sys.exit("GEMINI_API_KEY not set (and USE_VERTEX is False).\n"
                 "→ Either set USE_VERTEX = True (Vertex service account),\n"
                 "  or put GEMINI_API_KEY=AIza... in a .env file next to this script.\n")

    # 5) confirm before a big run
    if args.limit == 0 and n > 50:
        ans = input(f"About to research {n} entities + {len(states)} states "
                    f"(est. ${lo:,.0f}–${hi:,.0f}). Proceed? [y/N] ")
        if ans.strip().lower() not in ("y", "yes"):
            sys.exit("Aborted.")

    cache = Cache(cache_path)
    client = build_client()   # Vertex AI (service account) or API key

    # 6) per-entity research (resumable; optional retry-of-blanks with merge)
    todo = []
    for ent in targets:
        cached = cache.get(ent.key)
        if cached is not None and not _had_error(cached):
            ent.result = cached
            if RETRY_NOT_FOUND and _entity_has_blanks(cached, SHEET_FIELDS[args.sheet]):
                todo.append(ent)        # re-research to fill blanks; merged below
        else:
            todo.append(ent)
    print(f"{n - len(todo)} loaded from cache, {len(todo)} to research...\n")

    done_count = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(research_entity, client, ent, args.sheet, args.model): ent
                for ent in todo}
        for fut in as_completed(futs):
            ent = futs[fut]
            try:
                new = fut.result()
            except Exception as e:
                new = _error_result(SHEET_FIELDS[args.sheet], str(e))
                print(f"  ! {ent.display_name}: {e}", file=sys.stderr)
            if _had_error(new):
                if not ent.result:      # keep any good cached result on a failed retry
                    ent.result = new
            else:
                ent.result = _merge(ent.result, new) if ent.result else new
                cache.put(ent.key, ent.result)   # cache pure findings (no state overlay)
            done_count += 1
            if done_count % 5 == 0 or done_count == len(todo):
                print(f"  ...{done_count}/{len(todo)} researched")

    # 7) state-level pass + fallback fill
    sf_count = 0
    if STATE_FALLBACK and states:
        state_cache = Cache(state_cache_path)
        state_results = run_state_pass(client, states, args.sheet, args.model,
                                       state_cache, args.workers)
        sf_count = apply_state_fallback(entities, state_results, args.sheet)

    # 8) write + report
    write_output(args.output, args.sheet, rows, entities)
    coverage_report(entities, args.sheet)
    if sf_count:
        print(f"State-level fallback filled {sf_count} blank cells "
              f"(tagged low / 'verify locally').")
    failed = sum(1 for e in entities.values() if e.result and _had_error(e.result))
    if failed:
        print(f"Note: {failed} entit{'y' if failed == 1 else 'ies'} errored and were "
              f"NOT cached — just run again to retry them.")
    print(f"✓ Wrote {args.output}   (cache: {cache_path})")


if __name__ == "__main__":
    main()