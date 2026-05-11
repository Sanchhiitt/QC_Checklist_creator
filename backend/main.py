from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from models import JurisdictionRequest, QCRequest, QCCheck, RegenerateRequest, UpdateCheckRequest
from services import gemini_service, db_service

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"Hello": "World"}

# Static data for demonstration
JURISDICTIONS = {
    "Arizona": {
        "AHJ": ["Phoenix", "Scottsdale", "Tucson"],
        "Utility": ["Arizona Public Service", "Tucson Utility Services", "Salt River Project"]
    },
    "California": {
        "AHJ": ["Los Angeles", "San Diego", "San Francisco"],
        "Utility": ["PG&E", "SCE", "SDG&E"]
    },
    "Florida": {
        "AHJ": ["Miami", "Orlando", "Tampa"],
        "Utility": ["FPL", "Duke Energy", "TECO"]
    }
}

@app.get("/api/jurisdictions")
def get_jurisdictions():
    return JURISDICTIONS

@app.post("/api/generate-checks")
def generate_checks(request: QCRequest):
    checks = gemini_service.generate_checks(
        request.raw_text,
        request.state,
        request.jurisdiction_type,
        request.jurisdiction_name
    )

    checks_payload = [c.model_dump() for c in checks]

    try:
        session_id = db_service.create_session(
            raw_text=request.raw_text,
            checks=checks_payload,
            state=request.state,
            jurisdiction_type=request.jurisdiction_type,
            jurisdiction_name=request.jurisdiction_name,
        )
    except Exception as e:
        print(f"[generate_checks] DB save failed: {e}")
        session_id = None

    return {"session_id": session_id, "checks": checks_payload}

@app.post("/api/regenerate-prompt")
def regenerate_prompt(request: RegenerateRequest):
    new_prompt = gemini_service.regenerate_prompt(
        request.current_prompt,
        request.user_instruction
    )

    if request.session_id is not None and request.check_index is not None:
        try:
            db_service.record_regeneration(
                session_id=request.session_id,
                check_index=request.check_index,
                old_prompt=request.current_prompt,
                new_prompt=new_prompt,
                instruction=request.user_instruction,
            )
        except Exception as e:
            print(f"[regenerate_prompt] DB update failed: {e}")

    return {"new_prompt": new_prompt}


@app.post("/api/checks/update")
def update_check(request: UpdateCheckRequest):
    try:
        ok = db_service.update_check(
            session_id=request.session_id,
            check_index=request.check_index,
            check_name=request.check_name,
            qc_prompt=request.qc_prompt,
            category=request.category,
            is_manual_prompt_edit=request.is_manual_prompt_edit,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
    return {"success": ok}


@app.get("/api/sessions")
def list_sessions(limit: int = 50):
    try:
        return {"sessions": db_service.list_sessions(limit=limit)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    try:
        session = db_service.get_session(session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/stats")
def get_stats():
    try:
        return db_service.get_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB error: {e}")
