const fs = require('fs');
const path = require('path');

function storePath(guildId) {
    return path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'community-management.json');
}

function emptyState() {
    return { tickets: [], suggestions: [], submissions: [], starboard: {}, temporaryVoiceChannels: [], security: {} };
}

function readState(guildId) {
    try {
        const parsed = JSON.parse(fs.readFileSync(storePath(guildId), 'utf8'));
        return {
            tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
            suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
            submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
            starboard: parsed.starboard && typeof parsed.starboard === 'object' ? parsed.starboard : {},
            temporaryVoiceChannels: Array.isArray(parsed.temporaryVoiceChannels) ? parsed.temporaryVoiceChannels : [],
            security: parsed.security && typeof parsed.security === 'object' ? parsed.security : {}
        };
    } catch {
        return emptyState();
    }
}

function writeState(guildId, state) {
    const target = storePath(guildId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(state, null, 4));
    return state;
}

function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function addRecord(guildId, collection, record) {
    const state = readState(guildId);
    const next = { id: makeId(collection.slice(0, -1)), createdAt: new Date().toISOString(), status: 'open', ...record };
    state[collection].unshift(next);
    state[collection] = state[collection].slice(0, 1000);
    writeState(guildId, state);
    return next;
}

function updateRecord(guildId, collection, id, changes) {
    const state = readState(guildId);
    const record = state[collection].find(entry => entry.id === id);
    if (!record) return null;
    Object.assign(record, changes, { updatedAt: new Date().toISOString() });
    writeState(guildId, state);
    return record;
}

function setStarboardMessage(guildId, sourceMessageId, starboardMessageId) {
    const state = readState(guildId);
    state.starboard[sourceMessageId] = starboardMessageId;
    writeState(guildId, state);
}

function addTemporaryVoiceChannel(guildId, channelId) {
    const state = readState(guildId);
    state.temporaryVoiceChannels = [...new Set([...state.temporaryVoiceChannels, channelId])];
    writeState(guildId, state);
}

function removeTemporaryVoiceChannel(guildId, channelId) {
    const state = readState(guildId);
    state.temporaryVoiceChannels = state.temporaryVoiceChannels.filter(id => id !== channelId);
    writeState(guildId, state);
}

function setSecurityState(guildId, changes) {
    const state = readState(guildId);
    state.security = { ...state.security, ...changes };
    writeState(guildId, state);
}

module.exports = {
    readState,
    addTicket: (guildId, record) => addRecord(guildId, 'tickets', record),
    addSuggestion: (guildId, record) => addRecord(guildId, 'suggestions', record),
    addSubmission: (guildId, record) => addRecord(guildId, 'submissions', record),
    updateTicket: (guildId, id, changes) => updateRecord(guildId, 'tickets', id, changes),
    updateSuggestion: (guildId, id, changes) => updateRecord(guildId, 'suggestions', id, changes),
    updateSubmission: (guildId, id, changes) => updateRecord(guildId, 'submissions', id, changes),
    setStarboardMessage,
    addTemporaryVoiceChannel,
    removeTemporaryVoiceChannel,
    setSecurityState
};
