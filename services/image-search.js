const fs = require('fs');
const path = require('path');
const { recordSerperImageSearch } = require('../stores/serper-usage-store');

const DEFAULT_OPENVERSE_IMAGE_SEARCH_URL = 'https://api.openverse.org/v1/images/';
const DEFAULT_WIKIMEDIA_IMAGE_SEARCH_URL = 'https://commons.wikimedia.org/w/api.php';
const DEFAULT_DUCKDUCKGO_SEARCH_URL = 'https://duckduckgo.com/';
const DEFAULT_DUCKDUCKGO_IMAGE_SEARCH_URL = 'https://duckduckgo.com/i.js';
const DEFAULT_BRAVE_IMAGE_SEARCH_URL = 'https://api.search.brave.com/res/v1/images/search';
const DEFAULT_SERPER_IMAGE_SEARCH_URL = 'https://google.serper.dev/images';
const DEFAULT_SERPAPI_IMAGE_SEARCH_URL = 'https://serpapi.com/search.json';
const MIN_IMAGE_RESULT_SCORE = 8;
const PROVIDER_BLOCK_COOLDOWN_MS = 10 * 60 * 1000;
const blockedProviders = new Map();

class ImageSearchError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'ImageSearchError';
        this.code = code;
        this.provider = details.provider || '';
        this.statusCode = details.statusCode || null;
        this.responseText = details.responseText || '';
    }
}

function parseErrorResponse(errorText) {
    try {
        return JSON.parse(errorText);
    } catch {
        return null;
    }
}

function getErrorReason(errorText) {
    const data = parseErrorResponse(errorText);
    const error = data?.error;
    const firstDetail = Array.isArray(error?.errors) ? error.errors[0] : null;

    return [
        firstDetail?.reason,
        error?.status,
        error?.message
    ].filter(Boolean).join(' | ');
}

function createRequestError(provider, statusCode, errorText) {
    const reason = getErrorReason(errorText);
    const suffix = reason ? ` (${reason})` : '';

    return new ImageSearchError(
        `${provider} image search failed: ${statusCode}${suffix}`,
        'REQUEST_FAILED',
        {
            provider,
            statusCode,
            responseText: errorText
        }
    );
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
    const defaultProviders = ['serper', 'serpapi'];
    const configured = Array.isArray(providers) ? providers : [provider || defaultProviders[0], ...defaultProviders.slice(1)];
    const clean = configured
        .filter(item => typeof item === 'string' && item.trim())
        .map(item => item.trim().toLowerCase());

    return Array.from(new Set(clean.length ? clean : defaultProviders));
}

