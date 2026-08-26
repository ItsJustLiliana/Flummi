const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { correctAnalytics, normalizeFilters } = require('../services/analytics-correction-service');

function temporaryRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-correction-')); }

test('analytics correction previews and removes only matching personal records', () => {
    const root = temporaryRoot();
    try {
        const guildRoot = path.join(root, 'guilds', '123');
        const source = path.join(guildRoot, 'analytics', 'messages', 'events.ndjson');
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, [
            JSON.stringify({ type: 'message', at: '2026-01-01T10:00:00.000Z', userId: '7', channelId: '9' }),
            JSON.stringify({ type: 'message', at: '2026-01-01T11:00:00.000Z', userId: '8', channelId: '9' })
        ].join('\n') + '\n');
        const input = { category: 'messages', from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.999Z', userId: '7' };
        const preview = correctAnalytics('123', input, { root });
        assert.equal(preview.applied, false);
        assert.equal(preview.raw.matched, 1);
        assert.equal(fs.readFileSync(source, 'utf8').trim().split('\n').length, 2);
        const applied = correctAnalytics('123', input, { root, apply: true });
        assert.equal(applied.raw.matched, 1);
        const remaining = JSON.parse(fs.readFileSync(source, 'utf8').trim());
        assert.equal(remaining.userId, '8');
        const rollup = JSON.parse(fs.readFileSync(path.join(guildRoot, 'analytics', 'rollups', 'message-stats.json'), 'utf8'));
        assert.equal(rollup.messages.total, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('anonymous analytics correction removes complete requested days only', () => {
    const root = temporaryRoot();
    try {
        const rollups = path.join(root, 'guilds', '123', 'analytics', 'rollups');
        fs.mkdirSync(rollups, { recursive: true });
        fs.writeFileSync(path.join(rollups, 'anonymous-history.json'), JSON.stringify({ version: 1, messages: { byDay: { '2025-01-01': { count: 4 }, '2025-01-02': { count: 6 } } }, voice: { byDay: {} } }));
        const result = correctAnalytics('123', { category: 'messages', from: '2025-01-01T00:00:00.000Z', to: '2025-01-01T23:59:59.999Z', includeAnonymous: true }, { root, apply: true });
        assert.deepEqual(result.anonymous.dates, ['2025-01-01']);
        const history = JSON.parse(fs.readFileSync(path.join(rollups, 'anonymous-history.json'), 'utf8'));
        assert.equal(history.messages.byDay['2025-01-01'], undefined);
        assert.equal(history.messages.byDay['2025-01-02'].count, 6);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('anonymous correction rejects member and channel filters', () => {
    assert.throws(() => normalizeFilters({ category: 'voice', from: '2026-01-01', to: '2026-01-02', userId: '7', includeAnonymous: true }), /complete server-wide UTC days/);
});
