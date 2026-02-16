import axios from 'axios';

const API_URL = 'http://193.59.67.81:6000/api';

export const generateChecks = async (rawText) => {
    const response = await axios.post(`${API_URL}/generate-checks`, {
        raw_text: rawText
    });
    return response.data;
};

export const regeneratePrompt = async (currentPrompt, userInstruction) => {
    const response = await axios.post(`${API_URL}/regenerate-prompt`, {
        current_prompt: currentPrompt,
        user_instruction: userInstruction
    });
    return response.data.new_prompt;
};
