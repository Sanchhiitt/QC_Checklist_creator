from pydantic import BaseModel
from typing import List, Optional

class JurisdictionRequest(BaseModel):
    state: str
    jurisdiction_type: str

class QCRequest(BaseModel):
    raw_text: str
    state: Optional[str] = None
    jurisdiction_type: Optional[str] = None
    jurisdiction_name: Optional[str] = None

class RegenerateRequest(BaseModel):
    current_prompt: str
    user_instruction: str

class QCCheck(BaseModel):
    check_name: str
    qc_prompt: str
    category: str