function getImageSearchConfig() {
    const config = getConfig();
    const imageSearch = config.ai?.imageSearch || {};

    return {
        enabled: config.features?.aiImageSearchEnabled !== false && imageSearch.enabled !== false,
        providers: normalizeProviders(imageSearch.providers, imageSearch.provider),
        duckduckgoSearchUrl: process.env.DUCKDUCKGO_SEARCH_URL || imageSearch.duckduckgoSearchUrl || DEFAULT_DUCKDUCKGO_SEARCH_URL,
        duckduckgoImageSearchUrl: process.env.DUCKDUCKGO_IMAGE_SEARCH_URL || imageSearch.duckduckgoImageSearchUrl || DEFAULT_DUCKDUCKGO_IMAGE_SEARCH_URL,
        braveApiKey: process.env.BRAVE_SEARCH_API_KEY || imageSearch.braveApiKey || '',
        braveBaseUrl: process.env.BRAVE_IMAGE_SEARCH_URL || imageSearch.braveBaseUrl || DEFAULT_BRAVE_IMAGE_SEARCH_URL,
        braveCountry: imageSearch.braveCountry || 'NL',
        serperApiKey: process.env.SERPER_API_KEY || imageSearch.serperApiKey || '',
        serperBaseUrl: process.env.SERPER_IMAGE_SEARCH_URL || imageSearch.serperBaseUrl || DEFAULT_SERPER_IMAGE_SEARCH_URL,
        serpApiKey: process.env.SERPAPI_API_KEY || imageSearch.serpApiKey || '',
        serpApiBaseUrl: process.env.SERPAPI_IMAGE_SEARCH_URL || imageSearch.serpApiBaseUrl || DEFAULT_SERPAPI_IMAGE_SEARCH_URL,
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

function isProviderTemporarilyBlocked(provider) {
    const blockedUntil = blockedProviders.get(provider);

    if (!blockedUntil) {
        return false;
    }

    if (blockedUntil <= Date.now()) {
        blockedProviders.delete(provider);
        return false;
    }

    return true;
}

function markProviderTemporarilyBlocked(provider) {
    blockedProviders.set(provider, Date.now() + PROVIDER_BLOCK_COOLDOWN_MS);
}

function isProviderBlockError(error) {
    const text = String(error?.message || '').toLowerCase();

    return error?.statusCode === 403 || text.includes('too many requests') || text.includes('rate limit');
}

function isSerperQuotaError(error) {
    const text = [
        error?.message,
        error?.responseText
    ].filter(Boolean).join(' ').toLowerCase();

    return (
        error?.provider === 'Serper' &&
        (
            error?.statusCode === 402 ||
            error?.statusCode === 403 ||
            error?.statusCode === 429 ||
            text.includes('credit') ||
            text.includes('quota') ||
            text.includes('limit') ||
            text.includes('insufficient')
        )
    );
}

function createImageSearchUnavailableError(error) {
    return new ImageSearchError(
        'Image search is temporarily unavailable.',
        'IMAGE_SEARCH_UNAVAILABLE',
        {
            provider: error?.provider || '',
            statusCode: error?.statusCode || null,
            responseText: error?.responseText || ''
        }
    );
}

function getSearchTerms(query) {
    return String(query || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .map(term => term.trim())
        .filter(term => term.length >= 3);
}

function scoreImageResult(result, query) {
    const terms = getSearchTerms(query);
    const title = String(result.title || '').toLowerCase();
    const sourceUrl = String(result.sourceUrl || '').toLowerCase();
    const imageUrl = String(result.imageUrl || '').toLowerCase();
    let score = 0;

    for (const term of terms) {
        if (title.includes(term)) {
            score += 4;
        }

        if (sourceUrl.includes(term)) {
            score += 2;
        }

        if (imageUrl.includes(term)) {
            score += 1;
        }
    }

    if (terms.length > 0 && title.includes(terms.join(' '))) {
        score += 8;
    }

    if (result.width && result.height) {
        score += 2;
    }

    if (result.provider === 'brave') {
        score += 5;
    } else if (result.provider === 'serper' || result.provider === 'serpapi') {
        score += 5;
    } else if (result.provider === 'duckduckgo') {
        score += 3;
    } else if (result.provider === 'openverse') {
        score += 1;
    }

    return score;
}

function rankImageResults(results, query) {
    return results
        .map((result, index) => ({
            result,
            index,
            score: scoreImageResult(result, query)
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(item => item.result);
}

function normalizeComparableUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.toString().toLowerCase();
    } catch {
        return String(url || '').trim().toLowerCase();
    }
}

function shouldExcludeImageResult(result, excludeUrls) {
    const excluded = new Set(
        (Array.isArray(excludeUrls) ? excludeUrls : [])
            .map(normalizeComparableUrl)
            .filter(Boolean)
    );

    if (excluded.size === 0) {
        return false;
    }

    return [
        result?.imageUrl,
        result?.originalUrl,
        result?.sourceUrl
    ].some(url => excluded.has(normalizeComparableUrl(url)));
}

function pickBestImageResult(results, query, options = {}) {
    const excludeUrls = Array.isArray(options.excludeUrls) ? options.excludeUrls : [];
    const ranked = results
        .filter(result => !shouldExcludeImageResult(result, excludeUrls))
        .map((result, index) => ({
            result,
            index,
            score: scoreImageResult(result, query)
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index);
    const best = ranked[0];

    if (!best || best.score < MIN_IMAGE_RESULT_SCORE) {
        return null;
    }

    return best.result;
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

function normalizeBraveImageResult(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const properties = item.properties && typeof item.properties === 'object' ? item.properties : {};
    const thumbnail = item.thumbnail && typeof item.thumbnail === 'object' ? item.thumbnail : {};
    const imageUrl = properties.url || thumbnail.src || item.url || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: item.title || 'Brave image result',
        imageUrl,
        originalUrl: properties.url || imageUrl,
        sourceUrl: item.url || item.source || imageUrl,
        width: properties.width || thumbnail.width || null,
        height: properties.height || thumbnail.height || null,
        provider: 'brave',
        creator: item.source || '',
        license: ''
    };
}

function normalizeBraveImageResults(data) {
    const results = Array.isArray(data?.results) ? data.results : [];

    return results
        .map(normalizeBraveImageResult)
        .filter(Boolean);
}

function normalizeSerperImageResult(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const imageUrl = item.imageUrl || item.thumbnailUrl || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: item.title || 'Serper image result',
        imageUrl,
        originalUrl: item.imageUrl || imageUrl,
        sourceUrl: item.link || item.source || imageUrl,
        width: item.imageWidth || null,
        height: item.imageHeight || null,
        provider: 'serper',
        creator: item.source || '',
        license: ''
    };
}

function normalizeSerperImageResults(data) {
    const results = Array.isArray(data?.images) ? data.images : [];

    return results
        .map(normalizeSerperImageResult)
        .filter(Boolean);
}

function normalizeSerpApiImageResult(item) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const imageUrl = item.original || item.thumbnail || '';

    if (!isUsableImageUrl(imageUrl)) {
        return null;
    }

    return {
        title: item.title || 'SerpAPI image result',
        imageUrl,
        originalUrl: item.original || imageUrl,
        sourceUrl: item.link || item.source || imageUrl,
        width: item.original_width || null,
        height: item.original_height || null,
        provider: 'serpapi',
        creator: item.source || '',
        license: ''
    };
}

function normalizeSerpApiImageResults(data) {
    const results = Array.isArray(data?.images_results) ? data.images_results : [];

    return results
        .map(normalizeSerpApiImageResult)
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
            'User-Agent': 'Flummi/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('Openverse', response.status, errorText);
    }

    return normalizeOpenverseImageResults(await response.json());
}

async function searchBraveImages(query, cfg) {
    if (!cfg.braveApiKey) {
        return [];
    }

    const url = new URL(cfg.braveBaseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(cfg.count));
    url.searchParams.set('safesearch', cfg.safeSearch === 'off' ? 'off' : 'strict');

    if (cfg.braveCountry) {
        url.searchParams.set('country', cfg.braveCountry);
    }

    if (cfg.searchLang) {
        url.searchParams.set('search_lang', cfg.searchLang);
    }

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'X-Subscription-Token': cfg.braveApiKey,
            'User-Agent': 'Flummi/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('Brave', response.status, errorText);
    }

    return normalizeBraveImageResults(await response.json());
}

async function searchSerperImages(query, cfg) {
    if (!cfg.serperApiKey) {
        return [];
    }

    const body = {
        q: query,
        num: cfg.count,
        safe: cfg.safeSearch === 'off' ? 'off' : 'active'
    };

    if (cfg.braveCountry) {
        body.gl = String(cfg.braveCountry).toLowerCase();
    }

    if (cfg.searchLang) {
        body.hl = cfg.searchLang;
    }

    const response = await fetch(cfg.serperBaseUrl, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-API-KEY': cfg.serperApiKey,
            'User-Agent': 'Flummi/1.0'
        },
        body: JSON.stringify(body)
    });
    recordSerperImageSearch({ statusCode: response.status, ok: response.ok });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('Serper', response.status, errorText);
    }

    return normalizeSerperImageResults(await response.json());
}

