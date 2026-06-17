const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function getStatsPath(guildId) {
    if (!guildId) {
        return null;
    }

    return path.join(dataDir, 'guilds', String(guildId), 'serverStats.json');
}

function emptyStats() {
    return {
        messages: {
            total: 0,
            byChannel: {},
            byUser: {}
        }
    };
}

function normalizeStats(raw) {
    const stats = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const messages = stats.messages && typeof stats.messages === 'object' && !Array.isArray(stats.messages)
        ? stats.messages
        : {};

    return {
        messages: {
            total: Number(messages.total) || 0,
            byChannel: messages.byChannel && typeof messages.byChannel === 'object' && !Array.isArray(messages.byChannel)
                ? messages.byChannel
                : {},
            byUser: messages.byUser && typeof messages.byUser === 'object' && !Array.isArray(messages.byUser)
                ? messages.byUser
                : {}
        }
    };
}

function readServerStats(guildId) {
    const filePath = getStatsPath(guildId);

    if (!filePath) {
        return emptyStats();
    }

    return normalizeStats(readJson(filePath, emptyStats()));
}

function saveServerStats(stats, guildId) {
    const filePath = getStatsPath(guildId);

    if (!filePath) {
        return normalizeStats(stats);
    }

    const normalized = normalizeStats(stats);
    writeJson(filePath, normalized);
    return normalized;
}

function incrementCounter(bucket, id, label) {
    if (!id) {
        return;
    }

    const key = String(id);
    const current = bucket[key] && typeof bucket[key] === 'object' && !Array.isArray(bucket[key])
        ? bucket[key]
        : {};

    bucket[key] = {
        id: key,
        name: label || current.name || key,
        count: (Number(current.count) || 0) + 1
    };
}

function incrementMessageStats({ guildId, channelId, channelName, userId, userTag }) {
    const stats = readServerStats(guildId);

    stats.messages.total += 1;
    incrementCounter(stats.messages.byChannel, channelId, channelName);
    incrementCounter(stats.messages.byUser, userId, userTag);

    return saveServerStats(stats, guildId);
}

function topEntries(bucket, limit) {
    return Object.values(bucket || {})
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
            id: String(entry.id || ''),
            name: String(entry.name || entry.id || 'unknown'),
            count: Number(entry.count) || 0
        }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
        .slice(0, limit);
}

function getServerStatsSummary(guildId, limit = 10) {
    const stats = readServerStats(guildId);
    const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));

    return {
        totalMessages: stats.messages.total,
        channels: topEntries(stats.messages.byChannel, safeLimit),
        users: topEntries(stats.messages.byUser, safeLimit)
    };
}

function getUserMessageStats(guildId, userId) {
    const stats = readServerStats(guildId);
    const entry = stats.messages.byUser[String(userId)] || {};

    return {
        count: Number(entry.count) || 0,
        totalMessages: stats.messages.total,
        percentage: stats.messages.total > 0
            ? ((Number(entry.count) || 0) / stats.messages.total) * 100
            : 0
    };
}

module.exports = {
    emptyStats,
    getServerStatsSummary,
    getUserMessageStats,
    incrementMessageStats,
    readServerStats,
    saveServerStats
};
