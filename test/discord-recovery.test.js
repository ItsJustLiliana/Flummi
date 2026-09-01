const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const botSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(root, 'control-panel.js'), 'utf8');
const pingStoreSource = fs.readFileSync(path.join(root, 'stores', 'ping-metrics-store.js'), 'utf8');

test('main bot heartbeat records Discord readiness and restarts a stuck recovered gateway', () => {
    assert.match(pingStoreSource, /ready: ready === true/);
    assert.match(botSource, /DISCORD_RECOVERY_RESTART_MS = 2 \* 60 \* 1000/);
    assert.match(botSource, /evaluateDiscordRecovery\(discordReady, response\.ok\)/);
    assert.match(botSource, /process\.exit\(1\)/);
});

test('public status uses the fresh main bot heartbeat instead of the panel gateway', () => {
    assert.match(panelSource, /mainBotHeartbeatAgeMs/);
    assert.match(panelSource, /mainBotHealth\?\.ready === true/);
    assert.match(panelSource, /mainBotHealth\?\.gatewayLatency/);
});
