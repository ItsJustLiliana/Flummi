const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const {
    canSavePingRequests,
    canUseAiChat,
    canUseBotMentions,
    canUseCommandPath,
    canUseTriggers,
    getRequiredCommandRole,
    getUserPermissions,
    roleMeetsRequirement,
    setUserCommandPermission,
    setUserPermission
} = require('../stores/access-store');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('command permissions resolve top-level and subcommand roles from config', () => {
    assert.equal(getRequiredCommandRole('trigger', null, null), 'user');
    assert.equal(getRequiredCommandRole('trigger', 'remove', null), 'manager');
    assert.equal(getRequiredCommandRole('trigger', 'audit', null), 'developer');
    assert.equal(getRequiredCommandRole('manage', 'role', null), 'developer');
});

test('role requirements follow user manager developer order', () => {
    assert.equal(roleMeetsRequirement('user', 'user'), true);
    assert.equal(roleMeetsRequirement('user', 'manager'), false);
    assert.equal(roleMeetsRequirement('manager', 'user'), true);
    assert.equal(roleMeetsRequirement('manager', 'developer'), false);
    assert.equal(roleMeetsRequirement('developer', 'manager'), true);
});

test('user command overrides can block, allow, and inherit command paths', () => {
    const guildId = `test-access-${process.pid}`;
    const userId = '999001';
    cleanupGuild(guildId);

    try {
        setUserCommandPermission(userId, 'trigger.add', false, guildId);

        assert.deepEqual(getUserPermissions(userId, guildId).commandOverrides, {
            'trigger.add': false
        });
        assert.equal(canUseCommandPath({
            userId,
            guildId,
            commandName: 'trigger',
            subcommandName: 'add',
            commandDefinition: null
        }).allowed, false);

        setUserCommandPermission(userId, 'serverstats', true, guildId);
        assert.equal(canUseCommandPath({
            userId,
            guildId,
            commandName: 'serverstats',
            subcommandName: null,
            commandDefinition: null
        }).allowed, true);

        setUserCommandPermission(userId, 'trigger.add', null, guildId);
        assert.deepEqual(getUserPermissions(userId, guildId).commandOverrides, {
            serverstats: true
        });
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
