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
    session_id: Optional[str] = None
    check_index: Optional[int] = None

class QCCheck(BaseModel):
    check_name: str
    qc_prompt: str
    category: str

class GenerateChecksResponse(BaseModel):
    session_id: str
    checks: List[QCCheck]

class UpdateCheckRequest(BaseModel):
    session_id: str
    check_index: int
    check_name: Optional[str] = None
    qc_prompt: Optional[str] = None
    category: Optional[str] = None
    is_manual_prompt_edit: bool = False


