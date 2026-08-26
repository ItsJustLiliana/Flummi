const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildImageUnavailableFallbackReply,
    buildImageEchoFallbackReply,
    buildMessages,
    buildTextModelCandidates,
    buildVisionModelCandidates,
    clearAiModelCooldowns,
    extractImageSearchRequest,
    generateAiReply,
    hasImageContent,
    stringifyUserInput,
    stripImageContent
} = require('../services/ai-chat');

test('buildMessages keeps text history and allows image content for the current user turn', () => {
    const userInput = [
        { type: 'text', text: 'wat staat hierop?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }
    ];

    const messages = buildMessages('kort antwoorden', [
        { role: 'user', content: 'hoi' },
        { role: 'assistant', content: 'hoi terug' },
        { role: 'tool', content: 'ignored' }
    ], userInput);

    assert.equal(messages.length, 4);
    assert.deepEqual(messages[0], { role: 'system', content: 'kort antwoorden' });
    assert.equal(messages[1].content, 'hoi');
    assert.equal(messages[2].content, 'hoi terug');
    assert.equal(messages[3].content, userInput);
    assert.equal(hasImageContent(messages[3].content), true);
});

test('buildMessages includes compact memory summary before recent history', () => {
    const messages = buildMessages('kort antwoorden', [
        { role: 'user', content: 'recente vraag' },
        { role: 'assistant', content: 'recent antwoord' }
    ], 'nieuwe vraag', '- User: oude vraag | Flummi: oud antwoord');

    assert.equal(messages.length, 5);
    assert.equal(messages[0].content, 'kort antwoorden');
    assert.equal(messages[1].role, 'system');
    assert.match(messages[1].content, /Oudere gesprekscontext/);
    assert.match(messages[1].content, /oude vraag/);
    assert.equal(messages[2].content, 'recente vraag');
    assert.equal(messages[4].content, 'nieuwe vraag');
});

test('buildMessages includes learned user profile before older summary', () => {
    const messages = buildMessages('kort antwoorden', [
        { role: 'user', content: 'recente vraag' }
    ], 'nieuwe vraag', '- User: oude vraag', '- Favoriete game: Brawl Stars');

    assert.equal(messages.length, 5);
    assert.equal(messages[1].role, 'system');
    assert.match(messages[1].content, /Intern geleerd gebruikersprofiel/);
    assert.match(messages[1].content, /Brawl Stars/);
    assert.match(messages[2].content, /Oudere gesprekscontext/);
});

test('buildMessages includes external profile before learned profile', () => {
    const messages = buildMessages('kort antwoorden', [
        { role: 'user', content: 'recente vraag' }
    ], 'nieuwe vraag', '- User: oude vraag', '- Terugkerend onderwerp: FNAF', 'Naam/nickname: Marij\nBio: Bot enjoyer');

    assert.equal(messages.length, 6);
    assert.match(messages[1].content, /Door de user zelf ingevuld profiel/);
    assert.match(messages[1].content, /Bot enjoyer/);
    assert.match(messages[2].content, /Intern geleerd gebruikersprofiel/);
    assert.match(messages[3].content, /Oudere gesprekscontext/);
});

test('extractImageSearchRequest removes marker and returns the image query', () => {
    const result = extractImageSearchRequest('Ja hoor, deze bedoel je. [[image_search: Ludwig Ahgren streamer portrait]]');

    assert.equal(result.text, 'Ja hoor, deze bedoel je.');
    assert.deepEqual(result.imageSearch, { query: 'Ludwig Ahgren streamer portrait' });
});

test('extractImageSearchRequest accepts single bracket model output', () => {
    const result = extractImageSearchRequest('[image_search: iuno wuthering waves]');

    assert.equal(result.text, '');
    assert.deepEqual(result.imageSearch, { query: 'iuno wuthering waves' });
});

test('extractImageSearchRequest accepts marker with a space', () => {
    const result = extractImageSearchRequest('[image search: el primo brawl stars]');

    assert.equal(result.text, '');
    assert.deepEqual(result.imageSearch, { query: 'el primo brawl stars' });
});

test('extractImageSearchRequest accepts unfinished trailing marker', () => {
    const result = extractImageSearchRequest('[[image_search: Freddy Fazbear');

    assert.equal(result.text, '');
    assert.deepEqual(result.imageSearch, { query: 'Freddy Fazbear' });
});

test('stripImageContent turns multimodal input back into text-only context', () => {
    const userInput = [
        { type: 'text', text: 'beschrijf deze afbeelding' },
        { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } }
    ];

    assert.equal(stripImageContent(userInput), 'beschrijf deze afbeelding');
    assert.equal(
        stringifyUserInput(userInput),
        'beschrijf deze afbeelding\n[image: https://example.com/photo.jpg]'
    );
});

