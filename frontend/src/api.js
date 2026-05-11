import axios from 'axios';

// Read API base URL from Vite env (VITE_API_URL in frontend/.env), fall back to local backend.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const generateChecks = async (rawText) => {
    const response = await axios.post(`${API_URL}/generate-checks`, {
        raw_text: rawText
    });
    return response.data; // { session_id, checks: [...] }
};

export const regeneratePrompt = async (currentPrompt, userInstruction, sessionId, checkIndex) => {
    const response = await axios.post(`${API_URL}/regenerate-prompt`, {
        current_prompt: currentPrompt,
        user_instruction: userInstruction,
        session_id: sessionId ?? null,
        check_index: checkIndex ?? null,
    });
    return response.data.new_prompt;
};

export const updateCheck = async (sessionId, checkIndex, fields, isManualPromptEdit = false) => {
    if (!sessionId) return null; // No session to persist against (e.g., DB offline at generation time)
    const response = await axios.post(`${API_URL}/checks/update`, {
        session_id: sessionId,
        check_index: checkIndex,
        check_name: fields.check_name ?? null,
        qc_prompt: fields.qc_prompt ?? null,
        category: fields.category ?? null,
        is_manual_prompt_edit: isManualPromptEdit,
    });
    return response.data;
};

export const fetchStats = async () => {
    const response = await axios.get(`${API_URL}/stats`);
    return response.data;
};

export const fetchSessions = async (limit = 50) => {
    const response = await axios.get(`${API_URL}/sessions`, { params: { limit } });
    return response.data.sessions;
};

export const fetchSession = async (sessionId) => {
    const response = await axios.get(`${API_URL}/sessions/${sessionId}`);
    return response.data;
};
