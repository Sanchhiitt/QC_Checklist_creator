import os
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from pymongo import MongoClient, DESCENDING
from pymongo.collection import Collection

_client: Optional[MongoClient] = None
_collection: Optional[Collection] = None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_collection() -> Collection:
    global _client, _collection
    if _collection is not None:
        return _collection

    uri = os.getenv("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI not configured")

    db_name = os.getenv("MONGODB_DB", "qc_checklist")
    _client = MongoClient(uri, serverSelectionTimeoutMS=10000)
    _collection = _client[db_name]["check_sessions"]
    _collection.create_index([("session_id", 1)], unique=True)
    _collection.create_index([("created_at", DESCENDING)])
    return _collection


def create_session(
    raw_text: str,
    checks: List[dict],
    state: Optional[str] = None,
    jurisdiction_type: Optional[str] = None,
    jurisdiction_name: Optional[str] = None,
) -> str:
    coll = get_collection()
    session_id = uuid4().hex
    now = _now()

    stored_checks = [
        {
            "check_index": i,
            "check_name": c.get("check_name"),
            "qc_prompt": c.get("qc_prompt"),
            "category": c.get("category"),
            "original_qc_prompt": c.get("qc_prompt"),
            "is_regenerated": False,
            "regeneration_count": 0,
            "regeneration_history": [],
            "last_regenerated_at": None,
            "is_manually_edited": False,
            "manual_edit_count": 0,
            "manual_edit_history": [],
            "last_manually_edited_at": None,
        }
        for i, c in enumerate(checks)
    ]

    coll.insert_one({
        "session_id": session_id,
        "raw_text": raw_text,
        "state": state,
        "jurisdiction_type": jurisdiction_type,
        "jurisdiction_name": jurisdiction_name,
        "checks": stored_checks,
        "created_at": now,
        "updated_at": now,
        "total_checks": len(stored_checks),
        "regenerated_checks_count": 0,
        "total_regenerations": 0,
        "manually_edited_checks_count": 0,
        "total_manual_edits": 0,
    })
    return session_id


def record_regeneration(
    session_id: str,
    check_index: int,
    old_prompt: str,
    new_prompt: str,
    instruction: str,
) -> bool:
    coll = get_collection()
    now = _now()

    history_entry = {
        "old_prompt": old_prompt,
        "new_prompt": new_prompt,
        "instruction": instruction,
        "timestamp": now,
    }

    session = coll.find_one({"session_id": session_id}, {"checks": 1})
    if not session:
        return False

    was_already_regenerated = False
    for c in session.get("checks", []):
        if c.get("check_index") == check_index:
            was_already_regenerated = bool(c.get("is_regenerated"))
            break

    update_doc = {
        "$set": {
            "checks.$[c].qc_prompt": new_prompt,
            "checks.$[c].is_regenerated": True,
            "checks.$[c].last_regenerated_at": now,
            "updated_at": now,
        },
        "$inc": {
            "checks.$[c].regeneration_count": 1,
            "total_regenerations": 1,
        },
        "$push": {
            "checks.$[c].regeneration_history": history_entry,
        },
    }
    if not was_already_regenerated:
        update_doc["$inc"]["regenerated_checks_count"] = 1

    result = coll.update_one(
        {"session_id": session_id},
        update_doc,
        array_filters=[{"c.check_index": check_index}],
    )
    return result.modified_count > 0


def update_check(
    session_id: str,
    check_index: int,
    check_name: Optional[str] = None,
    qc_prompt: Optional[str] = None,
    category: Optional[str] = None,
    is_manual_prompt_edit: bool = False,
) -> bool:
    coll = get_collection()
    now = _now()

    session = coll.find_one({"session_id": session_id}, {"checks": 1})
    if not session:
        return False

    existing = None
    for c in session.get("checks", []):
        if c.get("check_index") == check_index:
            existing = c
            break
    if not existing:
        return False

    set_ops: dict = {"updated_at": now}
    inc_ops: dict = {}
    push_ops: dict = {}

    if check_name is not None and check_name != existing.get("check_name"):
        set_ops["checks.$[c].check_name"] = check_name
    if category is not None and category != existing.get("category"):
        set_ops["checks.$[c].category"] = category

    if qc_prompt is not None and qc_prompt != existing.get("qc_prompt"):
        set_ops["checks.$[c].qc_prompt"] = qc_prompt
        if is_manual_prompt_edit:
            was_edited = bool(existing.get("is_manually_edited"))
            set_ops["checks.$[c].is_manually_edited"] = True
            set_ops["checks.$[c].last_manually_edited_at"] = now
            inc_ops["checks.$[c].manual_edit_count"] = 1
            inc_ops["total_manual_edits"] = 1
            if not was_edited:
                inc_ops["manually_edited_checks_count"] = 1
            push_ops["checks.$[c].manual_edit_history"] = {
                "old_prompt": existing.get("qc_prompt"),
                "new_prompt": qc_prompt,
                "timestamp": now,
            }

    # If nothing changed besides updated_at, skip the write
    if len(set_ops) == 1 and not inc_ops and not push_ops:
        return False

    update_doc: dict = {"$set": set_ops}
    if inc_ops:
        update_doc["$inc"] = inc_ops
    if push_ops:
        update_doc["$push"] = push_ops

    result = coll.update_one(
        {"session_id": session_id},
        update_doc,
        array_filters=[{"c.check_index": check_index}],
    )
    return result.modified_count > 0


