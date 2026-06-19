from google import genai
from google.genai import types
import os
from typing import List
from models import QCCheck
from services.observability import traced_llm, record_gemini_usage

# Thinking budget (tokens the model may spend reasoning before answering).
# gemini-2.5-flash accepts: -1 = dynamic, 0 = off, or 1..24576 = fixed cap.
THINKING_BUDGET = 1

# Model used by both endpoints — kept in one place so the LangSmith
# decorators, record_gemini_usage calls, and generate_content calls stay in sync.
_GEMINI_MODEL = "gemini-2.5-flash"


def _get_client() -> genai.Client:
    """Build a google-genai client. transport='rest' (HTTP, no gRPC) avoids the
    gRPC-blocked-network issue that the old SDK had on restricted hosts."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY not found in environment variables")
    # Default API version (v1beta) — required for thinking_config / ThinkingConfig,
    # which the v1 endpoint does not yet accept.
    return genai.Client(api_key=api_key)


SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
]

GEMINI_PROMPT_TEMPLATE = """
You are an expert Quality Control (QC) checklist generator for solar installation permits. Your task is to extract clear, concise, and actionable QC checks from the provided raw text data.

For each check, create a 'Check Name', a detailed 'QC Prompt', and a relevant 'Category'.

The 'Check Name' should be a short, descriptive title.
The 'QC Prompt' should explain what needs to be verified, including specific text or conditions to look for, and the criteria for marking it as 'Consistent', 'Inconsistent', or 'Not Applicable'.
The 'Category' should be a high-level grouping relevant to permit documentation. **You MUST choose a category from this exact list:** ['Cover Page', 'Site Plan', 'Roof Plan And Modules', 'Attachment Detail', 'String Layout And Bom', 'Electrical Line Diagram And Calculations', 'Electrical Specifications And Notes', 'Signage And Placard', 'Equipment Specification', 'Electrical Load Calculation', 'Equipment Elevation']. Do NOT create new categories outside of this list.

Prioritize safety, compliance with utility/AHJ requirements, and accurate equipment specifications. Ensure the output is easy to parse.

Here is the raw data:
---
{raw_data}
---

Please provide the output in a structured, plain text format, where each check is an item with 'Check Name', 'QC Prompt', and 'Category' fields, separated by newlines. Do not include any introductory or concluding remarks, just the formatted checks.

Example format:
Check Name: Check for Utility Access Notes
QC Prompt: Verify the presence of a note stating that the utility has 24-hour unrestricted access to all photovoltaic system components located at the service entrance. If this note is present, mark as Consistent. If it is missing, mark as Inconsistent. If not applicable for the utility, mark as Not Applicable.
Category: General Notes

Check Name: Check for Workspace Clearance Notes
QC Prompt: Verify the presence of a note specifying that workspace in front of AC electrical system components shall be in accordance with APS and NEC requirements. The note should reference Section 300 of the APS ESRM and Section 8.2 of the APS Interconnection Requirements. If this note is present, mark as Consistent. If it is missing, mark as Inconsistent. If not applicable for the utility, mark as Not Applicable.
Category: General Notes
"""

@traced_llm("gemini_generate_checks", model=_GEMINI_MODEL)
def generate_checks(raw_text: str, state: str = None, jurisdiction_type: str = None, jurisdiction_name: str = None) -> List[QCCheck]:
    client = _get_client()

    prompt = GEMINI_PROMPT_TEMPLATE.format(
        raw_data=raw_text
    )

    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            candidate_count=1,
            temperature=0.25,
            safety_settings=SAFETY_SETTINGS,
            thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET),
        ),
    )
    # Forward Gemini's usage_metadata to LangSmith for cost tracking.
    record_gemini_usage(response, model=_GEMINI_MODEL)

    return parse_gemini_response(response.text)

@traced_llm("gemini_regenerate_prompt", model=_GEMINI_MODEL)
def regenerate_prompt(current_prompt: str, user_instruction: str) -> str:
    client = _get_client()

    prompt = f"""
    You are an expert QC analyst. A user wants to improve a specific QC Prompt.

    Current QC Prompt:
    "{current_prompt}"

    User Instruction for improvement:
    "{user_instruction}"

    Please provide ONLY the improved QC Prompt text. Do not include any other text or formatting.
    """

    response = client.models.generate_content(
        model=_GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            candidate_count=1,
            temperature=0.3,
            thinking_config=types.ThinkingConfig(thinking_budget=THINKING_BUDGET),
        ),
    )
    # Forward Gemini's usage_metadata to LangSmith for cost tracking.
    record_gemini_usage(response, model=_GEMINI_MODEL)

    return response.text.strip()


def parse_gemini_response(text: str) -> List[QCCheck]:
    checks = []
    lines = text.strip().split('\n')
    current_check = {}
    
    for line in lines:
        line = line.strip()
        if not line:
            if current_check and 'check_name' in current_check and 'qc_prompt' in current_check and 'category' in current_check:
                checks.append(QCCheck(**current_check))
                current_check = {}
            continue
            
        if line.startswith("Check Name:"):
            current_check['check_name'] = line.replace("Check Name:", "").strip()
        elif line.startswith("QC Prompt:"):
            current_check['qc_prompt'] = line.replace("QC Prompt:", "").strip()
        elif line.startswith("Category:"):
            current_check['category'] = line.replace("Category:", "").strip()
            
    if current_check and 'check_name' in current_check and 'qc_prompt' in current_check and 'category' in current_check:
        checks.append(QCCheck(**current_check))
        
    return checks
