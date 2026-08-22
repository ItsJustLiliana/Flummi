const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { evaluateContent, resetRuntimeState } = require('../services/automod-service');
const { parseDuration, durationLabel } = require('../services/moderation-service');
const moderationStore = require('../stores/moderation-store');
const moderateCommand = require('../commands/moderate');

function cleanup(guildId) {
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
}

test('moderation duration parsing supports compound values and rejects malformed input', () => {
    assert.equal(parseDuration('2h 30m'), 9000000);
    assert.equal(parseDuration('7d'), 604800000);
    assert.equal(parseDuration('later'), null);
    assert.equal(durationLabel(9000000), '2h 30m');
});

test('moderation cases are append-only, updateable, searchable, and retained', () => {
    const guildId = `test-management-cases-${process.pid}`;
    cleanup(guildId);
    try {
        const entry = moderationStore.addCase(guildId, { action: 'warn', targetId: '123', moderatorId: '456', reason: 'Test reason' });
        moderationStore.updateCase(guildId, entry.id, { status: 'completed', reason: 'Updated reason' }, { id: '456' });
        moderationStore.addEvent(guildId, { type: 'member-join', userId: '123', summary: 'Joined' });
        const saved = moderationStore.getCase(guildId, entry.id);
        assert.equal(saved.status, 'completed');
        assert.equal(saved.reason, 'Updated reason');
        assert.equal(saved.history.length, 1);
        assert.equal(moderationStore.getMemberCases(guildId, '123').length, 1);
        assert.equal(moderationStore.readEvents(guildId)[0].type, 'member-join');
        assert.deepEqual(moderationStore.pruneModerationData(guildId, 365), { cases: 1, events: 1 });
    } finally { cleanup(guildId); }
});

test('AutoMod detects blocked terms, mention spam, caps, duplicates, and rate spam', () => {
    resetRuntimeState();
    assert.equal(evaluateContent({ content: 'this has forbidden words', blockedTerms: ['forbidden'] }).rule, 'badWords');
    assert.equal(evaluateContent({ content: 'classification', blockedTerms: ['ass'] }), null);
    assert.equal(evaluateContent({ content: 'hello', mentions: 7, preset: 'balanced' }).rule, 'mentionSpam');
    assert.equal(evaluateContent({ content: 'THIS IS VERY LOUD', preset: 'balanced' }).rule, 'capsSpam');
    assert.equal(evaluateContent({ content: 'same thing', preset: 'balanced', history: [{ content: 'same thing' }, { content: 'same thing' }] }).rule, 'duplicateSpam');
    assert.equal(evaluateContent({ content: 'normal', preset: 'strict', history: Array.from({ length: 4 }, () => ({ content: 'different' })) }).rule, 'messageSpam');
    assert.equal(evaluateContent({ content: '😀😀😀😀😀😀😀😀', preset: 'strict' }).rule, 'emojiSpam');
});

test('AutoMod individual filters support actions, custom limits, and allowlists', () => {
    const rules = {
        badWords: { enabled: false, limit: 1 }, serverInvites: { enabled: true, limit: 1 }, externalLinks: { enabled: true, limit: 1 },
        messageSpam: { enabled: false }, duplicateSpam: { enabled: false }, mentionSpam: { enabled: false }, capsSpam: { enabled: false }, emojiSpam: { enabled: false }, zalgoSpam: { enabled: false }
    };
    assert.equal(evaluateContent({ content: 'forbidden', blockedTerms: ['forbidden'], rules }), null);
    assert.equal(evaluateContent({ content: 'https://discord.gg/other', rules, allowedInviteCodes: ['mine'] }).rule, 'serverInvites');
    assert.equal(evaluateContent({ content: 'https://discord.gg/mine', rules, allowedInviteCodes: ['mine'] }), null);
    assert.equal(evaluateContent({ content: 'www.bad.example/path', rules, allowedDomains: ['safe.example'] }).rule, 'externalLinks');
    assert.equal(evaluateContent({ content: 'https://sub.safe.example/path', rules, allowedDomains: ['safe.example'] }), null);
});

test('moderate slash command exposes the complete manager action set', () => {
    const json = moderateCommand.data.toJSON();
    const names = json.options.map(option => option.name);
    for (const name of ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'softban', 'purge', 'lock', 'unlock', 'slowmode', 'note', 'history', 'case']) {
        assert.ok(names.includes(name), `missing ${name}`);
    }
    assert.equal(moderateCommand.managerOnly, true);
});
