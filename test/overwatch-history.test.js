const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createOverwatchHistoryStore, DEFAULT_PLAYER_ID, emptyState } = require('../stores/overwatch-history-store');
const {
    createOverwatchHistoryService,
    reconstructHistoryEvent,
    safePlayerPath,
    snapshotsEqual
} = require('../services/overwatch-history-service');

function stats(gamesPlayed, gamesWon, gamesLost, extra = {}) {
    return {
        gamesPlayed,
        gamesWon,
        gamesLost,
        timePlayed: extra.timePlayed ?? gamesPlayed * 600,
        totals: {
            eliminations: extra.eliminations ?? gamesPlayed * 10,
            assists: extra.assists ?? gamesPlayed * 5,
            deaths: extra.deaths ?? gamesPlayed * 4,
            damage: extra.damage ?? gamesPlayed * 1000,
            healing: extra.healing ?? gamesPlayed * 500
        },
        roles: extra.roles || {},
        heroes: extra.heroes || {},
        modes: extra.modes || { competitive: null, quickplay: null }
    };
}

function apiStats(gamesPlayed, gamesWon, gamesLost) {
    return {
        general: {
            games_played: gamesPlayed,
            games_won: gamesWon,
            games_lost: gamesLost,
            time_played: gamesPlayed * 600,
            total: { eliminations: gamesPlayed * 10, assists: gamesPlayed * 5, deaths: gamesPlayed * 4, damage: gamesPlayed * 1000, healing: gamesPlayed * 500 }
        },
        roles: {},
        heroes: {}
    };
}

function response(body, status = 200, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: key => headers[String(key).toLowerCase()] || null },
        json: async () => body
    };
}

function memoryStore(initial = emptyState()) {
    let state = structuredClone(initial);
    return {
        historyLimit: 25,
        read: () => structuredClone(state),
        write: next => {
            state = structuredClone(next);
            return structuredClone(state);
        }
    };
}

function successfulFetch({ gamesPlayed = 10, gamesWon = 6, gamesLost = 4 } = {}) {
    return async url => {
        if (url.includes('/players?')) {
            return response({ results: [{ player_id: 'opaque%7Cplayer', name: 'Liliana#21184', last_updated_at: 1700000000 }] });
        }
        if (url.endsWith('/summary') && !url.includes('/stats/')) {
            return response({ username: 'Liliana', last_updated_at: 1700000000 });
        }
        if (url.includes('gamemode=competitive')) return response(apiStats(gamesPlayed, gamesWon, gamesLost));
        if (url.includes('gamemode=quickplay')) return response(apiStats(0, 0, 0));
        return response(apiStats(gamesPlayed, gamesWon, gamesLost));
    };
}

test('first successful snapshot creates a baseline without fake matches', async () => {
    const store = memoryStore();
    const service = createOverwatchHistoryService({ store, fetchImpl: successfulFetch(), now: () => Date.parse('2026-08-26T12:00:00Z') });

    const result = await service.refresh();

    assert.equal(result.updated, true);
    assert.equal(store.read().history.length, 0);
    assert.equal(store.read().lastSnapshot.gamesPlayed, 10);
    assert.equal(store.read().trackingStartedAt, '2026-08-26T12:00:00.000Z');
});

test('one added win reconstructs one WIN', () => {
    const event = reconstructHistoryEvent(stats(10, 6, 4), stats(11, 7, 4), '2026-08-26T12:00:00Z');
    assert.equal(event.kind, 'single');
    assert.equal(event.games, 1);
    assert.equal(event.result, 'WIN');
});

test('one added loss reconstructs one LOSS', () => {
    const event = reconstructHistoryEvent(stats(11, 7, 4), stats(12, 7, 5), '2026-08-26T12:00:00Z');
    assert.equal(event.kind, 'single');
    assert.equal(event.games, 1);
    assert.equal(event.result, 'LOSS');
});

test('three added games produce one grouped event without invented ordering', () => {
    const event = reconstructHistoryEvent(stats(10, 6, 4), stats(13, 8, 5), '2026-08-26T12:00:00Z');
    assert.equal(event.kind, 'group');
    assert.equal(event.games, 3);
    assert.equal(event.wins, 2);
    assert.equal(event.losses, 1);
    assert.equal(event.exactOrderAvailable, false);
});

test('identical snapshots produce no history event', () => {
    const snapshot = stats(10, 6, 4);
    assert.equal(snapshotsEqual(snapshot, structuredClone(snapshot)), true);
    assert.equal(reconstructHistoryEvent(snapshot, structuredClone(snapshot)), null);
});

