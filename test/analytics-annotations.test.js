const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalyticsAnnotations } = require('../services/analytics-annotations-service');

test('chart annotations collapse repeated audit events on the same day', () => {
    const entries = [
        { at: '2026-08-23T23:15:00.000Z', guildId: 'one', type: 'settings-update', message: 'Updated server settings' },
        { at: '2026-08-23T23:12:00.000Z', guildId: 'one', type: 'settings-update', message: 'Updated server settings' },
        { at: '2026-08-23T22:00:00.000Z', guildId: 'one', type: 'moderation-action', message: 'Timed out member' },
        { at: '2026-08-23T20:00:00.000Z', guildId: 'two', type: 'settings-update', message: 'Updated server settings' }
    ];
    assert.deepEqual(buildAnalyticsAnnotations(entries, 'one'), [
        { at: '2026-08-23T23:15:00.000Z', type: 'settings-update', label: 'Updated server settings', count: 2 },
        { at: '2026-08-23T22:00:00.000Z', type: 'moderation-action', label: 'Timed out member', count: 1 }
    ]);
});
