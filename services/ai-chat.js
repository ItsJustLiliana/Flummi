const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../utils/env-loader');
const { readConfig } = require('../utils/config');

loadEnv();

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-oss-20b:free';
const DEFAULT_FALLBACK_MODELS = [
    'openai/gpt-oss-20b:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'qwen/qwen3-coder:free',
    'google/gemma-4-26b-a4b-it:free'
];
const DEFAULT_VISION_MODELS = [
    'nex-agi/nex-n2-pro:free'
];
const MODEL_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_PROVIDER_SORT = 'throughput';
const MAX_OPENROUTER_ROUTED_MODELS = 3;
const rateLimitedModels = new Map();

class AiChatError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AiChatError';
        this.code = code;
    }
}

function getConfig() {
    return readConfig();
}

function getAiConfig() {
    const config = getConfig();
    const aiConfig = config.ai || {};
    const apiKey = process.env.OPENROUTER_API_KEY || aiConfig.openRouterApiKey || '';
    const fallbackModels = Array.isArray(aiConfig.fallbackModels)
        ? aiConfig.fallbackModels.filter(item => typeof item === 'string' && item.trim().length > 0)
        : DEFAULT_FALLBACK_MODELS;
    const visionModels = Array.isArray(aiConfig.visionModels)
        ? aiConfig.visionModels.filter(item => typeof item === 'string' && item.trim().length > 0)
        : DEFAULT_VISION_MODELS;
    const basePersonality = aiConfig.personality || 'You are a friendly but direct Discord community bot. Keep responses concise, helpful, and playful. Avoid spammy repetition and avoid roleplay that pretends to be human.';
    const conversationQualityInstructions = [
        'Reageer als een echte gesprekspartner, niet als een bevestigingsknop.',
        'Antwoord nooit alleen met “ok”, “oke”, “ja”, “prima”, “lol” of een andere kale bevestiging.',
        'Bij een losse begroeting of korte boodschap zoals “jo”, reageer je natuurlijk terug en voeg je hooguit een korte vraag of opmerking toe.',
        'Blijf kort, maar geef altijd een antwoord met inhoud dat past bij de toon van de gebruiker.'
    ].join(' ');
    const imageSearchInstructions = [
        'Als iemand expliciet vraagt om een foto, plaatje, afbeelding, screenshot of visuele referentie die jij online moet zoeken,',
        'zet dan aan het einde van je antwoord exact deze marker: [[image_search: korte zoekopdracht]].',
        'Gebruik geen marker als de gebruiker alleen een meegestuurde afbeelding wil laten analyseren.',
        'Voorbeeld: [[image_search: Ludwig Ahgren streamer portrait]].'
    ].join(' ');

    return {
        apiKey,
        baseUrl: process.env.OPENROUTER_BASE_URL || aiConfig.baseUrl || DEFAULT_BASE_URL,
        model: process.env.OPENROUTER_MODEL || aiConfig.model || DEFAULT_MODEL,
        fastModel: process.env.OPENROUTER_FAST_MODEL || aiConfig.fastModel || 'meta-llama/llama-3.2-3b-instruct:free',
        smartModel: process.env.OPENROUTER_SMART_MODEL || aiConfig.smartModel || aiConfig.model || DEFAULT_MODEL,
        fallbackModels,
        visionModels,
        botPersonality: `${basePersonality}\n\n${conversationQualityInstructions}\n\n${imageSearchInstructions}`,
        maxHistoryTurns: Number(aiConfig.maxHistoryTurns || 12),
        maxOutputTokens: Number(aiConfig.maxOutputTokens || 220),
        requestTimeoutMs: Math.max(1000, Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || aiConfig.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)),
        providerSort: aiConfig.providerSort || DEFAULT_PROVIDER_SORT,
        useOpenRouterModelRouting: aiConfig.useOpenRouterModelRouting !== false
    };
}

