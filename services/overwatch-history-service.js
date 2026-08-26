const { createOverwatchHistoryStore, DEFAULT_BATTLETAG, DEFAULT_HISTORY_LIMIT } = require('../stores/overwatch-history-store');

const OVERFAST_BASE_URL = 'https://overfast-api.tekrop.fr';
const TRACKED_USERNAME = 'Liliana';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 3 * 1000;
const REQUEST_TIMEOUT_MS = 20 * 1000;
const MANUAL_REFRESH_COOLDOWN_MS = 30 * 1000;
const REDISCOVERY_NOT_FOUND_COUNT = 2;

class OverwatchApiError extends Error {
    constructor(message, { status = null, retryAfterMs = 0, candidates = [] } = {}) {
        super(message);
        this.name = 'OverwatchApiError';
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.candidates = candidates;
    }
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function compactStats(stats) {
    if (!stats || typeof stats !== 'object') return null;
    const total = stats.total && typeof stats.total === 'object' ? stats.total : {};
    const compact = {
        gamesPlayed: finiteNumber(stats.games_played),
        gamesWon: finiteNumber(stats.games_won),
        gamesLost: finiteNumber(stats.games_lost),
        timePlayed: finiteNumber(stats.time_played),
        totals: {
            eliminations: finiteNumber(total.eliminations),
            assists: finiteNumber(total.assists),
            deaths: finiteNumber(total.deaths),
            damage: finiteNumber(total.damage),
            healing: finiteNumber(total.healing)
        }
    };
    return compact.gamesPlayed === null ? null : compact;
}

function compactCollection(collection) {
    if (!collection || typeof collection !== 'object') return {};
    return Object.fromEntries(Object.entries(collection)
        .map(([key, stats]) => [key, compactStats(stats)])
        .filter(([, stats]) => stats)
        .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeSnapshot({ summary, all, competitive, quickplay }, checkedAt) {
    const general = compactStats(all?.general);
    if (!general) {
        throw new OverwatchApiError('OverFast returned no public career statistics for Liliana#21184.');
    }
    const sourceTimestamp = finiteNumber(summary?.last_updated_at);
    return {
        timestamp: checkedAt,
        sourceLastUpdatedAt: sourceTimestamp === null ? null : new Date(sourceTimestamp * 1000).toISOString(),
        ...general,
        roles: compactCollection(all?.roles),
        heroes: compactCollection(all?.heroes),
        modes: {
            competitive: compactStats(competitive?.general),
            quickplay: compactStats(quickplay?.general)
        }
    };
}

function comparableSnapshot(snapshot) {
    if (!snapshot) return null;
    const { timestamp, sourceLastUpdatedAt, ...stats } = snapshot;
    return stats;
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
}

function snapshotsEqual(previous, current) {
    return JSON.stringify(canonicalValue(comparableSnapshot(previous)))
        === JSON.stringify(canonicalValue(comparableSnapshot(current)));
}

function delta(previous, current, key) {
    const before = finiteNumber(previous?.[key]);
    const after = finiteNumber(current?.[key]);
    return before === null || after === null ? null : after - before;
}

function positiveStatChanges(previous, current) {
    const labels = {
        eliminations: 'eliminations',
        assists: 'assists',
        deaths: 'deaths',
        damage: 'damage',
        healing: 'healing'
    };
    return Object.entries(labels).flatMap(([key, label]) => {
        const change = delta(previous?.totals, current?.totals, key);
        return change !== null && change > 0 ? [{ key, label, change }] : [];
    });
}

function detectedHeroes(previous, current) {
    const keys = new Set([...Object.keys(previous?.heroes || {}), ...Object.keys(current?.heroes || {})]);
    return [...keys].filter(hero => {
        const before = previous?.heroes?.[hero];
        const after = current?.heroes?.[hero];
        const games = delta(before, after, 'gamesPlayed');
        const time = delta(before, after, 'timePlayed');
        return (games !== null && games > 0) || (time !== null && time > 0);
    }).sort();
}

function detectedMode(previous, current, gamesChange) {
    const competitiveChange = delta(previous?.modes?.competitive, current?.modes?.competitive, 'gamesPlayed');
    const quickplayChange = delta(previous?.modes?.quickplay, current?.modes?.quickplay, 'gamesPlayed');
    if (competitiveChange === gamesChange && quickplayChange === 0) return 'Competitive';
    if (quickplayChange === gamesChange && competitiveChange === 0) return 'Quick Play';
    return 'Unknown';
}

function reconstructHistoryEvent(previous, current, detectedAt = new Date().toISOString()) {
    const gamesChange = delta(previous, current, 'gamesPlayed');
    if (gamesChange === null || gamesChange <= 0) return null;

    const winsChange = delta(previous, current, 'gamesWon');
    const lossesChange = delta(previous, current, 'gamesLost');
    const safeWins = winsChange !== null && winsChange >= 0 && winsChange <= gamesChange ? winsChange : null;
    const safeLosses = lossesChange !== null && lossesChange >= 0 && lossesChange <= gamesChange ? lossesChange : null;
    let result = 'UNKNOWN';
    if (gamesChange === 1 && safeWins === 1 && safeLosses === 0) result = 'WIN';
    if (gamesChange === 1 && safeWins === 0 && safeLosses === 1) result = 'LOSS';

    return {
        id: `ow-${Date.parse(detectedAt) || Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        detectedAt,
        kind: gamesChange === 1 ? 'single' : 'group',
        games: gamesChange,
        wins: safeWins,
        losses: safeLosses,
        result,
        mode: detectedMode(previous, current, gamesChange),
        heroes: detectedHeroes(previous, current),
        statChanges: positiveStatChanges(previous, current),
        exactOrderAvailable: gamesChange === 1
    };
}

function exactBattletagCandidate(result, battletag) {
    const normalizedTarget = battletag.toLowerCase().replace('#', '-');
    const displayedValues = [result?.battletag, result?.battle_tag, result?.name, result?.username]
        .filter(value => typeof value === 'string')
        .map(value => value.toLowerCase().replace('#', '-'));
    if (displayedValues.includes(normalizedTarget)) return true;

    const playerId = String(result?.player_id || '').toLowerCase();
    if (playerId === normalizedTarget) return true;
    try {
        const pathname = new URL(result?.career_url).pathname.toLowerCase();
        return pathname.endsWith(`/players/${normalizedTarget}`);
    } catch {
        return false;
    }
}

function safePlayerPath(playerId) {
    return encodeURIComponent(String(playerId)).replace(/%25([0-9a-f]{2})/gi, '%$1');
}

function retryAfterMs(response, body) {
    const header = response.headers?.get?.('retry-after');
    const headerSeconds = Number(header);
    const bodySeconds = Number(body?.retry_after);
    const seconds = Number.isFinite(headerSeconds) ? headerSeconds : bodySeconds;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function createOverwatchHistoryService({
    store = createOverwatchHistoryStore(),
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    requestTimeoutMs = REQUEST_TIMEOUT_MS,
    pollIntervalMs = POLL_INTERVAL_MS,
    startupDelayMs = STARTUP_DELAY_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT
} = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

    let refreshPromise = null;
    let pollTimer = null;
    let nextAutomaticCheckAt = null;
    let stopped = true;
    let lastManualRefreshAt = 0;

    async function fetchJson(pathname) {
        const controller = new AbortController();
        const timeout = setTimeoutImpl(() => controller.abort(), requestTimeoutMs);
        let response;
        try {
            response = await fetchImpl(`${OVERFAST_BASE_URL}${pathname}`, {
                headers: { Accept: 'application/json', 'User-Agent': 'Flummi-Overwatch-History/1.0' },
                signal: controller.signal
            });
        } catch (error) {
            if (error?.name === 'AbortError') throw new OverwatchApiError('OverFast request timed out.');
            throw new OverwatchApiError(`OverFast is temporarily unavailable: ${error?.message || 'network error'}.`);
        } finally {
            clearTimeoutImpl(timeout);
        }

        let body;
        try {
            body = await response.json();
        } catch {
            throw new OverwatchApiError('OverFast returned invalid JSON.', { status: response.status });
        }
        if (!response.ok) {
            const message = [404, 429, 500, 503, 504].includes(response.status)
                ? `OverFast request failed (${response.status}${body?.error ? `: ${body.error}` : ''}).`
                : `Unexpected OverFast response (${response.status}).`;
            throw new OverwatchApiError(message, {
                status: response.status,
                retryAfterMs: retryAfterMs(response, body)
            });
        }
        return body;
    }

    async function discoverPlayerId() {
        const search = await fetchJson(`/players?name=${encodeURIComponent(TRACKED_USERNAME)}&limit=20`);
        const results = Array.isArray(search?.results) ? search.results : [];
        const exact = results.filter(result => exactBattletagCandidate(result, DEFAULT_BATTLETAG));
        if (exact.length !== 1 || !exact[0]?.player_id) {
            const plausible = results.filter(result => String(result?.name || result?.username || '').toLowerCase() === TRACKED_USERNAME.toLowerCase());
            const candidates = await Promise.all(plausible.map(async result => {
                const playerId = String(result.player_id || '');
                const summary = playerId ? await fetchJson(`/players/${safePlayerPath(playerId)}/summary`).catch(() => null) : null;
                return {
                    playerId, name: String(result.name || result.username || TRACKED_USERNAME),
                    avatar: summary?.avatar || null, namecard: summary?.namecard || null,
                    title: summary?.title || null, endorsementLevel: finiteNumber(summary?.endorsement?.level),
                    platform: summary?.competitive?.console ? 'console' : summary?.competitive?.pc ? 'pc' : 'unknown',
                    lastUpdatedAt: finiteNumber(result.last_updated_at) === null ? null : new Date(Number(result.last_updated_at) * 1000).toISOString()
                };
            }));
            const detail = plausible.length === 1
                ? 'One plausible Liliana account was found, but OverFast did not expose enough BattleTag information to verify Liliana#21184 safely.'
                : `Could not safely resolve Liliana#21184 (${plausible.length} plausible Liliana results).`;
            throw new OverwatchApiError(detail, { candidates });
        }
        return {
            playerId: String(exact[0].player_id),
            playerName: String(exact[0].name || exact[0].username || DEFAULT_BATTLETAG),
            lastApiDataAt: finiteNumber(exact[0].last_updated_at) === null
                ? null
                : new Date(Number(exact[0].last_updated_at) * 1000).toISOString()
        };
    }

    async function fetchSnapshot(playerId, checkedAt) {
        const playerPath = safePlayerPath(playerId);
        const summary = await fetchJson(`/players/${playerPath}/summary`);
        const [all, competitive, quickplay] = await Promise.all([
            fetchJson(`/players/${playerPath}/stats/summary`),
            fetchJson(`/players/${playerPath}/stats/summary?gamemode=competitive`),
            fetchJson(`/players/${playerPath}/stats/summary?gamemode=quickplay`)
        ]);
        return normalizeSnapshot({ summary, all, competitive, quickplay }, checkedAt);
    }

    async function performRefresh() {
        const checkedAt = new Date(now()).toISOString();
        let state = store.read();
        try {
            if (!state.playerId) {
                const discovered = await discoverPlayerId();
                state = store.write({ ...state, ...discovered, consecutiveNotFound: 0, error: null });
            }

            let snapshot;
            try {
                snapshot = await fetchSnapshot(state.playerId, checkedAt);
            } catch (error) {
                if (error.status !== 404) throw error;
                const notFoundCount = (Number(state.consecutiveNotFound) || 0) + 1;
                if (notFoundCount < REDISCOVERY_NOT_FOUND_COUNT) {
                    throw Object.assign(error, { notFoundCount });
                }
                const discovered = await discoverPlayerId();
                state = store.write({ ...state, ...discovered, consecutiveNotFound: 0, error: null });
                snapshot = await fetchSnapshot(state.playerId, checkedAt);
            }

            const changed = !state.lastSnapshot || !snapshotsEqual(state.lastSnapshot, snapshot);
            const event = state.lastSnapshot ? reconstructHistoryEvent(state.lastSnapshot, snapshot, checkedAt) : null;
            const nextHistory = event ? [event, ...(state.history || [])].slice(0, historyLimit) : (state.history || []);
            const next = store.write({
                ...state,
                trackingStartedAt: state.trackingStartedAt || checkedAt,
                lastCheckedAt: checkedAt,
                lastSuccessfulUpdateAt: checkedAt,
                lastStatsChangeAt: changed && state.lastSnapshot ? checkedAt : state.lastStatsChangeAt,
                lastApiDataAt: snapshot.sourceLastUpdatedAt || state.lastApiDataAt,
                nextAllowedRefreshAt: null,
                lastSnapshot: snapshot,
                history: nextHistory,
                consecutiveNotFound: 0,
                error: null,
                candidates: []
            });
            return { refreshing: false, updated: true, state: next };
        } catch (error) {
            const current = store.read();
            const retryAt = error.retryAfterMs > 0 ? new Date(now() + error.retryAfterMs).toISOString() : current.nextAllowedRefreshAt;
            const failed = store.write({
                ...current,
                lastCheckedAt: checkedAt,
                consecutiveNotFound: error.notFoundCount || current.consecutiveNotFound || 0,
                nextAllowedRefreshAt: retryAt || null,
                error: error.message || 'OverFast refresh failed.',
                candidates: Array.isArray(error.candidates) ? error.candidates : (current.candidates || [])
            });
            return { refreshing: false, updated: false, error, state: failed };
        }
    }

    function refresh({ manual = false } = {}) {
        if (refreshPromise) return Promise.resolve({ refreshing: true, state: store.read() });
        const state = store.read();
        const currentTime = now();
        const rateLimitUntil = Date.parse(state.nextAllowedRefreshAt || '') || 0;
        const manualCooldownUntil = lastManualRefreshAt > 0
            ? lastManualRefreshAt + MANUAL_REFRESH_COOLDOWN_MS
            : 0;
        const blockedUntil = Math.max(rateLimitUntil, manual ? manualCooldownUntil : 0);
        if (blockedUntil > currentTime) {
            return Promise.resolve({
                refreshing: false,
                cooldown: true,
                retryAt: new Date(blockedUntil).toISOString(),
                state
            });
        }
        if (manual) lastManualRefreshAt = currentTime;
        refreshPromise = performRefresh().finally(() => { refreshPromise = null; });
        return refreshPromise;
    }

    function schedule(delay) {
        if (stopped) return;
        nextAutomaticCheckAt = new Date(now() + delay).toISOString();
        pollTimer = setTimeoutImpl(async () => {
            pollTimer = null;
            nextAutomaticCheckAt = null;
            try {
                await refresh();
            } catch (error) {
                console.error('Overwatch history poll failed:', error);
            } finally {
                schedule(pollIntervalMs);
            }
        }, delay);
        pollTimer?.unref?.();
    }

    function start() {
        if (!stopped) return;
        stopped = false;
        schedule(startupDelayMs);
    }

    function stop() {
        stopped = true;
        if (pollTimer) clearTimeoutImpl(pollTimer);
        pollTimer = null;
        nextAutomaticCheckAt = null;
    }

    function getPublicState() {
        const state = store.read();
        return {
            account: DEFAULT_BATTLETAG,
            status: state.error ? 'error' : (state.lastSnapshot ? 'tracking' : 'waiting'),
            playerIdResolved: Boolean(state.playerId),
            lastCheckedAt: state.lastCheckedAt,
            lastUpdatedAt: state.lastStatsChangeAt,
            lastSuccessfulUpdateAt: state.lastSuccessfulUpdateAt,
            lastApiDataAt: state.lastApiDataAt,
            trackingStartedAt: state.trackingStartedAt,
            nextAutomaticCheckAt,
            nextAllowedRefreshAt: state.nextAllowedRefreshAt,
            refreshing: Boolean(refreshPromise),
            error: state.error,
            candidates: state.candidates || [],
            matches: (state.history || []).slice(0, 3)
        };
    }

    return { start, stop, refresh, getPublicState, store };
}

module.exports = {
    MANUAL_REFRESH_COOLDOWN_MS,
    OVERFAST_BASE_URL,
    POLL_INTERVAL_MS,
    OverwatchApiError,
    compactStats,
    createOverwatchHistoryService,
    detectedHeroes,
    exactBattletagCandidate,
    normalizeSnapshot,
    reconstructHistoryEvent,
    safePlayerPath,
    snapshotsEqual
};
