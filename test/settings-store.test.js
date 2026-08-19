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