def list_sessions(limit: int = 50) -> List[dict]:
    coll = get_collection()
    cursor = coll.find(
        {},
        {
            "session_id": 1,
            "created_at": 1,
            "updated_at": 1,
            "total_checks": 1,
            "regenerated_checks_count": 1,
            "total_regenerations": 1,
            "manually_edited_checks_count": 1,
            "total_manual_edits": 1,
            "state": 1,
            "jurisdiction_type": 1,
            "jurisdiction_name": 1,
            "raw_text": 1,
            "_id": 0,
        },
    ).sort("created_at", DESCENDING).limit(limit)

    sessions = []
    for s in cursor:
        raw = s.get("raw_text") or ""
        s["raw_text_preview"] = (raw[:160] + "...") if len(raw) > 160 else raw
        s.pop("raw_text", None)
        if s.get("created_at"):
            s["created_at"] = s["created_at"].isoformat()
        if s.get("updated_at"):
            s["updated_at"] = s["updated_at"].isoformat()
        sessions.append(s)
    return sessions


def get_session(session_id: str) -> Optional[dict]:
    coll = get_collection()
    session = coll.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        return None
    if session.get("created_at"):
        session["created_at"] = session["created_at"].isoformat()
    if session.get("updated_at"):
        session["updated_at"] = session["updated_at"].isoformat()
    for c in session.get("checks", []):
        if c.get("last_regenerated_at"):
            c["last_regenerated_at"] = c["last_regenerated_at"].isoformat()
        if c.get("last_manually_edited_at"):
            c["last_manually_edited_at"] = c["last_manually_edited_at"].isoformat()
        for h in c.get("regeneration_history", []):
            if h.get("timestamp"):
                h["timestamp"] = h["timestamp"].isoformat()
        for h in c.get("manual_edit_history", []):
            if h.get("timestamp"):
                h["timestamp"] = h["timestamp"].isoformat()
    return session


def get_stats() -> dict:
    coll = get_collection()
    pipeline = [
        {
            "$group": {
                "_id": None,
                "total_sessions": {"$sum": 1},
                "total_checks": {"$sum": "$total_checks"},
                "total_regenerated_checks": {"$sum": "$regenerated_checks_count"},
                "total_regenerations": {"$sum": "$total_regenerations"},
                "total_manually_edited_checks": {"$sum": "$manually_edited_checks_count"},
                "total_manual_edits": {"$sum": "$total_manual_edits"},
            }
        }
    ]
    agg = list(coll.aggregate(pipeline))
    if not agg:
        return {
            "total_sessions": 0,
            "total_checks": 0,
            "total_regenerated_checks": 0,
            "total_regenerations": 0,
            "total_manually_edited_checks": 0,
            "total_manual_edits": 0,
            "regeneration_rate": 0.0,
            "manual_edit_rate": 0.0,
            "engagement_rate": 0.0,
            "avg_regenerations_per_session": 0.0,
        }

    s = agg[0]
    total_checks = s.get("total_checks") or 0
    total_regen_checks = s.get("total_regenerated_checks") or 0
    total_sessions = s.get("total_sessions") or 0
    total_regens = s.get("total_regenerations") or 0
    total_manual_checks = s.get("total_manually_edited_checks") or 0
    total_manual_edits = s.get("total_manual_edits") or 0

    # An "engaged" check is one that was either regenerated OR manually edited.
    # We can't deduplicate the overlap without a per-check scan, so we cap at total_checks.
    engaged_checks_upper = min(total_regen_checks + total_manual_checks, total_checks)

    return {
        "total_sessions": total_sessions,
        "total_checks": total_checks,
        "total_regenerated_checks": total_regen_checks,
        "total_regenerations": total_regens,
        "total_manually_edited_checks": total_manual_checks,
        "total_manual_edits": total_manual_edits,
        "regeneration_rate": round((total_regen_checks / total_checks) * 100, 2) if total_checks else 0.0,
        "manual_edit_rate": round((total_manual_checks / total_checks) * 100, 2) if total_checks else 0.0,
        "engagement_rate": round((engaged_checks_upper / total_checks) * 100, 2) if total_checks else 0.0,
        "avg_regenerations_per_session": round(total_regens / total_sessions, 2) if total_sessions else 0.0,
    }