function buildModelCandidates(cfg) {
    return buildFreeModelList([cfg.model, ...cfg.fallbackModels], [DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
}

function buildVisionModelCandidates(cfg) {
    return buildFreeModelList(cfg.visionModels, DEFAULT_VISION_MODELS);
}

function isFreeModel(model) {
    return typeof model === 'string' && /(?::free|\/free)(?:$|:)/i.test(model);
}

function buildFreeModelList(candidates, fallbackCandidates) {
    const freeModels = candidates
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim())
        .filter(isFreeModel);

    if (freeModels.length > 0) {
        return Array.from(new Set(freeModels));
    }

    return Array.from(new Set(
        fallbackCandidates
            .filter(item => typeof item === 'string' && item.trim().length > 0)
            .map(item => item.trim())
            .filter(isFreeModel)
    ));
}

function buildTextModelCandidates(cfg, userInput, history = []) {
    const inputText = stringifyUserInput(userInput);
    const recentText = Array.isArray(history)
        ? history.slice(-6).map(item => item?.content || '').join('\n')
        : '';
    const combinedText = `${recentText}\n${inputText}`.toLowerCase();
    const wantsSmarterModel = (
        inputText.length > 280 ||
        /\b(?:leg uit|explain|analyseer|analyze|vergelijk|compare|plan|strategie|strategy|code|bug|fix|waarom|why|hoe werkt|how does)\b/i.test(combinedText)
    );
    const preferred = wantsSmarterModel ? cfg.smartModel : cfg.fastModel;
    return buildFreeModelList([
        preferred,
        cfg.model,
        ...cfg.fallbackModels
    ], [DEFAULT_MODEL, ...DEFAULT_FALLBACK_MODELS]);
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
        text.includes('invalid model') ||
        text.includes('model is unavailable') ||
        text.includes('unavailable for free')
    );
}

