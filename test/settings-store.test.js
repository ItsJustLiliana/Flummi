const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { readSettings, writeSettings } = require('../stores/settings-store');

function cleanupGuild(guildId) {
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
}

test('settings clamp cooldown seconds and trigger length to panel limits', () => {
    const guildId = `test-settings-limits-${process.pid}`;
    cleanupGuild(guildId);

    try {
        let saved = writeSettings({ triggerActionCooldownSeconds: 7200, maxTriggerLength: 500 }, guildId);
        assert.equal(saved.triggerActionCooldownSeconds, 3600);
        assert.equal(saved.maxTriggerLength, 200);

        saved = writeSettings({ triggerActionCooldownSeconds: -10, maxTriggerLength: 0 }, guildId);
        assert.equal(saved.triggerActionCooldownSeconds, 0);
        assert.equal(saved.maxTriggerLength, 1);
        assert.equal(readSettings(guildId).maxTriggerLength, 1);
    } finally {
        cleanupGuild(guildId);
    }
});

test('management modules and editor settings are normalized per guild', () => {
    const guildId = `test-management-settings-${process.pid}`;
    cleanupGuild(guildId);

    try {
        const saved = writeSettings({
            management: {
                modules: { moderation: true, automod: true, unknown: true },
                moderation: { requireReason: false, notifyMember: true, defaultTimeoutMinutes: 999999 },
                automod: { preset: 'strict', mode: 'enforce', escalationEnabled: false, logChannelId: '123456789012345678', action: 'timeout', timeoutMinutes: 60, blockedTerms: ['spam', 'spam'], allowedDomains: ['https://www.example.com/path'], ignoredChannelIds: ['223456789012345678'], rules: { externalLinks: { enabled: true, action: 'warn', limit: 4, ignoredRoleIds: ['523456789012345678'] } } },
                cases: { retentionDays: 0 },
                roles: { autoroleId: 'not-a-role', autoroleDelayMinutes: -5, selfAssignableRoleIds: ['323456789012345678'] },
                automation: { welcomeEnabled: true, schedules: [{ id: 'daily', channelId: '423456789012345678', message: 'Hello', intervalMinutes: 1440 }] }
            }
        }, guildId);

        assert.equal(saved.management.modules.moderation, true);
        assert.equal(saved.management.modules.automod, true);
        assert.equal(saved.management.modules.cases, false);
        assert.equal(saved.management.modules.unknown, undefined);
        assert.equal(saved.management.moderation.defaultTimeoutMinutes, 40320);
        assert.equal(saved.management.automod.logChannelId, '123456789012345678');
        assert.equal(saved.management.automod.action, 'timeout');
        assert.deepEqual(saved.management.automod.blockedTerms, ['spam']);
        assert.deepEqual(saved.management.automod.allowedDomains, ['example.com']);
        assert.equal(saved.management.automod.rules.externalLinks.enabled, true);
        assert.equal(saved.management.automod.rules.externalLinks.action, 'warn');
        assert.equal(saved.management.automod.rules.externalLinks.limit, 4);
        assert.equal(saved.management.automod.rules.messageSpam.limit, 5);
        assert.equal(saved.management.cases.retentionDays, 1);
        assert.equal(saved.management.roles.autoroleId, '');
        assert.equal(saved.management.roles.autoroleDelayMinutes, 0);
        assert.deepEqual(saved.management.roles.selfAssignableRoleIds, ['323456789012345678']);
        assert.equal(readSettings(guildId).management.automation.welcomeEnabled, true);
        assert.equal(saved.management.automation.schedules[0].id, 'daily');
    } finally {
        cleanupGuild(guildId);
    }
});
