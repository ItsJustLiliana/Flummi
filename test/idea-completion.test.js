const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { cronMatches, nextExecutions, scheduleMatches } = require('../services/schedule-service');
const { conditionMatches } = require('../services/workflow-service');
const customCommands = require('../stores/custom-command-store');
const notifications = require('../stores/notification-store');
const { renderHtml, renderText } = require('../services/ticket-transcript-service');
const { incrementMessageStats } = require('../stores/server-stats-store');

test('event schedules support one-time, weekday, cron, timezone, and previews', () => {
    const friday = new Date('2026-08-28T18:00:00.000Z');
    assert.equal(scheduleMatches({ enabled: true, scheduleType: 'weekly', weekdays: [5], time: '20:00', timezone: 'Europe/Amsterdam' }, friday), true);
    assert.equal(cronMatches('0 20 * * 5', { minute: 0, hour: 20, day: 28, month: 8, weekday: 5 }), true);
    assert.equal(scheduleMatches({ enabled: true, scheduleType: 'once', runAt: '2026-08-28T18:00:00.000Z' }, friday), true);
    assert.equal(nextExecutions({ enabled: true, scheduleType: 'cron', cron: '0 20 * * 5', timezone: 'Europe/Amsterdam' }, new Date('2026-08-26T00:00:00Z'), 2).length, 2);
});

test('generic workflow conditions support nested comparisons', () => {
    assert.equal(conditionMatches({ field: 'account.ageDays', operator: 'less-than', value: 7 }, { account: { ageDays: 3 } }), true);
    assert.equal(conditionMatches({ field: 'ticket.tags', operator: 'includes', value: 'billing' }, { ticket: { tags: ['billing'] } }), true);
});

test('custom commands, notifications, and message stats persist safely and deduplicate', () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const guildId = `idea-guild-${suffix}`;
    const userId = `idea-user-${suffix}`;
    const guildFolder = path.join(__dirname, '..', 'data', 'guilds', guildId);
    const userFolder = path.join(__dirname, '..', 'data', 'global', 'users', userId);
    try {
        const command = customCommands.upsertCommand(guildId, { name: 'regels', description: 'Server rules', content: 'Be kind', buttons: [{ label: 'Site', url: 'https://example.com' }] });
        assert.equal(command.name, 'regels');
        assert.equal(customCommands.getCommand(guildId, 'regels').buttons.length, 1);
        notifications.addNotification(userId, { type: 'ticket', title: 'Closed', message: 'Done' });
        assert.equal(notifications.readNotifications(userId).length, 1);
        incrementMessageStats({ guildId, channelId: 'one', userId, messageId: 'same' });
        const stats = incrementMessageStats({ guildId, channelId: 'one', userId, messageId: 'same' });
        assert.equal(stats.messages.total, 1);
    } finally {
        fs.rmSync(guildFolder, { recursive: true, force: true });
        fs.rmSync(userFolder, { recursive: true, force: true });
    }
});

test('ticket transcripts include metadata, attachments, embeds, and reactions', () => {
    const transcript = { ticket: { id: 'ticket-1', topic: 'Help', openerId: '1', claimerId: '2', priority: 'high', tags: ['billing'], openedAt: '2026-01-01', closedAt: '2026-01-02', closeReason: 'Solved' }, messages: [{ createdAt: '2026-01-01', author: { id: '1', tag: 'Member', avatarUrl: null }, content: '<hello>', attachments: [{ name: 'proof.png', url: 'https://example.com/proof.png' }], embeds: [{ title: 'Evidence' }], reactions: [{ emoji: '✅', count: 2 }] }] };
    assert.match(renderHtml(transcript), /&lt;hello&gt;/);
    assert.match(renderHtml(transcript), /proof\.png/);
    assert.match(renderText(transcript), /embeds:/);
    assert.match(renderText(transcript), /reactions:/);
});
