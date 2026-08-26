const fs = require('fs');
const path = require('path');

const DEFAULT_BATTLETAG = 'Liliana#21184';
const DEFAULT_PLAYER_ID = 'de57a083b27f9ae0bba126a8d0%7C71297088c2a881633dd6ea060ac5593d';
const DEFAULT_HISTORY_LIMIT = 25;

function emptyState(battletag = DEFAULT_BATTLETAG) {
    return {
        version: 1,
        battletag,
        playerId: DEFAULT_PLAYER_ID,
        playerName: 'Liliana',
        consecutiveNotFound: 0,
        trackingStartedAt: null,
        lastCheckedAt: null,
        lastSuccessfulUpdateAt: null,
        lastStatsChangeAt: null,
        lastApiDataAt: null,
        nextAllowedRefreshAt: null,
        lastSnapshot: null,
        history: [],
        candidates: [],
        error: null
    };
}

function normalizeState(value, battletag, historyLimit) {
    const fallback = emptyState(battletag);
    const parsed = value && typeof value === 'object' ? value : {};
    return {
        ...fallback,
        ...parsed,
        battletag,
        playerId: Object.prototype.hasOwnProperty.call(parsed, 'playerId') ? parsed.playerId : DEFAULT_PLAYER_ID,
        candidates: [],
        history: Array.isArray(parsed.history) ? parsed.history.slice(0, historyLimit) : [],
        lastSnapshot: parsed.lastSnapshot && typeof parsed.lastSnapshot === 'object'
            ? parsed.lastSnapshot
            : null
    };
}

function createOverwatchHistoryStore({
    filePath = path.join(__dirname, '..', 'data', 'runtime', 'overwatch-history.json'),
    battletag = DEFAULT_BATTLETAG,
    historyLimit = DEFAULT_HISTORY_LIMIT
} = {}) {
    let state;

    function read() {
        if (state) return structuredClone(state);
        try {
            state = normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')), battletag, historyLimit);
        } catch {
            state = emptyState(battletag);
        }
        return structuredClone(state);
    }

    function write(nextState) {
        state = normalizeState(nextState, battletag, historyLimit);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
        fs.renameSync(temporaryPath, filePath);
        return structuredClone(state);
    }

    function update(updater) {
        const current = read();
        const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
        return write(next);
    }

    return { filePath, historyLimit, read, write, update };
}

module.exports = {
    DEFAULT_BATTLETAG,
    DEFAULT_PLAYER_ID,
    DEFAULT_HISTORY_LIMIT,
    createOverwatchHistoryStore,
    emptyState
};
