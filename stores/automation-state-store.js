const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'guilds');

function statePath(guildId) {
    return path.join(dataDir, String(guildId), 'management', 'automation-state.json');
}

function readState(guildId) {
    try { return JSON.parse(fs.readFileSync(statePath(guildId), 'utf8')) || {}; } catch { return {}; }
}

function markRun(guildId, key, at = new Date()) {
    const state = readState(guildId);
    state[String(key)] = at.toISOString();
    const target = statePath(guildId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(state, null, 2));
}

function isDue(guildId, key, intervalMinutes, now = new Date()) {
    const last = new Date(readState(guildId)[String(key)] || 0).getTime();
    return now.getTime() - last >= Number(intervalMinutes) * 60000;
}

module.exports = { readState, markRun, isDue };
