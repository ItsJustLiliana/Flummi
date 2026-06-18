const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractDuckDuckGoVqd,
    normalizeBraveImageResult,
    normalizeBraveImageResults,
    normalizeSerperImageResult,
    normalizeSerperImageResults,
    normalizeSerpApiImageResult,
    normalizeSerpApiImageResults,
    normalizeDuckDuckGoImageResult,
    normalizeDuckDuckGoImageResults,
    normalizeOpenverseImageResult,
    normalizeOpenverseImageResults,
    normalizeWikimediaImageResult,
    normalizeWikimediaImageResults,
    normalizeComparableUrl,
    pickBestImageResult,
    rankImageResults,
    searchImage
} = require('../services/image-search');

test('extractDuckDuckGoVqd reads image token from search HTML', () => {
    assert.equal(
        extractDuckDuckGoVqd('some script vqd="4-123456789012345678901234567890" more script'),
        '4-123456789012345678901234567890'
    );
});

test('normalizeDuckDuckGoImageResult uses direct image URL for Discord embeds', () => {
    const result = normalizeDuckDuckGoImageResult({
        title: 'Iuno Wuthering Waves',
        image: 'https://example.com/iuno.jpg',
        thumbnail: 'https://example.com/thumb.jpg',
        url: 'https://example.com/source',
        width: 900,
        height: 600
    });

    assert.equal(result.title, 'Iuno Wuthering Waves');
    assert.equal(result.imageUrl, 'https://example.com/iuno.jpg');
    assert.equal(result.originalUrl, 'https://example.com/iuno.jpg');
    assert.equal(result.sourceUrl, 'https://example.com/source');
    assert.equal(result.provider, 'duckduckgo');
});

