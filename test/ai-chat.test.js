const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildImageUnavailableFallbackReply,
    buildMessages,
    buildVisionModelCandidates,
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
    ], 'nieuwe vraag', '- User: oude vraag | Alcoholisme: oud antwoord');

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
        model: 'text/main',
        fallbackModels: ['text/main', 'text/fallback'],
        visionModels: ['vision/one', 'vision/two']
    });

    assert.deepEqual(candidates, ['vision/one', 'vision/two', 'text/main', 'text/fallback']);
});

test('generateAiReply returns a local image fallback when all image and text models are rate limited', async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    process.env.OPENROUTER_API_KEY = 'test-key';
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

        if (originalApiKey === undefined) {
            delete process.env.OPENROUTER_API_KEY;
        } else {
            process.env.OPENROUTER_API_KEY = originalApiKey;
        }
    }
});
