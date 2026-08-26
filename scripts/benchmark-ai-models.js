#!/usr/bin/env node
// Run on the server: node scripts/benchmark-ai-models.js --apply
// Only configured free text models are tested. Secrets are never printed.
const { loadEnv } = require('../utils/env-loader');
const { readConfig, saveConfig } = require('../utils/config');

loadEnv();

const TEST_PROMPT = 'Reply with exactly this word: ready';
const MAX_TIMEOUT_MS = 10000;

function isFreeModel(model) {
    return typeof model === 'string' && /(?::free|\/free)(?:$|:)/i.test(model);
}

function configuredModels(ai) {
    return Array.from(new Set([
        ai.fastModel,
        ai.model,
        ...(Array.isArray(ai.fallbackModels) ? ai.fallbackModels : [])
    ].filter(isFreeModel).map(model => model.trim())));
}

async function testModel({ model, apiKey, baseUrl, timeoutMs, providerSort }) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://localhost/flummi',
                'X-OpenRouter-Title': 'Flummi model benchmark'
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: TEST_PROMPT }],
                max_tokens: 12,
                temperature: 0,
                provider: { sort: providerSort || 'throughput', data_collection: 'deny', zdr: true }
            }),
            signal: controller.signal
        });
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
            return { model, ok: false, latencyMs, reason: `HTTP ${response.status}: ${(await response.text()).slice(0, 180)}` };
        }

        const payload = await response.json();
        const text = payload?.choices?.[0]?.message?.content;
        return text ? { model, ok: true, latencyMs } : { model, ok: false, latencyMs, reason: 'Empty response' };
    } catch (error) {
        return { model, ok: false, latencyMs: Date.now() - startedAt, reason: error?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    const config = readConfig();
    const ai = config.ai || {};
    const apiKey = process.env.OPENROUTER_API_KEY || ai.openRouterApiKey;
    const models = configuredModels(ai);

    if (!apiKey) throw new Error('No OpenRouter API key is configured.');
    if (!models.length) throw new Error('No configured free text models to benchmark.');

    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(3000, Number(ai.requestTimeoutMs) || 8000));
    const results = [];

    for (const model of models) {
        const result = await testModel({ model, apiKey, baseUrl: ai.baseUrl || 'https://openrouter.ai/api/v1', timeoutMs, providerSort: ai.providerSort });
        results.push(result);
        console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${String(result.latencyMs).padStart(5)}ms  ${model}${result.reason ? ` — ${result.reason}` : ''}`);
    }

    const fastest = results.filter(result => result.ok).sort((left, right) => left.latencyMs - right.latencyMs)[0];

    if (!fastest) {
        console.log('No model completed successfully. Configuration was not changed.');
        process.exitCode = 1;
        return;
    }

    console.log(`Fastest successful model: ${fastest.model} (${fastest.latencyMs}ms)`);

    if (process.argv.includes('--apply')) {
        const fallbackModels = models.filter(model => model !== fastest.model);
        config.ai = { ...ai, model: fastest.model, fastModel: fastest.model, fallbackModels };
        saveConfig(config);
        console.log('Applied: primary and fast model updated; remaining tested models kept as fallbacks.');
    }
}

main().catch(error => {
    console.error(`AI benchmark failed: ${error.message}`);
    process.exitCode = 1;
});
