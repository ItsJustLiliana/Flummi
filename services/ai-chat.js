const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../utils/env-loader');

loadEnv();

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-20b:free';
const DEFAULT_FALLBACK_MODELS = [
    'openai/gpt-oss-20b:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen3-coder:free',
    'google/gemma-4-26b-a4b-it:free'
];
const MODEL_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const rateLimitedModels = new Map();

class AiChatError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AiChatError';
        this.code = code;
    }
}

function getConfig() {
    const configPath = path.join(__dirname, '..', 'config.json');

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return require('../config.json');
    }
}

function getAiConfig() {
    const config = getConfig();
    const aiConfig = config.ai || {};
    const apiKey = process.env.OPENROUTER_API_KEY || aiConfig.openRouterApiKey || '';
    const fallbackModels = Array.isArray(aiConfig.fallbackModels)
        ? aiConfig.fallbackModels.filter(item => typeof item === 'string' && item.trim().length > 0)
        : DEFAULT_FALLBACK_MODELS;

    return {
        apiKey,
        baseUrl: process.env.OPENROUTER_BASE_URL || aiConfig.baseUrl || DEFAULT_BASE_URL,
        model: process.env.OPENROUTER_MODEL || aiConfig.model || DEFAULT_MODEL,
        fallbackModels,
        botPersonality: aiConfig.personality || 'You are a friendly but direct Discord community bot. Keep responses concise, helpful, and playful. Avoid spammy repetition and avoid roleplay that pretends to be human.',
        maxHistoryTurns: Number(aiConfig.maxHistoryTurns || 12),
        maxOutputTokens: Number(aiConfig.maxOutputTokens || 220)
    };
}

function buildModelCandidates(cfg) {
    const candidates = [cfg.model, ...cfg.fallbackModels]
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());

    return Array.from(new Set(candidates));
}

function isContentPolicyError(statusCode, errorText) {
    const text = String(errorText || '').toLowerCase();

    return (
        statusCode === 400 ||
        statusCode === 403 ||
        statusCode === 422
    ) && (
        text.includes('content policy') ||
        text.includes('content_policy') ||
        text.includes('content filter') ||
        text.includes('content_filter') ||
        text.includes('moderation') ||
        text.includes('safety') ||
        text.includes('unsafe') ||
        text.includes('prohibited') ||
        text.includes('flagged') ||
        text.includes('blocked')
    );
}

function shouldTryNextModel(statusCode, errorText) {
    if (isContentPolicyError(statusCode, errorText)) {
        return false;
    }

    if (statusCode >= 500 || statusCode === 429) {
        return true;
    }

    if (statusCode !== 400 && statusCode !== 404) {
        return false;
    }

    const text = String(errorText || '').toLowerCase();
    return (
        text.includes('no endpoints found') ||
        text.includes('not found') ||
        text.includes('not a valid model id') ||
        text.includes('invalid model')
    );
}

function getRetryAfterMs(response) {
    const retryAfter = response.headers.get('retry-after');

    if (!retryAfter) {
        return MODEL_RATE_LIMIT_COOLDOWN_MS;
    }

    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds) && seconds > 0) {
        return seconds * 1000;
    }

    const dateValue = Date.parse(retryAfter);

    if (Number.isFinite(dateValue)) {
        return Math.max(1000, dateValue - Date.now());
    }

    return MODEL_RATE_LIMIT_COOLDOWN_MS;
}

function isModelTemporarilyUnavailable(model) {
    const blockedUntil = rateLimitedModels.get(model);

    if (!blockedUntil) {
        return false;
    }

    if (blockedUntil <= Date.now()) {
        rateLimitedModels.delete(model);
        return false;
    }

    return true;
}

function markModelRateLimited(model, retryAfterMs) {
    rateLimitedModels.set(model, Date.now() + Math.max(1000, retryAfterMs));
}

async function requestCompletion(cfg, model, messages) {
    const body = {
        model,
        messages,
        temperature: 0.7,
        max_tokens: cfg.maxOutputTokens
    };

    return fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://localhost/alcoholismbot',
            'X-OpenRouter-Title': 'AlcoholismBot'
        },
        body: JSON.stringify(body)
    });
}

