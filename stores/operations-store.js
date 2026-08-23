const fs = require('fs');
const path = require('path');

function filePath(guildId) {
    return path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'operations.json');
}

function emptyState() {
    return { reports: [], incidents: [], reminders: [], levels: {}, afk: {}, giveaways: [], snapshots: [], temporaryRoles: [], voiceRoleLinks: [], feeds: [], pulseResponses: [] };
}

function readState(guildId) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath(guildId), 'utf8'));
        const fallback = emptyState();
        return Object.fromEntries(Object.entries(fallback).map(([key, value]) => [key,
            Array.isArray(value) ? (Array.isArray(parsed[key]) ? parsed[key] : value)
                : (parsed[key] && typeof parsed[key] === 'object' ? parsed[key] : value)
        ]));
    } catch {
        return emptyState();
    }
}

function writeState(guildId, state) {
    const target = filePath(guildId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(state, null, 4));
    return state;
}

function id(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function add(guildId, collection, prefix, record, maximum = 1000) {
    const state = readState(guildId);
    const entry = { id: id(prefix), createdAt: new Date().toISOString(), status: 'open', ...record };
    state[collection].unshift(entry);
    state[collection] = state[collection].slice(0, maximum);
    writeState(guildId, state);
    return entry;
}

function update(guildId, collection, recordId, changes) {
    const state = readState(guildId);
    const entry = state[collection].find(item => item.id === recordId);
    if (!entry) return null;
    Object.assign(entry, changes, { updatedAt: new Date().toISOString() });
    writeState(guildId, state);
    return entry;
}

function addExperience(guildId, userId, amount = 1) {
    const state = readState(guildId);
    const current = state.levels[userId] || { xp: 0, messages: 0, updatedAt: null };
    current.xp += Math.max(0, Math.floor(Number(amount) || 0));
    current.messages += 1;
    current.updatedAt = new Date().toISOString();
    state.levels[userId] = current;
    writeState(guildId, state);
    return { ...current, level: Math.floor(Math.sqrt(current.xp / 25)) };
}

function setAfk(guildId, userId, message) {
    const state = readState(guildId);
    if (message === null) delete state.afk[userId];
    else state.afk[userId] = { message, since: new Date().toISOString() };
    writeState(guildId, state);
    return state.afk[userId] || null;
}

function dueReminders(guildId, at = Date.now()) {
    return readState(guildId).reminders.filter(entry => entry.status === 'open' && new Date(entry.dueAt).getTime() <= at);
}

module.exports = {
    readState,
    writeState,
    addReport: (guildId, record) => add(guildId, 'reports', 'report', record),
    updateReport: (guildId, recordId, changes) => update(guildId, 'reports', recordId, changes),
    addIncident: (guildId, record) => add(guildId, 'incidents', 'incident', record),
    updateIncident: (guildId, recordId, changes) => update(guildId, 'incidents', recordId, changes),
    addReminder: (guildId, record) => add(guildId, 'reminders', 'reminder', record),
    updateReminder: (guildId, recordId, changes) => update(guildId, 'reminders', recordId, changes),
    addGiveaway: (guildId, record) => add(guildId, 'giveaways', 'giveaway', record),
    updateGiveaway: (guildId, recordId, changes) => update(guildId, 'giveaways', recordId, changes),
    addTemporaryRole: (guildId, record) => add(guildId, 'temporaryRoles', 'temp-role', record),
    updateTemporaryRole: (guildId, recordId, changes) => update(guildId, 'temporaryRoles', recordId, changes),
    addFeed: (guildId, record) => add(guildId, 'feeds', 'feed', record, 25),
    addPulseResponse: (guildId, record) => add(guildId, 'pulseResponses', 'pulse', record, 5000),
    updateFeed: (guildId, recordId, changes) => update(guildId, 'feeds', recordId, changes),
    setVoiceRoleLink: (guildId, channelId, roleId) => {
        const state = readState(guildId);
        const existing = state.voiceRoleLinks.find(entry => entry.channelId === channelId);
        if (existing) existing.roleId = roleId;
        else state.voiceRoleLinks.push({ id: id('voice-role'), channelId, roleId, createdAt: new Date().toISOString() });
        writeState(guildId, state);
        return state.voiceRoleLinks.find(entry => entry.channelId === channelId);
    },
    addSnapshot: (guildId, record, keepCount = 10) => {
        const state = readState(guildId);
        const entry = { id: id('snapshot'), createdAt: new Date().toISOString(), ...record };
        state.snapshots.unshift(entry);
        state.snapshots = state.snapshots.slice(0, Math.max(1, keepCount));
        writeState(guildId, state);
        return entry;
    },
    addExperience,
    setAfk,
    dueReminders
};
