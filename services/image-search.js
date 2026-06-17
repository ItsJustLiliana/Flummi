const fs = require('fs');
const path = require('path');

const DEFAULT_OPENVERSE_IMAGE_SEARCH_URL = 'https://api.openverse.org/v1/images/';
const DEFAULT_WIKIMEDIA_IMAGE_SEARCH_URL = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_DUCKDUCKGO_SEARCH_URL = 'https://duckduckgo.com/';
const DEFAULT_DUCKDUCKGO_IMAGE_SEARCH_URL = 'https://duckduckgo.com/i.js';

class ImageSearchError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ImageSearchError';
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

function normalizeProviders(providers, provider) {
    const configured = Array.isArray(providers) ? providers : [provider || 'duckduckgo', 'openverse', 'wikimedia'];
    const clean = configured
        .filter(item => typeof item === 'string' && item.trim())
        .map(item => item.trim().toLowerCase());

    return Array.from(new Set(clean.length ? clean : ['duckduckgo', 'openverse', 'wikimedia']));
}

function getImageSearchConfig() {
    const config = getConfig();
    const imageSearch = config.ai?.imageSearch || {};

    return {
        enabled: config.features?.aiImageSearchEnabled !== false && imageSearch.enabled !== false,
        providers: normalizeProviders(imageSearch.providers, imageSearch.provider),
        duckduckgoSearchUrl: process.env.DUCKDUCKGO_SEARCH_URL || imageSearch.duckduckgoSearchUrl || DEFAULT_DUCKDUCKGO_SEARCH_URL,
        duckduckgoImageSearchUrl: process.env.DUCKDUCKGO_IMAGE_SEARCH_URL || imageSearch.duckduckgoImageSearchUrl || DEFAULT_DUCKDUCKGO_IMAGE_SEARCH_URL,
        openverseBaseUrl: process.env.OPENVERSE_IMAGE_SEARCH_URL || imageSearch.openverseBaseUrl || DEFAULT_OPENVERSE_IMAGE_SEARCH_URL,
        wikimediaBaseUrl: process.env.WIKIMEDIA_IMAGE_SEARCH_URL || imageSearch.wikimediaBaseUrl || DEFAULT_WIKIMEDIA_IMAGE_SEARCH_URL,
        count: Math.min(20, Math.max(1, Number(imageSearch.count) || 5)),
        safeSearch: imageSearch.safeSearch || 'strict',
        searchLang: imageSearch.searchLang || 'nl'
    };
}

function isUsableImageUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
}

function extractDuckDuckGoVqd(html) {
    const text = String(html || '');
    const patterns = [
        /vqd=['"]([^'"]+)['"]/i,
        /vqd=([^&"'\\\s]+)/i,
        /"vqd":"([^"]+)"/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);

        if (match?.[1]) {
            return match[1];
        }
    }

    return '';
}

function normalizeDuckDuckGoImageResult(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const imageUrl = item.image || item.thumbnail || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: item.title || 'DuckDuckGo image result',
        imageUrl,
        originalUrl: item.image || imageUrl,
        sourceUrl: item.url || item.image || imageUrl,
        width: item.width || null,
        height: item.height || null,
        provider: 'duckduckgo',
        creator: '',
        license: ''
    };
}

function normalizeDuckDuckGoImageResults(data) {
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
        .map(normalizeDuckDuckGoImageResult)
        .filter(Boolean);
}

function normalizeOpenverseImageResult(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const imageUrl = item.thumbnail || item.url || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: item.title || 'Openverse image result',
        imageUrl,
        originalUrl: item.url || imageUrl,
        sourceUrl: item.foreign_landing_url || item.url || imageUrl,
        width: item.width || null,
        height: item.height || null,
        provider: 'openverse',
        creator: item.creator || '',
        license: item.license || ''
    };
}

function normalizeOpenverseImageResults(data) {
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
        .map(normalizeOpenverseImageResult)
        .filter(Boolean);
}

function normalizeWikimediaImageResult(page) {
    if (!page || typeof page !== 'object') {
        return null;
    }

    const imageInfo = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    const imageUrl = imageInfo?.thumburl || imageInfo?.url || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: page.title ? page.title.replace(/^File:/i, '') : 'Wikimedia image result',
        imageUrl,
        originalUrl: imageInfo?.url || imageUrl,
        sourceUrl: imageInfo?.descriptionurl || imageInfo?.url || imageUrl,
        width: imageInfo?.thumbwidth || imageInfo?.width || null,
        height: imageInfo?.thumbheight || imageInfo?.height || null,
        provider: 'wikimedia',
        creator: imageInfo?.extmetadata?.Artist?.value || '',
        license: imageInfo?.extmetadata?.LicenseShortName?.value || ''
    };
}