function isRateLimitError(statusCode, errorText) {
    const text = String(errorText || '').toLowerCase();

    return (
        statusCode === 429 ||
        text.includes('rate-limit') ||
        text.includes('rate limited') ||
        text.includes('rate_limit') ||
        text.includes('temporarily rate-limited')
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

function clearAiModelCooldowns() {
    rateLimitedModels.clear();
}

async function requestCompletion(cfg, models, messages) {
    const modelList = Array.isArray(models) ? models : [models];
    const body = {
        messages,
        temperature: 0.7,
        max_tokens: cfg.maxOutputTokens
    };
    const activeModels = modelList
        .filter(item => typeof item === 'string' && item.trim().length > 0)
        .map(item => item.trim());

    if (activeModels.length === 1) {
        body.model = activeModels[0];
    } else {
        body.models = activeModels;
    }

    body.provider = {
        ...(cfg.providerSort ? { sort: cfg.providerSort } : {}),
        data_collection: 'deny',
        zdr: true
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.requestTimeoutMs);

    try {
        return await fetch(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://localhost/flummi',
                'X-OpenRouter-Title': 'Flummi',
                'X-OpenRouter-Metadata': 'enabled'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeout);
    }
}

function buildMessages(personality, history, userInput, memorySummary = '', userProfile = '', externalUserProfile = '') {
    const sanitizedHistory = Array.isArray(history)
        ? history
            .filter(item => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
            .map(item => ({ role: item.role, content: item.content }))
        : [];
    const summaryText = String(memorySummary || '').trim();
    const summaryMessage = summaryText
        ? [{
            role: 'system',
            content: [
                'Oudere gesprekscontext, samengevat. Gebruik dit alleen als achtergrondgeheugen;',
                'de recente berichten hieronder zijn belangrijker:',
                summaryText
            ].join('\n')
        }]
        : [];
    const profileText = String(userProfile || '').trim();
    const profileMessage = profileText
        ? [{
            role: 'system',
            content: [
                'Intern geleerd gebruikersprofiel voor deze user. Gebruik dit subtiel voor toon, voorkeuren en terugkerende context;',
                'maak er geen expliciet onderwerp van tenzij het relevant is:',
                profileText
            ].join('\n')
        }]
        : [];
    const externalProfileText = String(externalUserProfile || '').trim();
    const externalProfileMessage = externalProfileText
        ? [{
            role: 'system',
            content: [
                'Door de user zelf ingevuld profiel. Dit is explicieter/betrouwbaarder dan het interne geleerde profiel;',
                'gebruik het subtiel als context:',
                externalProfileText
            ].join('\n')
        }]
        : [];

    return [
        { role: 'system', content: personality },
        ...externalProfileMessage,
        ...profileMessage,
        ...summaryMessage,
        ...sanitizedHistory,
        { role: 'user', content: userInput }
    ];
}

function hasImageContent(input) {
    return Array.isArray(input) && input.some(part => part?.type === 'image_url');
}

function stringifyUserInput(input) {
    if (typeof input === 'string') {
        return input;
    }

    if (!Array.isArray(input)) {
        return String(input || '');
    }

    return input
        .map(part => {
            if (part?.type === 'text') {
                return part.text || '';
            }

            if (part?.type === 'image_url') {
                return `[image: ${part.image_url?.url || 'unknown'}]`;
            }

            return '';
        })
        .filter(Boolean)
        .join('\n');
}

function stripImageContent(input) {
    if (!Array.isArray(input)) {
        return input;
    }

    const textParts = input
        .filter(part => part?.type === 'text')
        .map(part => part.text)
        .filter(Boolean);

    return textParts.join('\n') || stringifyUserInput(input);
}

function isUnsupportedImageError(errorText) {
    const text = String(errorText || '').toLowerCase();

    return (
        text.includes('image') ||
        text.includes('vision') ||
        text.includes('modality') ||
        text.includes('multi-modal') ||
        text.includes('multimodal')
    ) && (
            text.includes('unsupported') ||
            text.includes('not support') ||
            text.includes('invalid') ||
            text.includes('cannot') ||
            text.includes('only supports')
        );
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

function isImageEchoReply(reply) {
    const text = String(reply || '')
        .replace(/\s+/g, ' ')
        .trim();

    return /^\[image:\s*(?:https?:\/\/|attachment:\/\/|[^\]]+\.(?:png|jpe?g|webp|gif)(?:\?[^\]]*)?)\]$/i.test(text);
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

function buildImageEchoFallbackReply() {
    return 'Ziet er goed uit.';
}

function buildImageUnavailableFallbackReply() {
    return 'Ik kan die foto nu niet uitlezen; het image-model zit even tegen z’n limiet aan.';
}

function buildRateLimitedFallbackReply() {
    return 'AI zit even tegen z’n limiet aan. Probeer zo nog eens.';
}

function extractImageSearchRequest(reply) {
    const text = String(reply || '');
    const markerPattern = /\[{1,2}\s*image[\s_-]+search\s*:\s*([^\]\n]{1,160})(?:\]{1,2}|$)/gi;
    const matches = Array.from(text.matchAll(markerPattern));

    if (matches.length === 0) {
        return {
            text: text.trim(),
            imageSearch: null
        };
    }

    const query = matches[matches.length - 1][1]
        .replace(/\s+/g, ' ')
        .trim();
    const cleanText = text
        .replace(markerPattern, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        text: cleanText,
        imageSearch: query ? { query } : null
    };
}

function getModelLabel(models) {
    return Array.isArray(models) ? models.join(', ') : models;
}

function shouldUseRoutedModelRequest(cfg, models) {
    return cfg.useOpenRouterModelRouting && Array.isArray(models) && models.length > 1;
}

async function tryModelRequest({ cfg, models, messages }) {
    const modelLabel = getModelLabel(models);

    try {
        const response = await requestCompletion(cfg, models, messages);

        if (!response.ok) {
            const errorText = await response.text();
            const lastError = `AI API request failed for model ${modelLabel}: ${response.status} ${errorText}`;

            if (isUnsupportedImageError(errorText)) {
                throw new AiChatError(lastError, 'UNSUPPORTED_IMAGE_INPUT');
            }

            if (isContentPolicyError(response.status, errorText)) {
                throw new AiChatError(lastError, 'CONTENT_BLOCKED');
            }

            if (isRateLimitError(response.status, errorText)) {
                for (const model of Array.isArray(models) ? models : [models]) {
                    markModelRateLimited(model, getRetryAfterMs(response));
                }

                throw new AiChatError(lastError, 'RATE_LIMITED');
            }

            throw new AiChatError(lastError, shouldTryNextModel(response.status, errorText) ? 'MODEL_UNAVAILABLE' : 'REQUEST_FAILED');
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content;

        if (!reply || typeof reply !== 'string') {
            throw new AiChatError(`AI API returned an empty response for model ${modelLabel}.`, 'EMPTY_RESPONSE');
        }

        return reply.trim();
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new AiChatError(`AI API request timed out for model ${modelLabel}.`, 'REQUEST_TIMEOUT');
        }

        throw error;
    }
}

async function tryModels({ cfg, models, messages, stopAfterRoutedTimeout = false }) {
    let lastError = null;
    let attemptedModels = 0;
    let rateLimitedCount = 0;
    let timeoutCount = 0;
    const availableModels = models.filter(model => {
        if (isModelTemporarilyUnavailable(model)) {
            lastError = `AI model ${model} is temporarily rate limited.`;
            rateLimitedCount += 1;
            return false;
        }

        return true;
    });

    if (shouldUseRoutedModelRequest(cfg, availableModels)) {
        const routedModels = availableModels.slice(0, MAX_OPENROUTER_ROUTED_MODELS);
        attemptedModels = routedModels.length;

        try {
            return await tryModelRequest({ cfg, models: routedModels, messages });
        } catch (error) {
            lastError = error.message;

            if (error instanceof AiChatError && error.code === 'RATE_LIMITED') {
                rateLimitedCount = attemptedModels;
            } else if (error instanceof AiChatError && error.code === 'REQUEST_TIMEOUT' && stopAfterRoutedTimeout) {
                throw error;
            } else if (error instanceof AiChatError && error.code === 'REQUEST_TIMEOUT') {
                timeoutCount += 1;
            } else if (
                !(error instanceof AiChatError) ||
                !['MODEL_UNAVAILABLE', 'EMPTY_RESPONSE', 'REQUEST_TIMEOUT'].includes(error.code)
            ) {
                throw error;
            }
        }
    }

    for (const model of availableModels) {
        if (isModelTemporarilyUnavailable(model)) {
            lastError = `AI model ${model} is temporarily rate limited.`;
            rateLimitedCount += 1;
            continue;
        }

        attemptedModels += 1;
        let response;

        try {
            response = await requestCompletion(cfg, model, messages);
        } catch (error) {
            if (error?.name === 'AbortError') {
                lastError = `AI API request timed out for model ${model}.`;
                timeoutCount += 1;
                if (stopAfterRoutedTimeout) {
                    throw new AiChatError(lastError, 'REQUEST_TIMEOUT');
                }
                continue;
            }

            throw error;
        }

        if (!response.ok) {
            const errorText = await response.text();
            lastError = `AI API request failed for model ${model}: ${response.status} ${errorText}`;

            if (isUnsupportedImageError(errorText)) {
                throw new AiChatError(lastError, 'UNSUPPORTED_IMAGE_INPUT');
            }

            if (isContentPolicyError(response.status, errorText)) {
                throw new AiChatError(lastError, 'CONTENT_BLOCKED');
            }

            if (isRateLimitError(response.status, errorText)) {
                rateLimitedCount += 1;
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

    if (rateLimitedCount > 0 && rateLimitedCount >= attemptedModels) {
        throw new AiChatError(lastError || 'All configured AI models are temporarily rate limited.', 'RATE_LIMITED');
    }

    if (timeoutCount > 0 && timeoutCount >= attemptedModels) {
        throw new AiChatError(lastError || 'All configured AI models timed out.', 'REQUEST_TIMEOUT');
    }

    throw new AiChatError(lastError || 'No configured model returned a valid response.', 'REQUEST_FAILED');
}

async function generateAiReply({ userInput, history, memorySummary, userProfile, externalUserProfile }) {
    const cfg = getAiConfig();

    if (!cfg.apiKey) {
        throw new Error('Missing OPENROUTER_API_KEY in .env.');
    }

    const hasImages = hasImageContent(userInput);
    const models = hasImages ? buildVisionModelCandidates(cfg) : buildTextModelCandidates(cfg, userInput, history);
    const requestConfig = hasImages
        ? { ...cfg, useOpenRouterModelRouting: false }
        : cfg;
    const hasHistory = Array.isArray(history) && history.length > 0;
    const messagesWithHistory = buildMessages(
        cfg.botPersonality,
        history,
        userInput,
        memorySummary,
        userProfile,
        externalUserProfile
    );

    try {
        const reply = await tryModels({
            cfg: requestConfig,
            models,
            messages: messagesWithHistory,
            // OpenRouter already receives several text-model candidates in one routed request.
            // Do not run another slow, sequential fallback chain after that request times out.
            // Vision providers remain independent because a vision fallback can genuinely help.
            stopAfterRoutedTimeout: !hasImages
        });
        const parsed = extractImageSearchRequest(reply);
        const text = isImageEchoReply(parsed.text)
            ? buildImageEchoFallbackReply()
            : isRefusalReply(parsed.text)
                ? buildNormalFallbackReply(userInput)
                : parsed.text;

        return {
            text,
            imageSearch: hasImages ? null : parsed.imageSearch,
            maxHistoryTurns: cfg.maxHistoryTurns,
            resetHistory: isRefusalReply(parsed.text) || isImageEchoReply(parsed.text)
        };
    } catch (error) {
        if (
            error instanceof AiChatError &&
            (error.code === 'UNSUPPORTED_IMAGE_INPUT' || error.code === 'RATE_LIMITED' || error.code === 'REQUEST_TIMEOUT') &&
            hasImages
        ) {
            if (error.code === 'REQUEST_TIMEOUT') {
                return {
                    text: buildImageUnavailableFallbackReply(),
                    maxHistoryTurns: cfg.maxHistoryTurns,
                    resetHistory: false,
                    usedLocalFallback: true
                };
            }

            const textOnlyInput = stripImageContent(userInput);
            const textOnlyMessages = buildMessages(
                cfg.botPersonality,
                history,
                textOnlyInput,
                memorySummary,
                userProfile,
                externalUserProfile
            );

            try {
                const reply = await tryModels({
                    cfg,
                    models: buildTextModelCandidates(cfg, textOnlyInput, history),
                    messages: textOnlyMessages,
                });
                const parsed = extractImageSearchRequest(reply);
                const text = isImageEchoReply(parsed.text)
                    ? buildImageEchoFallbackReply()
                    : isRefusalReply(parsed.text)
                        ? buildNormalFallbackReply(textOnlyInput)
                        : parsed.text;

                return {
                    text,
                    imageSearch: null,
                    maxHistoryTurns: cfg.maxHistoryTurns,
                    resetHistory: isRefusalReply(parsed.text) || isImageEchoReply(parsed.text),
                    usedTextOnlyFallback: true
                };
            } catch (fallbackError) {
                if (fallbackError instanceof AiChatError && fallbackError.code === 'RATE_LIMITED') {
                    return {
                        text: buildImageUnavailableFallbackReply(),
                        maxHistoryTurns: cfg.maxHistoryTurns,
                        resetHistory: false,
                        usedLocalFallback: true
                    };
                }

                throw fallbackError;
            }
        }

        if (error instanceof AiChatError && error.code === 'RATE_LIMITED') {
            return {
                text: buildRateLimitedFallbackReply(),
                maxHistoryTurns: cfg.maxHistoryTurns,
                resetHistory: false,
                usedLocalFallback: true
            };
        }

        if (!(error instanceof AiChatError) || error.code !== 'CONTENT_BLOCKED' || !hasHistory) {
            throw error;
        }

        const messagesWithoutHistory = buildMessages(cfg.botPersonality, [], userInput);
        const reply = await tryModels({ cfg, models, messages: messagesWithoutHistory });
        const parsed = extractImageSearchRequest(reply);
        const text = isImageEchoReply(parsed.text)
            ? buildImageEchoFallbackReply()
            : isRefusalReply(parsed.text)
                ? buildNormalFallbackReply(userInput)
                : parsed.text;

        return {
            text,
            imageSearch: hasImages ? null : parsed.imageSearch,
            maxHistoryTurns: cfg.maxHistoryTurns,
            resetHistory: true
        };
    }
}

module.exports = {
    AiChatError,
    getAiConfig,
    buildMessages,
    buildTextModelCandidates,
    buildNormalFallbackReply,
    buildImageEchoFallbackReply,
    buildImageUnavailableFallbackReply,
    buildRateLimitedFallbackReply,
    buildVisionModelCandidates,
    clearAiModelCooldowns,
    extractImageSearchRequest,
    hasImageContent,
    stripImageContent,
    stringifyUserInput,
    generateAiReply
};