test('normalizeDuckDuckGoImageResults drops empty image results', () => {
    const results = normalizeDuckDuckGoImageResults({
        results: [
            { title: 'missing' },
            { title: 'valid', image: 'https://example.com/valid.webp' }
        ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/valid.webp');
});

test('normalizeBraveImageResult uses original image properties', () => {
    const result = normalizeBraveImageResult({
        title: 'Ludwig Ahgren streamer portrait',
        url: 'https://example.com/page',
        source: 'example.com',
        thumbnail: {
            src: 'https://imgs.search.brave.com/thumb.jpg',
            width: 500,
            height: 333
        },
        properties: {
            url: 'https://example.com/ludwig.jpg',
            width: 1200,
            height: 800
        }
    });

    assert.equal(result.title, 'Ludwig Ahgren streamer portrait');
    assert.equal(result.imageUrl, 'https://example.com/ludwig.jpg');
    assert.equal(result.originalUrl, 'https://example.com/ludwig.jpg');
    assert.equal(result.sourceUrl, 'https://example.com/page');
    assert.equal(result.provider, 'brave');
});

test('normalizeBraveImageResults drops missing image results', () => {
    const results = normalizeBraveImageResults({
        results: [
            { title: 'missing' },
            { title: 'valid', thumbnail: { src: 'https://example.com/valid.jpg' } }
        ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/valid.jpg');
});

test('normalizeSerperImageResult reads image results', () => {
    const result = normalizeSerperImageResult({
        title: 'El Primo Brawl Stars',
        imageUrl: 'https://example.com/el-primo.png',
        link: 'https://example.com/el-primo',
        source: 'example.com',
        imageWidth: 800,
        imageHeight: 600
    });

    assert.equal(result.title, 'El Primo Brawl Stars');
    assert.equal(result.imageUrl, 'https://example.com/el-primo.png');
    assert.equal(result.sourceUrl, 'https://example.com/el-primo');
    assert.equal(result.provider, 'serper');
});

test('normalizeSerperImageResults drops missing image results', () => {
    const results = normalizeSerperImageResults({
        images: [
            { title: 'missing' },
            { title: 'valid', thumbnailUrl: 'https://example.com/valid.jpg' }
        ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/valid.jpg');
});

test('searchImage stops with unavailable error when Serper credits are exhausted', async () => {
    const originalFetch = global.fetch;
    const originalConsoleLog = console.log;
    const originalApiKey = process.env.SERPER_API_KEY;
    const originalSerpApiKey = process.env.SERPAPI_API_KEY;

    process.env.SERPER_API_KEY = 'test-serper-key';
    delete process.env.SERPAPI_API_KEY;
    console.log = () => {};
    global.fetch = async () => ({
        ok: false,
        status: 429,
        async text() {
            return JSON.stringify({ message: 'Not enough credits' });
        }
    });

    try {
        await assert.rejects(
            () => searchImage('el primo brawl stars'),
            error => {
                assert.equal(error.name, 'ImageSearchError');
                assert.equal(error.code, 'IMAGE_SEARCH_UNAVAILABLE');
                return true;
            }
        );
    } finally {
        global.fetch = originalFetch;
        console.log = originalConsoleLog;

        if (originalApiKey === undefined) {
            delete process.env.SERPER_API_KEY;
        } else {
            process.env.SERPER_API_KEY = originalApiKey;
        }

        if (originalSerpApiKey === undefined) {
            delete process.env.SERPAPI_API_KEY;
        } else {
            process.env.SERPAPI_API_KEY = originalSerpApiKey;
        }
    }
});

test('normalizeSerpApiImageResult reads google images fields', () => {
    const result = normalizeSerpApiImageResult({
        title: 'El Primo Brawl Stars',
        original: 'https://example.com/el-primo.png',
        link: 'https://example.com/el-primo',
        source: 'example.com',
        original_width: 800,
        original_height: 600
    });

    assert.equal(result.title, 'El Primo Brawl Stars');
    assert.equal(result.imageUrl, 'https://example.com/el-primo.png');
    assert.equal(result.sourceUrl, 'https://example.com/el-primo');
    assert.equal(result.provider, 'serpapi');
});

test('normalizeSerpApiImageResults drops missing image results', () => {
    const results = normalizeSerpApiImageResults({
        images_results: [
            { title: 'missing' },
            { title: 'valid', thumbnail: 'https://example.com/valid.jpg' }
        ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/valid.jpg');
});

test('rankImageResults prefers stronger title and source matches over first result', () => {
    const results = rankImageResults([
        {
            title: 'Random streamer photo',
            imageUrl: 'https://example.com/random.jpg',
            sourceUrl: 'https://example.com/random',
            provider: 'duckduckgo'
        },
        {
            title: 'Ludwig Ahgren portrait',
            imageUrl: 'https://example.com/ludwig.jpg',
            sourceUrl: 'https://example.com/ludwig-ahgren',
            width: 1200,
            height: 800,
            provider: 'openverse'
        }
    ], 'Ludwig Ahgren streamer portrait');

    assert.equal(results[0].title, 'Ludwig Ahgren portrait');
});

test('pickBestImageResult rejects weak unrelated commons matches', () => {
    const result = pickBestImageResult([
        {
            title: 'Loreley - a romantic opera in three acts',
            imageUrl: 'https://upload.wikimedia.org/book.jpg',
            sourceUrl: 'https://commons.wikimedia.org/wiki/File:Loreleyromanticopera.pdf',
            width: 900,
            height: 1200,
            provider: 'wikimedia'
        }
    ], 'el primo brawl stars');

    assert.equal(result, null);
});

test('pickBestImageResult excludes previously used image urls', () => {
    const result = pickBestImageResult([
        {
            title: 'Freddy Fazbear first',
            imageUrl: 'https://example.com/freddy-a.jpg',
            sourceUrl: 'https://example.com/a',
            width: 800,
            height: 600,
            provider: 'serper'
        },
        {
            title: 'Freddy Fazbear second',
            imageUrl: 'https://example.com/freddy-b.jpg',
            sourceUrl: 'https://example.com/b',
            width: 800,
            height: 600,
            provider: 'serper'
        }
    ], 'freddy fazbear', {
        excludeUrls: ['https://example.com/freddy-a.jpg']
    });

    assert.equal(result.imageUrl, 'https://example.com/freddy-b.jpg');
    assert.equal(normalizeComparableUrl('https://example.com/freddy-a.jpg#preview'), 'https://example.com/freddy-a.jpg');
});

test('normalizeOpenverseImageResult prefers thumbnail for Discord embeds', () => {
    const result = normalizeOpenverseImageResult({
        title: 'Ludwig Ahgren',
        thumbnail: 'https://openverse.example/thumb.jpg',
        url: 'https://openverse.example/original.jpg',
        foreign_landing_url: 'https://example.com/page',
        width: 1200,
        height: 800,
        creator: 'Photographer',
        license: 'cc-by'
    });

    assert.equal(result.title, 'Ludwig Ahgren');
    assert.equal(result.imageUrl, 'https://openverse.example/thumb.jpg');
    assert.equal(result.originalUrl, 'https://openverse.example/original.jpg');
    assert.equal(result.sourceUrl, 'https://example.com/page');
    assert.equal(result.provider, 'openverse');
    assert.equal(result.creator, 'Photographer');
    assert.equal(result.license, 'cc-by');
});

test('normalizeOpenverseImageResults drops empty image results', () => {
    const results = normalizeOpenverseImageResults({
        results: [
            null,
            { title: 'missing image' },
            { title: 'valid', url: 'https://example.com/image.png' }
        ]
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/image.png');
});

test('normalizeWikimediaImageResult uses generated thumbnail and source page', () => {
    const result = normalizeWikimediaImageResult({
        title: 'File:Ludwig.jpg',
        imageinfo: [
            {
                thumburl: 'https://upload.wikimedia.org/thumb.jpg',
                url: 'https://upload.wikimedia.org/original.jpg',
                descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ludwig.jpg',
                thumbwidth: 900,
                thumbheight: 600,
                extmetadata: {
                    Artist: { value: 'Commons user' },
                    LicenseShortName: { value: 'CC BY-SA 4.0' }
                }
            }
        ]
    });

    assert.equal(result.title, 'Ludwig.jpg');
    assert.equal(result.imageUrl, 'https://upload.wikimedia.org/thumb.jpg');
    assert.equal(result.originalUrl, 'https://upload.wikimedia.org/original.jpg');
    assert.equal(result.sourceUrl, 'https://commons.wikimedia.org/wiki/File:Ludwig.jpg');
    assert.equal(result.provider, 'wikimedia');
    assert.equal(result.creator, 'Commons user');
    assert.equal(result.license, 'CC BY-SA 4.0');
});

test('normalizeWikimediaImageResults reads pages object', () => {
    const results = normalizeWikimediaImageResults({
        query: {
            pages: {
                123: {
                    title: 'File:Valid.png',
                    imageinfo: [{ url: 'https://example.com/valid.png' }]
                },
                456: {
                    title: 'File:Missing.png'
                }
            }
        }
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].imageUrl, 'https://example.com/valid.png');
});
