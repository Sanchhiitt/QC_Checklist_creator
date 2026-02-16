from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os
from dotenv import load_dotenv
from models import JurisdictionRequest, QCRequest, QCCheck, RegenerateRequest
from services import gemini_service

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
    return checks

@app.post("/api/regenerate-prompt")
def regenerate_prompt(request: RegenerateRequest):
    new_prompt = gemini_service.regenerate_prompt(
        request.current_prompt,
        request.user_instruction
    )
    return {"new_prompt": new_prompt}





