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
    getManagerUserIds,
    getUserRole,
    getUserPermissions,
    isManager,
    roleMeetsRequirement,
    setGuildOwner,
    setManagerRole,
    setUserCommandPermission,
    setUserPermission
} = require('../stores/access-store');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('command permissions resolve top-level and subcommand roles from config', () => {
    assert.equal(getRequiredCommandRole('trigger', null, null), 'user');
    assert.equal(getRequiredCommandRole('trigger', 'add', null), 'manager');
    assert.equal(getRequiredCommandRole('trigger', 'remove', null), 'manager');
    assert.equal(getRequiredCommandRole('trigger', 'audit', null), 'developer');
    assert.equal(getRequiredCommandRole('manage', 'role', null), 'developer');
    assert.equal(getRequiredCommandRole('profile', 'color', null, 'set'), 'user');
    assert.equal(getRequiredCommandRole('profile', 'social', null, 'set'), 'user');
    assert.equal(getRequiredCommandRole('dashboard', null, { public: true }), 'user');
});

test('role requirements follow user manager developer order', () => {
    assert.equal(roleMeetsRequirement('user', 'user'), true);
    assert.equal(roleMeetsRequirement('user', 'manager'), false);
    assert.equal(roleMeetsRequirement('manager', 'user'), true);
    assert.equal(roleMeetsRequirement('manager', 'developer'), false);
    assert.equal(roleMeetsRequirement('developer', 'manager'), true);
    assert.equal(roleMeetsRequirement('owner', 'manager'), true);
    assert.equal(roleMeetsRequirement('owner', 'developer'), false);
});

test('server owner is an immutable manager and other members default to user', () => {
    const guildId = `test-owner-access-${process.pid}`;
    const ownerId = '999010';
    cleanupGuild(guildId);

    try {
        setGuildOwner(guildId, ownerId);

        assert.equal(getUserRole(ownerId, guildId), 'owner');
        assert.equal(isManager(ownerId, guildId), true);
        assert.equal(getUserRole('999011', guildId), 'user');
        assert.equal(canAddTriggers('999011', guildId), false);

        setManagerRole(ownerId, false, guildId);
        assert.equal(getUserRole(ownerId, guildId), 'owner');
        assert.equal(getManagerUserIds(guildId).includes(ownerId), false);

        setManagerRole('999011', true, guildId);
        assert.equal(getUserRole('999011', guildId), 'manager');
        assert.equal(canAddTriggers('999011', guildId), true);
    } finally {
        cleanupGuild(guildId);
    }
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