test('buildVisionModelCandidates prioritizes configured vision models', () => {
    const candidates = buildVisionModelCandidates({
        model: 'text/main:free',
        fallbackModels: ['text/main:free', 'text/fallback:free'],
        visionModels: ['vision/one:free', 'vision/two:free']
    });

    assert.deepEqual(candidates, ['vision/one:free', 'vision/two:free']);
});

test('model candidates only include free OpenRouter models', () => {
    const candidates = buildTextModelCandidates({
        model: 'paid/main',
        fastModel: 'fast/free:free',
        smartModel: 'paid/smart',
        fallbackModels: ['fallback/paid', 'fallback/free:free']
    }, 'hoi', []);

    assert.deepEqual(candidates, ['fast/free:free', 'fallback/free:free']);
});

test('generateAiReply caps OpenRouter routed models at three', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    let requestBody = null;

    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = async (url, options) => {
        requestBody = JSON.parse(options.body);

        return {
            ok: true,
            async json() {
                return {
                    choices: [{
                        message: {
                            content: 'hoi'
                        }
                    }]
                };
            }
        };
    };

    try {
        const result = await generateAiReply({
            userInput: 'hoi',
            history: []
        });

        assert.equal(result.text, 'hoi');
        assert.equal(Array.isArray(requestBody.models), true);
        assert.ok(requestBody.models.length > 0);
        assert.ok(requestBody.models.length <= 3);
    } finally {
        global.fetch = originalFetch;
        clearAiModelCooldowns();

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }
    }
});

test('generateAiReply returns a local image fallback when all image and text models are rate limited', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    process.env.OPENROUTER_API_KEY = 'test-key';
    clearAiModelCooldowns();
    global.fetch = async () => ({
        ok: false,
        status: 429,
        headers: {
            get() {
                return null;
            }
        },
        async text() {
            return '{"error":{"message":"temporarily rate-limited upstream"}}';
        }
    });

    try {
        const result = await generateAiReply({
            userInput: [
                { type: 'text', text: 'kun je deze foto zien?' },
                { type: 'image_url', image_url: { url: 'https://example.com/foto.png' } }
            ],
            history: []
        });

        assert.equal(result.text, buildImageUnavailableFallbackReply());
        assert.equal(result.usedLocalFallback, true);
    } finally {
        global.fetch = originalFetch;
        clearAiModelCooldowns();

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }
    }
});

test('generateAiReply returns a local image fallback when the vision request times out', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    const originalTimeout = process.env.OPENROUTER_REQUEST_TIMEOUT_MS;

    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_REQUEST_TIMEOUT_MS = '1000';
    global.fetch = async (url, options) => {
        await new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {
                name: 'AbortError'
            })));
        });
    };

    try {
        const result = await generateAiReply({
            userInput: [
                { type: 'text', text: 'wat vind je hiervan?' },
                { type: 'image_url', image_url: { url: 'https://example.com/foto.png' } }
            ],
            history: []
        });

        assert.equal(result.text, buildImageUnavailableFallbackReply());
        assert.equal(result.usedLocalFallback, true);
    } finally {
        global.fetch = originalFetch;

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }

        if (originalTimeout === undefined) {
            delete process.env.OPENROUTER_REQUEST_TIMEOUT_MS;
        } else {
            process.env.OPENROUTER_REQUEST_TIMEOUT_MS = originalTimeout;
        }
    }
});

test('generateAiReply replaces image echo replies with a normal fallback', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = async () => ({
        ok: true,
        async json() {
            return {
                choices: [{
                    message: {
                        content: '[image: https://cdn.discordapp.com/attachments/cat.jpg]'
                    }
                }]
            };
        }
    });

    try {
        const result = await generateAiReply({
            userInput: [
                { type: 'text', text: 'wat vind je hiervan?' },
                { type: 'image_url', image_url: { url: 'https://cdn.discordapp.com/attachments/cat.jpg' } }
            ],
            history: []
        });

        assert.equal(result.text, buildImageEchoFallbackReply());
        assert.equal(result.resetHistory, true);
    } finally {
        global.fetch = originalFetch;

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }
    }
});

test('generateAiReply ignores image search markers for attached images', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    process.env.OPENROUTER_API_KEY = 'test-key';
    global.fetch = async () => ({
        ok: true,
        async json() {
            return {
                choices: [{
                    message: {
                        content: 'Mooie foto. [[image_search: wat vind je van SPAR]]'
                    }
                }]
            };
        }
    });

    try {
        const result = await generateAiReply({
            userInput: [
                { type: 'text', text: 'wat vind je van deze foto' },
                { type: 'image_url', image_url: { url: 'https://cdn.discordapp.com/attachments/photo.jpg' } }
            ],
            history: []
        });

        assert.equal(result.text, 'Mooie foto.');
        assert.equal(result.imageSearch, null);
    } finally {
        global.fetch = originalFetch;

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }
    }
});
