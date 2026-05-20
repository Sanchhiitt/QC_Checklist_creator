import axios from 'axios';

// Resolution order:
//   1. window.RUNTIME_CONFIG.VITE_API_URL  — injected by Docker entrypoint from .env at container start
//   2. import.meta.env.VITE_API_URL        — Vite reads frontend/.env at build/dev time
// No hardcoded URL. If neither is set, configure VITE_API_URL in frontend/.env.
const runtimeConfig = (typeof window !== 'undefined' && window.RUNTIME_CONFIG) || {};
const API_URL = runtimeConfig.VITE_API_URL || import.meta.env.VITE_API_URL;

if (!API_URL) {
    // eslint-disable-next-line no-console
    console.error('[api] VITE_API_URL is not set. Add it to frontend/.env.');
}

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

// ─── QC Analytics (proxied through this backend to solar_ai_agents) ────────
// Scope: AHJ + Utility checks only.
// All endpoints accept optional ISO-8601 `from` / `to`; backend defaults to
// the rolling last 30 days when omitted.

// Distinct states across QC runs — used to populate the state filter dropdown.
export const fetchQCStates = async ({ from, to } = {}) => {
    const response = await axios.get(`${API_URL}/qc-analytics/states`, {
        params: { from, to },
    });
    return response.data; // { window, states: [...] }
};

// Per-check stats + full run history for one dimension ('ahj' | 'utility'),
// optionally scoped to a single state.
export const fetchQCSection = async ({ dimension, state, from, to } = {}) => {
    const response = await axios.get(`${API_URL}/qc-analytics/section`, {
        params: { dimension, state, from, to },
    });
    return response.data; // { dimension, state, summary, checks: [...] }
};

// Per-state pass/fail ranking for one dimension ('ahj' | 'utility').
export const fetchQCStateTrend = async ({ dimension, from, to } = {}) => {
    const response = await axios.get(`${API_URL}/qc-analytics/state-trend`, {
        params: { dimension, from, to },
    });
    return response.data; // { dimension, rows: [...] }
};