async function searchSerpApiImages(query, cfg) {
    if (!cfg.serpApiKey) {
        return [];
    }

    const url = new URL(cfg.serpApiBaseUrl);
    url.searchParams.set('engine', 'google_images');
    url.searchParams.set('api_key', cfg.serpApiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('safe', cfg.safeSearch === 'off' ? 'off' : 'active');

    if (cfg.braveCountry) {
        url.searchParams.set('gl', String(cfg.braveCountry).toLowerCase());
    }

    if (cfg.searchLang) {
        url.searchParams.set('hl', cfg.searchLang);
    }

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'Flummi/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('SerpAPI', response.status, errorText);
    }

    return normalizeSerpApiImageResults(await response.json());
}

async function searchDuckDuckGoImages(query, cfg) {
    const tokenUrl = new URL(cfg.duckduckgoSearchUrl);
    tokenUrl.searchParams.set('q', query);
    tokenUrl.searchParams.set('iax', 'images');
    tokenUrl.searchParams.set('ia', 'images');

    const tokenResponse = await fetch(tokenUrl, {
        headers: {
            Accept: 'text/html',
            'User-Agent': 'Mozilla/5.0 Flummi/1.0'
        }
    });

    if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw createRequestError('DuckDuckGo token', tokenResponse.status, errorText);
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
            'User-Agent': 'Mozilla/5.0 Flummi/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('DuckDuckGo', response.status, errorText);
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
            'User-Agent': 'Flummi/1.0'
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw createRequestError('Wikimedia', response.status, errorText);
    }

    return normalizeWikimediaImageResults(await response.json());
}

async function searchProviderImages(provider, query, cfg) {
    if (provider === 'serper') {
        return searchSerperImages(query, cfg);
    }

    if (provider === 'serpapi') {
        return searchSerpApiImages(query, cfg);
    }

    if (provider === 'brave') {
        return searchBraveImages(query, cfg);
    }

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

async function searchImage(query, options = {}) {
    const cleanQuery = String(query || '').replace(/\s+/g, ' ').trim();
    const cfg = getImageSearchConfig();
    let lastError = null;
    const collectedResults = [];

    if (!cfg.enabled || !cleanQuery) {
        return null;
    }

    for (const provider of cfg.providers) {
        if (isProviderTemporarilyBlocked(provider)) {
            continue;
        }

        try {
            const results = await searchProviderImages(provider, cleanQuery, cfg);

            if (results.length > 0) {
                collectedResults.push(...results);
            }
        } catch (error) {
            lastError = error;

            if (isSerperQuotaError(error)) {
                markProviderTemporarilyBlocked(provider);
                console.log(`Image search provider ${provider} is temporarily unavailable: ${error.message}`);
                throw createImageSearchUnavailableError(error);
            }

            if (isProviderBlockError(error)) {
                markProviderTemporarilyBlocked(provider);
                console.log(`Image search provider ${provider} is temporarily unavailable: ${error.message}`);
            } else {
                console.warn(`Image search provider ${provider} failed:`, error);
            }
        }
    }

    if (collectedResults.length > 0) {
        return pickBestImageResult(collectedResults, cleanQuery, options);
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
    normalizeComparableUrl,
    pickBestImageResult,
    rankImageResults,
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
    searchImage
};