function normalizeWikimediaImageResults(data) {
    const pages = data?.query?.pages && typeof data.query.pages === 'object'
        ? Object.values(data.query.pages)
        : [];

    return pages
        .map(normalizeWikimediaImageResult)
        .filter(Boolean);
}

async function searchOpenverseImages(query, cfg) {
    const url = new URL(cfg.openverseBaseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('page_size', String(cfg.count));
    url.searchParams.set('mature', cfg.safeSearch === 'off' ? 'true' : 'false');

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'AlcoholismBot/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new ImageSearchError(`Openverse image search failed: ${response.status} ${errorText}`, 'REQUEST_FAILED');
    }

    return normalizeOpenverseImageResults(await response.json());
}

async function searchDuckDuckGoImages(query, cfg) {
    const tokenUrl = new URL(cfg.duckduckgoSearchUrl);
    tokenUrl.searchParams.set('q', query);
    tokenUrl.searchParams.set('iax', 'images');
    tokenUrl.searchParams.set('ia', 'images');

    const tokenResponse = await fetch(tokenUrl, {
        headers: {
            Accept: 'text/html',
            'User-Agent': 'Mozilla/5.0 AlcoholismBot/1.0'
        }
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new ImageSearchError(`DuckDuckGo token request failed: ${tokenResponse.status} ${errorText}`, 'REQUEST_FAILED');
    }

    const vqd = extractDuckDuckGoVqd(await tokenResponse.text());

    if (!vqd) {
        throw new ImageSearchError('DuckDuckGo image token was not found.', 'REQUEST_FAILED');
    }

    const url = new URL(cfg.duckduckgoImageSearchUrl);
    url.searchParams.set('l', cfg.searchLang === 'nl' ? 'nl-nl' : 'us-en');
    url.searchParams.set('o', 'json');
    url.searchParams.set('q', query);
    url.searchParams.set('vqd', vqd);
    url.searchParams.set('f', ',,,');
    url.searchParams.set('p', cfg.safeSearch === 'off' ? '-1' : '1');

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Referer: tokenUrl.toString(),
            'User-Agent': 'Mozilla/5.0 AlcoholismBot/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new ImageSearchError(`DuckDuckGo image search failed: ${response.status} ${errorText}`, 'REQUEST_FAILED');
    }

    return normalizeDuckDuckGoImageResults(await response.json());
}

async function searchWikimediaImages(query, cfg) {
    const url = new URL(cfg.wikimediaBaseUrl);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', String(cfg.count));
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|size|mime|extmetadata');
    url.searchParams.set('iiurlwidth', '900');

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'AlcoholismBot/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new ImageSearchError(`Wikimedia image search failed: ${response.status} ${errorText}`, 'REQUEST_FAILED');
    }

    return normalizeWikimediaImageResults(await response.json());
}

async function searchProviderImages(provider, query, cfg) {
    if (provider === 'duckduckgo') {
        return searchDuckDuckGoImages(query, cfg);
    }

    if (provider === 'openverse') {
        return searchOpenverseImages(query, cfg);
    }

    if (provider === 'wikimedia') {
        return searchWikimediaImages(query, cfg);
    }

    throw new ImageSearchError(`Unsupported image search provider: ${provider}`, 'UNSUPPORTED_PROVIDER');
}

async function searchImage(query) {
    const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim();
    const cfg = getImageSearchConfig();
    let lastError = null;

    if (!cfg.enabled || !cleanQuery) {
        return null;
    }

    for (const provider of cfg.providers) {
        try {
            const results = await searchProviderImages(provider, cleanQuery, cfg);

            if (results.length > 0) {
                return results[0];
            }
        } catch (error) {
            lastError = error;
            console.warn(`Image search provider ${provider} failed:`, error);
        }
    }

    if (lastError) {
        throw lastError;
    }

    return null;
}

module.exports = {
    ImageSearchError,
    extractDuckDuckGoVqd,
    getImageSearchConfig,
    normalizeDuckDuckGoImageResult,
    normalizeDuckDuckGoImageResults,
    normalizeOpenverseImageResult,
    normalizeOpenverseImageResults,
    normalizeWikimediaImageResult,
    normalizeWikimediaImageResults,
    searchImage
};
