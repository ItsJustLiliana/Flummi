#!/usr/bin/env node
// Run manually on the server: node scripts/migrate-analytics-storage.js
// It only deletes an old file after its new analytics replacement exists.
const fs = require('fs');
const path = require('path');
const analytics = require('../stores/analytics-store');
const root = path.join(__dirname, '..', 'data', 'guilds');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 4)); }
function removeIfEmpty(file, check) {
    if (!fs.existsSync(file)) return;
    if (!check(readJson(file))) throw new Error(`${file}: new data already exists; stop the bot and resolve this manually.`);
    fs.unlinkSync(file);
}

for (const guildId of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const guild = path.join(root, guildId);
    if (!fs.statSync(guild).isDirectory()) continue;
    const rollups = path.join(guild, 'analytics', 'rollups');
    const oldMessages = path.join(guild, 'serverStats.json');
    const newMessages = path.join(rollups, 'message-stats.json');
    const oldVoice = path.join(guild, 'voiceStats.json');
    const newVoice = path.join(rollups, 'voice-state.json');
    if (fs.existsSync(oldMessages)) {
        removeIfEmpty(newMessages, value => (Number(value.messages?.total) || 0) === 0);
        fs.mkdirSync(rollups, { recursive: true }); fs.renameSync(oldMessages, newMessages);
        console.log(`${guildId}: moved serverStats.json`);
    }
    if (fs.existsSync(oldVoice)) {
        removeIfEmpty(newVoice, value => Object.keys(value.activeSessions || {}).length === 0 && Object.keys(value.users || {}).length === 0);
        const voice = readJson(oldVoice);
        for (const entry of voice.history || []) analytics.recordVoiceEvent(guildId, { action: 'session-ended', ...entry });
        for (const [userId, entry] of Object.entries(voice.users || {})) { delete entry.history; voice.users[userId] = entry; }
        delete voice.history; writeJson(newVoice, voice);
        if (!fs.existsSync(newVoice)) throw new Error(`${guildId}: voice replacement was not written.`);
        fs.unlinkSync(oldVoice); console.log(`${guildId}: migrated voice history into rotated shards`);
    }
}