test('equivalent hero data remains duplicate-safe regardless of API key order', () => {
    const left = stats(10, 6, 4, { heroes: { ana: stats(3, 2, 1), kiriko: stats(7, 4, 3) } });
    const right = stats(10, 6, 4, { heroes: { kiriko: stats(7, 4, 3), ana: stats(3, 2, 1) } });
    assert.equal(snapshotsEqual(left, right), true);
});

test('API errors preserve the previous valid snapshot', async () => {
    const previous = stats(10, 6, 4);
    const store = memoryStore({ ...emptyState(), playerId: DEFAULT_PLAYER_ID, lastSnapshot: previous });
    const service = createOverwatchHistoryService({
        store,
        fetchImpl: async () => response({ error: 'Unavailable' }, 503, { 'retry-after': '60' }),
        now: () => Date.parse('2026-08-26T12:00:00Z')
    });

    const result = await service.refresh();

    assert.equal(result.updated, false);
    assert.deepEqual(store.read().lastSnapshot, previous);
    assert.match(store.read().error, /503/);
    assert.equal(store.read().nextAllowedRefreshAt, '2026-08-26T12:01:00.000Z');
});

test('persisted history is capped', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-overwatch-'));
    const filePath = path.join(directory, 'history.json');
    try {
        const store = createOverwatchHistoryStore({ filePath, historyLimit: 3 });
        store.write({ ...emptyState(), history: [1, 2, 3, 4, 5].map(id => ({ id })) });
        assert.deepEqual(store.read().history.map(entry => entry.id), [1, 2, 3]);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('manual refresh does not start a concurrent request', async () => {
    let releaseSummary;
    let first = true;
    const fetchImpl = async url => {
        if (first) {
            first = false;
            await new Promise(resolve => { releaseSummary = resolve; });
        }
        return successfulFetch()(url);
    };
    const store = memoryStore({ ...emptyState(), playerId: 'opaque%7Cplayer' });
    const service = createOverwatchHistoryService({ store, fetchImpl });

    const active = service.refresh({ manual: true });
    await new Promise(resolve => setImmediate(resolve));
    const concurrent = await service.refresh({ manual: true });
    assert.equal(concurrent.refreshing, true);

    releaseSummary();
    await active;
    assert.equal(service.getPublicState().refreshing, false);
});

test('opaque OverFast IDs retain existing percent escapes', () => {
    assert.equal(safePlayerPath('d358b8%7C905d21'), 'd358b8%7C905d21');
    assert.doesNotMatch(safePlayerPath('d358b8%7C905d21'), /%257C/i);
});

test('the owner-selected Overwatch candidate is pinned and bypasses rediscovery', async () => {
    const requestedUrls = [];
    const store = memoryStore({ ...emptyState(), playerId: 'wrong-candidate', lastSnapshot: stats(99, 99, 0), history: [{ id: 'wrong-history' }] });
    const service = createOverwatchHistoryService({
        store,
        fetchImpl: async url => {
            requestedUrls.push(url);
            return successfulFetch()(url);
        },
        now: () => Date.parse('2026-08-26T12:00:00Z')
    });

    await service.refresh();

    assert.equal(store.read().playerId, DEFAULT_PLAYER_ID);
    assert.equal(store.read().history.length, 0);
    assert.equal(store.read().candidates.length, 0);
    assert.equal(requestedUrls.some(url => url.includes('/players?')), false);
    assert.equal(requestedUrls.every(url => url.includes(DEFAULT_PLAYER_ID)), true);
    assert.equal(service.getPublicState().playerId, DEFAULT_PLAYER_ID);
});

test('Overwatch experiment endpoints use developer authorization and preserve existing experiments', () => {
    const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');
    const panelClient = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
    assert.match(panelServer, /pathname\.startsWith\('\/api\/experiments\/'\).*?!isDeveloperSession\(panelSession\)/s);
    assert.match(panelServer, /GET' && requestUrl\.pathname === '\/api\/experiments\/overwatch-history'/);
    assert.match(panelServer, /POST' && requestUrl\.pathname === '\/api\/experiments\/overwatch-history\/refresh'/);
    assert.match(panelClient, /async function loadExperiments\(\)/);
    assert.match(panelClient, /saveExperiments/);
    assert.match(panelClient, /loadOverwatchHistory/);
});
