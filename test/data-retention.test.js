const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DAY_MS, pruneDataRetention } = require('../services/data-retention-service');

function write(filePath, value, { ndjson = false } = {}) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, ndjson ? `${value.map(row => JSON.stringify(row)).join('\n')}\n` : JSON.stringify(value, null, 2));
}

test('central retention removes expired personal data and rebuilds retained rollups', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-retention-'));
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    const old = new Date(now - 400 * DAY_MS).toISOString();
    const recent = new Date(now - 5 * DAY_MS).toISOString();
    try {
        const userRoot = path.join(root, 'global', 'users', '123456789012345678');
        write(path.join(userRoot, 'notifications.json'), [{ id: 'old', createdAt: old }, { id: 'new', createdAt: recent }]);
        write(path.join(userRoot, 'aiMemory.json'), { history: [{ content: 'expired' }], updatedAt: old });
        write(path.join(userRoot, 'profile.json'), { bio: 'expired', updatedAt: old });
        write(path.join(root, 'global', 'privacy-requests.json'), [{ id: 'open', status: 'received', createdAt: old }, { id: 'done', status: 'corrected', updatedAt: old }]);
        write(path.join(root, 'global', 'abuse-reports.json'), [{ id: 'open', status: 'investigating', createdAt: old }, { id: 'done', status: 'resolved', updatedAt: old }]);
        write(path.join(root, 'global', 'feedback-rate-limits.json'), [{ userId: 'old-user', submittedAt: now - 2 * DAY_MS }, { userId: 'new-user', submittedAt: now - 1000 }]);
        write(path.join(root, 'runtime', 'bot.log'), [
            { at: old, level: 'info', message: 'expired' },
            { at: recent, level: 'info', message: 'retained' }
        ], { ndjson: true });

        const guildRoot = path.join(root, 'guilds', 'guild-one');
        write(path.join(guildRoot, 'analytics', 'messages', '2026-08', 'part-0001.ndjson'), [
            { type: 'message', at: old, messageId: 'old-message', userId: 'old-user', userTag: 'Old', channelId: 'one', channelName: 'One' },
            { type: 'message', at: recent, messageId: 'new-message', userId: 'new-user', userTag: 'New', channelId: 'two', channelName: 'Two' }
        ], { ndjson: true });
        write(path.join(guildRoot, 'analytics', 'voice', '2026-08', 'part-0001.ndjson'), [
            { type: 'voice', action: 'session-ended', at: old, startedAt: new Date(new Date(old).getTime() - 5000).toISOString(), endedAt: old, userId: 'old-user', channelId: 'one', durationMs: 5000 },
            { type: 'voice', action: 'session-ended', at: recent, startedAt: new Date(new Date(recent).getTime() - 7000).toISOString(), endedAt: recent, userId: 'new-user', channelId: 'two', durationMs: 7000 }
        ], { ndjson: true });
        write(path.join(guildRoot, 'operations.json'), {
            reports: [{ id: 'old-resolved', status: 'resolved', updatedAt: old }, { id: 'old-open', status: 'open', createdAt: old }],
            reminders: [{ id: 'old-sent', status: 'sent', updatedAt: old }], levels: { 'old-user': { updatedAt: old }, 'new-user': { updatedAt: recent } }, afk: {}, pulseResponses: []
        });
        write(path.join(guildRoot, 'community-management.json'), {
            tickets: [{ id: 'active-ticket', status: 'waiting-user', updatedAt: old }, { id: 'closed-ticket', status: 'closed', closedAt: old }],
            suggestions: [{ id: 'active-suggestion', status: 'under-review', updatedAt: old }, { id: 'done-suggestion', status: 'implemented', updatedAt: old }],
            submissions: [{ id: 'active-submission', status: 'pending', updatedAt: old }, { id: 'done-submission', status: 'resolved', updatedAt: old }]
        });
        write(path.join(guildRoot, 'pingRequests.json'), [{ byId: 'old-user', at: old }, { byId: 'new-user', at: recent }]);

        const recovery = path.join(root, 'runtime', 'file-manager', 'trash', 'expired');
        fs.mkdirSync(recovery, { recursive: true });
        fs.utimesSync(recovery, new Date(old), new Date(old));

        const result = pruneDataRetention({ root, now });
        assert.ok(result.removedRecords >= 10);
        assert.equal(fs.existsSync(path.join(userRoot, 'aiMemory.json')), false);
        assert.equal(fs.existsSync(path.join(userRoot, 'profile.json')), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userRoot, 'notifications.json'))).map(row => row.id), ['new']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'global', 'privacy-requests.json'))).map(row => row.id), ['open']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'global', 'abuse-reports.json'))).map(row => row.id), ['open']);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'global', 'feedback-rate-limits.json'))).map(row => row.userId), ['new-user']);
        assert.match(fs.readFileSync(path.join(root, 'runtime', 'bot.log'), 'utf8'), /retained/);
        assert.doesNotMatch(fs.readFileSync(path.join(root, 'runtime', 'bot.log'), 'utf8'), /expired/);
        const operations = JSON.parse(fs.readFileSync(path.join(guildRoot, 'operations.json')));
        assert.deepEqual(operations.reports.map(row => row.id), ['old-open']);
        assert.deepEqual(Object.keys(operations.levels), ['new-user']);
        const community = JSON.parse(fs.readFileSync(path.join(guildRoot, 'community-management.json')));
        assert.deepEqual(community.tickets.map(row => row.id), ['active-ticket']);
        assert.deepEqual(community.suggestions.map(row => row.id), ['active-suggestion']);
        assert.deepEqual(community.submissions.map(row => row.id), ['active-submission']);
        const messages = JSON.parse(fs.readFileSync(path.join(guildRoot, 'analytics', 'rollups', 'message-stats.json')));
        assert.equal(messages.messages.total, 2);
        assert.deepEqual(Object.keys(messages.messages.byUser), ['new-user']);
        const voice = JSON.parse(fs.readFileSync(path.join(guildRoot, 'analytics', 'rollups', 'voice-state.json')));
        assert.deepEqual(Object.keys(voice.users), ['new-user']);
        assert.equal(voice.users['new-user'].totalMs, 7000);
        const anonymous = JSON.parse(fs.readFileSync(path.join(guildRoot, 'analytics', 'rollups', 'anonymous-history.json')));
        const archivedDate = old.slice(0, 10);
        assert.equal(anonymous.messages.byDay[archivedDate].count, 1);
        assert.equal(anonymous.voice.byDay[archivedDate].occupiedMs, 5000);
        assert.equal(JSON.stringify(anonymous).includes('old-user'), false);
        pruneDataRetention({ root, now });
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(guildRoot, 'analytics', 'rollups', 'anonymous-history.json'))), anonymous);
        assert.equal(fs.existsSync(recovery), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('retention policy values are bounded and configurable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-retention-policy-'));
    try {
        const result = pruneDataRetention({ root, retentionDays: { notifications: 7, profiles: 99999, aiMemory: 0 } });
        assert.equal(result.policies.notifications, 7);
        assert.equal(result.policies.profiles, 3650);
        assert.equal(result.policies.aiMemory, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
