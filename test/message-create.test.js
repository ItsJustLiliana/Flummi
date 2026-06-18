const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildExternalUserProfileContext,
    buildImageFileAttachment,
    cleanImageSearchContext,
    extractDirectImageSearchQuery,
    extractImageResultUrls,
    extractSimilarImageSearchContext,
    extractSimilarImageSearchQuery,
    extractRememberedImageUrls,
    findRecentImageResultUrls,
    findRecentVisualContext,
    getImageAttachmentUrls,
    getImageExtensionFromContentType,
    getImageExtensionFromUrl,
    ImageAttachmentError
} = require('../events/messageCreate');

test('buildExternalUserProfileContext formats user-filled profile fields for AI context', () => {
    const context = buildExternalUserProfileContext({
        nickname: 'Marij',
        bio: 'Bot enjoyer',
        pronouns: 'he/him',
        birthday: null,
        timezone: 'Europe/Amsterdam',
        languages: [{ label: 'Dutch', flag: 'NL' }, { label: 'English', flag: 'GB' }],
        socials: {
            github: 'marij',
            twitch: ''
        }
    });

    assert.match(context, /Naam\/nickname: Marij/);
    assert.match(context, /Bio: Bot enjoyer/);
    assert.match(context, /Pronouns: he\/him/);
    assert.match(context, /Timezone: Europe\/Amsterdam/);
    assert.match(context, /Languages: .*Dutch.*English/);
    assert.match(context, /Socials: github: marij/);
    assert.doesNotMatch(context, /Birthday/);
});

test('extractDirectImageSearchQuery reads direct Dutch image requests', () => {
    assert.equal(extractDirectImageSearchQuery('katten foto'), 'katten');
    assert.equal(extractDirectImageSearchQuery('foto van freddy fazbear'), 'freddy fazbear');
    assert.equal(extractDirectImageSearchQuery('geef mij een foto van een springkasteel'), 'een springkasteel');
    assert.equal(extractDirectImageSearchQuery('zoek een plaatje van el primo brawl stars'), 'el primo brawl stars');
});

test('extractDirectImageSearchQuery ignores normal chat', () => {
    assert.equal(extractDirectImageSearchQuery('wat vind je hiervan'), '');
});

test('extractSimilarImageSearchQuery uses replied bot description', () => {
    const result = extractSimilarImageSearchQuery(
        'Kun je een soortgelijke foto laten zien',
        [],
        {
            content: 'Een zwart-wit meme van een man met z’n handen omhoog en de tekst “ABSOLUTE KEUKENROL”.'
        }
    );

    assert.equal(result, 'Een zwart-wit meme van een man met z’n handen omhoog en de tekst “ABSOLUTE KEUKENROL”.');
});

test('extractSimilarImageSearchQuery falls back to recent assistant context', () => {
    const result = extractSimilarImageSearchQuery(
        'laat een vergelijkbare afbeelding zien',
        [
            { role: 'user', content: 'wat zie je' },
            { role: 'assistant', content: 'Een zwart-wit meme van een man met z’n handen omhoog.' }
        ],
        null
    );

    assert.equal(result, 'Een zwart-wit meme van een man met z’n handen omhoog.');
});

test('findRecentVisualContext ignores image search markers', () => {
    assert.equal(cleanImageSearchContext('[[image_search: Freddy Fazbear'), '');
    assert.equal(findRecentVisualContext([
        { role: 'assistant', content: '[[image_search: Freddy Fazbear' },
        { role: 'assistant', content: 'Een zwart-wit meme.' }
    ]), 'Een zwart-wit meme.');
});

test('extractSimilarImageSearchContext carries previous image result urls to exclude', () => {
    const history = [
        { role: 'assistant', content: 'Een zwart-wit meme.\n[image result: https://example.com/same.jpg]' }
    ];
    const context = extractSimilarImageSearchContext(
        'Kun je een soortgelijke foto laten zien',
        history,
        null
    );

    assert.deepEqual(context, {
        query: 'Een zwart-wit meme.',
        excludeUrls: ['https://example.com/same.jpg']
    });
    assert.deepEqual(extractImageResultUrls(history[0].content), ['https://example.com/same.jpg']);
    assert.deepEqual(findRecentImageResultUrls(history), ['https://example.com/same.jpg']);
});

test('extractSimilarImageSearchContext excludes previously analyzed image attachments from memory', () => {
    const history = [
        { role: 'user', content: 'wat zie je\n[image: https://cdn.discordapp.com/attachments/iuno.png]' },
        { role: 'assistant', content: 'Iuno uit Wuthering Waves, met blauw haar.' }
    ];
    const context = extractSimilarImageSearchContext(
        'geef een foto die er een beetje op lijkt',
        history,
        null
    );

    assert.deepEqual(context, {
        query: 'Iuno uit Wuthering Waves, met blauw haar.',
        excludeUrls: ['https://cdn.discordapp.com/attachments/iuno.png']
    });
    assert.deepEqual(
        extractRememberedImageUrls(history[0].content),
        ['https://cdn.discordapp.com/attachments/iuno.png']
    );
});

test('extractSimilarImageSearchContext excludes image urls from replied attachment', () => {
    const attachment = {
        url: 'https://cdn.discordapp.com/attachments/replied.png',
        contentType: 'image/png'
    };
    const referencedMessage = {
        content: 'Iuno uit Wuthering Waves.',
        attachments: new Map([['1', attachment]])
    };
    const context = extractSimilarImageSearchContext(
        'kun je een soortgelijke foto zoeken',
        [],
        referencedMessage
    );

    assert.deepEqual(context, {
        query: 'Iuno uit Wuthering Waves.',
        excludeUrls: ['https://cdn.discordapp.com/attachments/replied.png']
    });
    assert.deepEqual(getImageAttachmentUrls(referencedMessage), ['https://cdn.discordapp.com/attachments/replied.png']);
});

test('image extension helpers choose Discord-previewable names', () => {
    assert.equal(getImageExtensionFromContentType('image/jpeg; charset=binary'), 'jpg');
    assert.equal(getImageExtensionFromContentType('image/webp'), 'webp');
    assert.equal(getImageExtensionFromUrl('https://example.com/image.png?size=large'), 'png');
    assert.equal(getImageExtensionFromUrl('https://example.com/premium_photo-123'), '');
});

test('buildImageFileAttachment throws typed error for blocked image downloads', async () => {
    const originalFetch = global.fetch;

    global.fetch = async () => ({
        ok: false,
        status: 403
    });

    try {
        await assert.rejects(
            () => buildImageFileAttachment('https://example.com/photo'),
            error => {
                assert.equal(error instanceof ImageAttachmentError, true);
                assert.equal(error.code, 'DOWNLOAD_FAILED');
                assert.equal(error.message, 'Image download failed: 403');
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
    }
});
