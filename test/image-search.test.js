const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractDuckDuckGoVqd,
    normalizeDuckDuckGoImageResult,
    normalizeDuckDuckGoImageResults,
    normalizeOpenverseImageResult,
    normalizeOpenverseImageResults,
    normalizeWikimediaImageResult,
    normalizeWikimediaImageResults
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
