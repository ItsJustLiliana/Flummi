const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function emptyAnonymousAnalytics() {
    return { version: 1, messages: { byDay: {} }, voice: { byDay: {} } };
}

function normalizeAnonymousAnalytics(value) {
    const state = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        version: 1,
        messages: { byDay: state.messages?.byDay && typeof state.messages.byDay === 'object' ? state.messages.byDay : {} },
        voice: { byDay: state.voice?.byDay && typeof state.voice.byDay === 'object' ? state.voice.byDay : {} }
    };
}

function historyPathForGuildRoot(guildRoot) {
    return path.join(guildRoot, 'analytics', 'rollups', 'anonymous-history.json');
}

function readAnonymousAnalyticsAt(filePath) {
    try { return normalizeAnonymousAnalytics(JSON.parse(fs.readFileSync(filePath, 'utf8'))); }
    catch { return emptyAnonymousAnalytics(); }
}

function writeAnonymousAnalyticsAt(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(normalizeAnonymousAnalytics(value), null, 2)}\n`);
    fs.renameSync(temporary, filePath);
}

function readAnonymousAnalytics(guildId) {
    return readAnonymousAnalyticsAt(historyPathForGuildRoot(path.join(dataDir, 'guilds', String(guildId))));
}

module.exports = {
    emptyAnonymousAnalytics,
    historyPathForGuildRoot,
    readAnonymousAnalytics,
    readAnonymousAnalyticsAt,
    writeAnonymousAnalyticsAt
};
