const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const moderationStore = require('../stores/moderation-store');
const communityStore = require('../stores/community-management-store');
const {
    activePunishments,
    buildMemberDossier,
    buildThreatAssessment,
    buildTicketStatistics,
    queryAuditLog
} = require('../services/community-intelligence-service');

function cleanup(guildId) {
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
}

test('ticket SLA statistics calculate responses, resolutions, staff totals, and the oldest unanswered ticket', () => {
    const now = Date.parse('2026-08-26T12:00:00.000Z');
    const tickets = [
        { id: 'one', status: 'closed', createdAt: '2026-08-26T08:00:00.000Z', firstResponseAt: '2026-08-26T09:00:00.000Z', closedAt: '2026-08-26T11:00:00.000Z', claimedBy: 'staff-1' },
        { id: 'two', status: 'open', createdAt: '2026-08-26T10:00:00.000Z' },
        { id: 'three', status: 'open', createdAt: '2026-08-26T11:00:00.000Z', claimedAt: '2026-08-26T11:30:00.000Z', claimedBy: 'staff-1' }
    ];
    const result = buildTicketStatistics(tickets, { now });
    assert.equal(result.open, 2);
    assert.equal(result.closed, 1);
    assert.equal(result.averageFirstResponseMs, 45 * 60000);
    assert.equal(result.averageResolutionMs, 3 * 3600000);
    assert.equal(result.oldestUnanswered.id, 'two');
    assert.deepEqual(result.byStaff, [{ staffId: 'staff-1', count: 2 }]);
});

test('member dossiers avoid message content and audit filters combine server and panel records', () => {
    const guildId = `test-intelligence-${process.pid}`;
    cleanup(guildId);
    try {
        moderationStore.addCase(guildId, { action: 'warn', targetId: '123', moderatorId: '456', reason: 'Repeated spam', channelId: '789' });
        moderationStore.addEvent(guildId, { type: 'message-delete', userId: '123', actorId: '456', channelId: '789', summary: 'secret deleted content' });
        communityStore.addTicket(guildId, { ownerId: '123', topic: 'Help', channelId: '789' });
        const dossier = buildMemberDossier(guildId, '123');
        assert.equal(dossier.cases.length, 1);
        assert.ok(dossier.timeline.some(row => row.type === 'ticket'));
        assert.equal(dossier.timeline.find(row => row.type === 'message-delete').label, 'Message metadata changed');
        assert.ok(!JSON.stringify(dossier).includes('secret deleted content'));

        const audit = queryAuditLog(guildId, { memberId: '123', moderatorId: '456', channelId: '789' }, []);
        assert.ok(audit.some(row => row.action === 'warn'));
        assert.ok(audit.some(row => row.action === 'message-delete'));
        assert.ok(audit.every(row => row.memberId === '123' && row.moderatorId === '456'));
    } finally { cleanup(guildId); }
});

test('threat assessment and active punishment list expose actionable dashboard state', () => {
    const guildId = `test-threat-${process.pid}`;
    cleanup(guildId);
    try {
        for (let index = 0; index < 3; index++) {
            moderationStore.addEvent(guildId, { type: 'member-join', userId: `user-${index}`, summary: `raider${index} joined`, metadata: { accountCreatedAt: new Date(Date.now() - 3600000).toISOString() } });
        }
        const threat = buildThreatAssessment(guildId, { settings: { joinBurstLimit: 2, joinBurstWindowSeconds: 30, minimumAccountAgeDays: 3 } });
        assert.equal(threat.level, 'Raid');
        assert.ok(threat.score >= 65);

        moderationStore.addCase(guildId, { action: 'tempban', targetId: '123', moderatorId: '456', reason: 'Raid', expiresAt: new Date(Date.now() + 3600000).toISOString() });
        moderationStore.addCase(guildId, { action: 'timeout', targetId: '789', moderatorId: '456', reason: 'Expired', expiresAt: new Date(Date.now() - 1000).toISOString() });
        const punishments = activePunishments(guildId);
        assert.equal(punishments.length, 1);
        assert.equal(punishments[0].action, 'tempban');
        assert.ok(punishments[0].remainingMs > 0);
    } finally { cleanup(guildId); }
});

test('selected idea features live in their designated existing panel tabs', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
    for (const id of ['managementMemberDossier', 'managementAuditTable', 'managementActivePunishments', 'managementThreatLevel', 'ticketSlaCards', 'managementSuggestionsRoadmap', 'communityHealthScore', 'communityOnboardingTable']) {
        assert.match(panel, new RegExp(`id="${id}"`));
        assert.match(app, new RegExp(id));
    }
});
