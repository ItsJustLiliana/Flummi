const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const operations = require('../stores/operations-store');
const { newestFeedItem, isPrivateAddress } = require('../services/operations-service');
const { writeSettings } = require('../stores/settings-store');
const operationsService = fs.readFileSync(path.join(__dirname, '..', 'services', 'operations-service.js'), 'utf8');

function cleanup(guildId) {
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
}

test('operations store keeps distinct reports, incidents, reminders, snapshots, and utility state', () => {
    const guildId = `test-operations-${process.pid}`;
    cleanup(guildId);
    try {
        const report = operations.addReport(guildId, { reporterId: 'member-1', reason: 'Evidence' });
        const incident = operations.addIncident(guildId, { actorId: 'admin-1', summary: 'Rapid changes' });
        operations.addReminder(guildId, { userId: 'member-1', dueAt: new Date(0).toISOString() });
        operations.addSnapshot(guildId, { reason: 'test', roles: [], channels: [] }, 2);
        operations.addTemporaryRole(guildId, { userId: 'member-1', roleId: 'role-1', removeAt: new Date(0).toISOString() });
        operations.setVoiceRoleLink(guildId, 'voice-1', 'role-2');
        operations.addFeed(guildId, { name: 'Creator', url: 'https://example.com/feed.xml', channelId: 'channel-1' });
        operations.updateReport(guildId, report.id, { status: 'claimed' });
        operations.updateIncident(guildId, incident.id, { status: 'investigating' });
        const state = operations.readState(guildId);
        assert.equal(state.reports[0].status, 'claimed');
        assert.equal(state.incidents[0].status, 'investigating');
        assert.equal(state.voiceRoleLinks[0].roleId, 'role-2');
        assert.equal(state.feeds[0].name, 'Creator');
        assert.equal(operations.dueReminders(guildId, Date.now()).length, 1);
    } finally { cleanup(guildId); }
});

test('advanced modules normalize safely and default off', () => {
    const guildId = `test-advanced-settings-${process.pid}`;
    cleanup(guildId);
    try {
        const saved = writeSettings({ management: {
            modules: { serverDoctor: true, incidentCenter: true, engagement: true },
            incidentCenter: { actionThreshold: 999, windowSeconds: 1, autoLockdown: true },
            backups: { intervalHours: 0, keepCount: 999 },
            engagement: { feeds: true, levels: false }
        } }, guildId);
        assert.equal(saved.management.modules.serverDoctor, true);
        assert.equal(saved.management.modules.reports, false);
        assert.equal(saved.management.incidentCenter.actionThreshold, 50);
        assert.equal(saved.management.incidentCenter.windowSeconds, 5);
        assert.equal(saved.management.backups.intervalHours, 1);
        assert.equal(saved.management.backups.keepCount, 100);
        assert.equal(saved.management.engagement.feeds, true);
        assert.equal(saved.management.engagement.levels, false);
    } finally { cleanup(guildId); }
});

test('creator feed parser accepts RSS and Atom links', () => {
    assert.deepEqual(newestFeedItem('<rss><channel><item><title><![CDATA[New video]]></title><link>https://example.com/video</link></item></channel></rss>'), { title: 'New video', url: 'https://example.com/video' });
    assert.deepEqual(newestFeedItem('<feed><entry><title>New post</title><link href="https://example.com/post" /></entry></feed>'), { title: 'New post', url: 'https://example.com/post' });
});

test('creator feeds reject private and reserved network addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1']) assert.equal(isPrivateAddress(address), true);
    assert.equal(isPrivateAddress('1.1.1.1'), false);
    assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('new workflows stay grouped and are represented in dashboard and developer statistics', () => {
    const community = require('../commands/community').data.toJSON();
    const server = require('../commands/server').data.toJSON();
    assert.deepEqual(community.options.map(option => option.name), ['report', 'remind', 'afk', 'rank', 'pulse']);
    assert.deepEqual(server.options.map(option => option.name), ['doctor', 'snapshot', 'snapshot-preview', 'snapshot-restore', 'incidents', 'approve-ban', 'copilot', 'poll', 'giveaway', 'embed', 'temporary-role', 'voice-role', 'feed']);
    const panel = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
    for (const tab of ['server-doctor', 'incident-center', 'reports', 'workflows', 'staff-operations', 'community-health', 'backups', 'copilot', 'engagement']) assert.match(panel, new RegExp(`id="tab-management-${tab}"`));
    assert.match(panel, /id="tab-adoption"/);
    const panelScript = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
    assert.match(panelScript, /api\/developer\/stats/);
    assert.match(panelScript, /activeServers/);
});

test('scheduled deliveries only advance after Discord confirms the action', () => {
    assert.match(operationsService, /const delivered = channel\?\.isTextBased\(\)[\s\S]*?status: attempts >= 5 \? 'failed' : 'pending'/);
    assert.match(operationsService, /const removed = await member\.roles\.remove[\s\S]*?status: 'open'.*lastError/);
    assert.match(operationsService, /if \(!channel\?\.isTextBased\(\)\) throw new Error\('The configured feed channel is unavailable\.'\)/);
});
