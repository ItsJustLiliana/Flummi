const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const {
    canSavePingRequests,
    canAddTriggers,
    canUseAiChat,
    canUseBotMentions,
    canUseCommandPath,
    canUseTriggers,
    getRequiredCommandRole,
    getUserRole,
    getUserPermissions,
    isAdmin,
    roleMeetsRequirement,
    setCommandPermissions,
    setGuildOwner,
    setUserPermission
} = require('../stores/access-store');
const { readConfig } = require('../utils/config');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('command permissions resolve top-level and subcommand roles from config', () => {
    assert.equal(getRequiredCommandRole('trigger', null, null), 'member');
    assert.equal(getRequiredCommandRole('trigger', 'add', null), 'admin');
    assert.equal(getRequiredCommandRole('trigger', 'remove', null), 'admin');
    assert.equal(getRequiredCommandRole('trigger', 'audit', null), 'developer');
    assert.equal(getRequiredCommandRole('profile', 'color', null, 'set'), 'member');
    assert.equal(getRequiredCommandRole('profile', 'social', null, 'set'), 'member');
    assert.equal(getRequiredCommandRole('dashboard', null, { public: true }), 'member');
    assert.equal(getRequiredCommandRole('ticket', 'open', { adminSubcommands: ['claim'] }), 'member');
    assert.equal(getRequiredCommandRole('ticket', 'claim', { adminSubcommands: ['claim'] }), 'admin');
});

test('command permission requirements can be refreshed without restarting the process', () => {
    const original = readConfig().commandPermissions || {};
    try {
        setCommandPermissions({ ...original, serverstats: 'member' });
        assert.equal(getRequiredCommandRole('serverstats', null, null), 'member');
    } finally {
        setCommandPermissions(original);
    }
});

test('role requirements follow member admin developer order', () => {
    assert.equal(roleMeetsRequirement('member', 'member'), true);
    assert.equal(roleMeetsRequirement('member', 'admin'), false);
    assert.equal(roleMeetsRequirement('admin', 'member'), true);
    assert.equal(roleMeetsRequirement('admin', 'developer'), false);
    assert.equal(roleMeetsRequirement('developer', 'admin'), true);
    assert.equal(roleMeetsRequirement('owner', 'admin'), true);
    assert.equal(roleMeetsRequirement('owner', 'developer'), false);
});

test('Discord Administrator permission grants admin while other server users are members', () => {
    const guildId = `test-owner-access-${process.pid}`;
    const ownerId = '999010';
    cleanupGuild(guildId);

    try {
        setGuildOwner(guildId, ownerId);

        assert.equal(getUserRole(ownerId, guildId), 'admin');
        assert.equal(isAdmin(ownerId, guildId), true);
        assert.equal(getUserRole('999011', guildId), 'member');
        assert.equal(canAddTriggers('999011', guildId), false);
        assert.equal(getUserRole('999011', guildId, 8n), 'admin');
        assert.equal(isAdmin('999011', guildId, 8n), true);
        assert.equal(canAddTriggers('999011', guildId, 8n), true);
        assert.equal(canUseCommandPath({
            userId: '999011',
            guildId,
            commandName: 'serverstats',
            commandDefinition: { adminOnly: true },
            memberPermissions: 8n
        }).allowed, true);
    } finally {
        cleanupGuild(guildId);
    }
});

test('user feature permissions can block bot behavior features', () => {
    const guildId = `test-feature-access-${process.pid}`;
    const userId = '999002';
    cleanupGuild(guildId);

    try {
        assert.equal(canUseTriggers(userId, guildId), true);
        assert.equal(canUseAiChat(userId, guildId), true);
        assert.equal(canUseBotMentions(userId, guildId), true);
        assert.equal(canSavePingRequests(userId, guildId), true);

        setUserPermission(userId, 'useTriggers', false, guildId);
        setUserPermission(userId, 'useAiChat', false, guildId);
        setUserPermission(userId, 'useBotMentions', false, guildId);
        setUserPermission(userId, 'savePingRequests', false, guildId);

        const perms = getUserPermissions(userId, guildId);

        assert.equal(perms.useTriggers, false);
        assert.equal(perms.useAiChat, false);
        assert.equal(perms.useBotMentions, false);
        assert.equal(perms.savePingRequests, false);
        assert.equal(canUseTriggers(userId, guildId), false);
        assert.equal(canUseAiChat(userId, guildId), false);
        assert.equal(canUseBotMentions(userId, guildId), false);
        assert.equal(canSavePingRequests(userId, guildId), false);
    } finally {
        cleanupGuild(guildId);
    }
});