function buildMessages(personality, history, userInput) {
    const sanitizedHistory = Array.isArray(history)
        ? history
            .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
            .map(item => ({ role: item.role, content: item.content }))
        : [];

    return [
        { role: 'system', content: personality },
        ...sanitizedHistory,
        { role: 'user', content: userInput }
    ];
}

function isRefusalReply(reply) {
    const text = String(reply || '')
        .toLowerCase()
        .replace(/[’‘`]/g, "'")
        .replace(/[“”]/g, '"')
        .trim();

    return (
        text.includes("i'm sorry, but i can't continue with that") ||
        text.includes("i can't continue with that") ||
        text.includes('i cannot continue with that') ||
        text.includes("i'm sorry, but i can't help with that") ||
        text.includes("i can't help with that") ||
        text.includes('i cannot help with that') ||
        text.includes("sorry, i can't help") ||
        text.includes('ik kan hier niet mee doorgaan') ||
        text.includes('daar kan ik niet mee helpen')
    );
}

function buildNormalFallbackReply(userInput) {
    const text = String(userInput || '').toLowerCase();

    if (text.includes('goedemorgen') || text.includes('goeiemorgen')) {
        return 'Goeiemorgen.';
    }

    if (text.includes('?')) {
        return 'Geen idee, maar ik ga er niet moeilijk over doen.';
    }

    return 'Ik ben er gewoon. Wat is er?';
}

async function tryModels({ cfg, models, messages }) {
    let lastError = null;

    for (const model of models) {
        if (isModelTemporarilyUnavailable(model)) {
            lastError = `AI model ${model} is temporarily rate limited.`;
            continue;
        }

        const response = await requestCompletion(cfg, model, messages);

        if (!response.ok) {
            const errorText = await response.text();
            lastError = `AI API request failed for model ${model}: ${response.status} ${errorText}`;

            if (isContentPolicyError(response.status, errorText)) {
                throw new AiChatError(lastError, 'CONTENT_BLOCKED');
            }

            if (response.status === 429) {
                markModelRateLimited(model, getRetryAfterMs(response));
            }

            if (shouldTryNextModel(response.status, errorText)) {
                continue;
            }

            throw new AiChatError(lastError, 'REQUEST_FAILED');
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content;

        if (!reply || typeof reply !== 'string') {
            lastError = `AI API returned an empty response for model ${model}.`;
            continue;
        }

        return reply.trim();
    }

    throw new AiChatError(lastError || 'No configured model returned a valid response.', 'REQUEST_FAILED');
}

async function generateAiReply({ userInput, history }) {
    const cfg = getAiConfig();

    if (!cfg.apiKey) {
        throw new Error('Missing OPENROUTER_API_KEY in .env.');
    }

    const models = buildModelCandidates(cfg);
    const hasHistory = Array.isArray(history) && history.length > 0;
    const messagesWithHistory = buildMessages(cfg.botPersonality, history, userInput);

    try {
        const reply = await tryModels({ cfg, models, messages: messagesWithHistory });
        const text = isRefusalReply(reply) ? buildNormalFallbackReply(userInput) : reply;

        return {
            text,
            maxHistoryTurns: cfg.maxHistoryTurns,
            resetHistory: isRefusalReply(reply)
        };
    } catch (error) {
        if (!(error instanceof AiChatError) || error.code !== 'CONTENT_BLOCKED' || !hasHistory) {
            throw error;
        }

        const messagesWithoutHistory = buildMessages(cfg.botPersonality, [], userInput);
        const reply = await tryModels({ cfg, models, messages: messagesWithoutHistory });
        const text = isRefusalReply(reply) ? buildNormalFallbackReply(userInput) : reply;

        return {
            text,
            maxHistoryTurns: cfg.maxHistoryTurns,
            resetHistory: true
        };
    }
}

module.exports = {
    AiChatError,
    buildNormalFallbackReply,
    generateAiReply
};
