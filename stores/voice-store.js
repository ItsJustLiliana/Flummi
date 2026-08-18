const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

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

function getVoiceStatsPath(guildId) {
    if (!guildId) {
        return null;
    }

    return path.join(dataDir, 'guilds', String(guildId), 'voiceStats.json');
}

function emptyVoiceStats() {
    return {
        activeSessions: {},
        history: [],
        users: {}
    };
}

function normalizeVoiceStats(raw) {
    const stats = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const activeSessions = stats.activeSessions && typeof stats.activeSessions === 'object' && !Array.isArray(stats.activeSessions)
        ? stats.activeSessions
        : {};
    const users = stats.users && typeof stats.users === 'object' && !Array.isArray(stats.users)
        ? stats.users
        : {};
    const history = Array.isArray(stats.history) ? stats.history : [];

    return { activeSessions, history, users };
}

function readVoiceStats(guildId) {
    const filePath = getVoiceStatsPath(guildId);

    if (!filePath) {
        return emptyVoiceStats();
    }

    return normalizeVoiceStats(readJson(filePath, emptyVoiceStats()));
}

function saveVoiceStats(stats, guildId) {
    const filePath = getVoiceStatsPath(guildId);
    const normalized = normalizeVoiceStats(stats);

    if (!filePath) {
        return normalized;
    }

    writeJson(filePath, normalized);
    return normalized;
}

function normalizeUserEntry(raw) {
    const entry = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const byChannel = entry.byChannel && typeof entry.byChannel === 'object' && !Array.isArray(entry.byChannel)
        ? entry.byChannel
        : {};

    return {
        totalMs: Number(entry.totalMs) || 0,
        byChannel,
        lastChannelId: entry.lastChannelId || null,
        lastChannelName: entry.lastChannelName || null,
        lastJoinedAt: entry.lastJoinedAt || null,
        lastLeftAt: entry.lastLeftAt || null,
        lastSeenAt: entry.lastSeenAt || null,
        currentState: entry.currentState && typeof entry.currentState === 'object'
            ? normalizeVoiceState(entry.currentState)
            : null,
        history: Array.isArray(entry.history) ? entry.history : []
    };
}

function getUserEntry(stats, userId) {
    return normalizeUserEntry(stats.users[String(userId)]);
}

function normalizeVoiceState(state = {}) {
    return {
        channelType: state.channelType || null,
        serverDeaf: Boolean(state.serverDeaf),
        serverMute: Boolean(state.serverMute),
        selfDeaf: Boolean(state.selfDeaf),
        selfMute: Boolean(state.selfMute),
        streaming: Boolean(state.streaming),
        video: Boolean(state.video)
    };
}

function addDuration(entry, channelId, channelName, durationMs) {
    if (durationMs <= 0) {
        return;
    }

    entry.totalMs += durationMs;

    const key = String(channelId);
    const existing = entry.byChannel[key] && typeof entry.byChannel[key] === 'object'
        ? entry.byChannel[key]
        : { ms: 0, name: channelName || key };

    entry.byChannel[key] = {
        name: channelName || existing.name || key,
        ms: (Number(existing.ms) || 0) + durationMs
    };
}

// Begins tracking a voice session for a user; overwrites any dangling session (e.g. after a bot restart).
function startVoiceSession({ guildId, userId, channelId, channelName, at, reason = 'join', state = {} }) {
    if (!guildId || !userId || !channelId) {
        return;
    }

    const stats = readVoiceStats(guildId);
    const startedAt = at instanceof Date ? at.toISOString() : new Date().toISOString();
    const normalizedUserId = String(userId);
    const normalizedChannelId = String(channelId);

    for (const activeSession of Object.values(stats.activeSessions)) {
        const activeWithUserIds = Array.isArray(activeSession.withUserIds) ? activeSession.withUserIds : [];

        if (activeSession.channelId === normalizedChannelId && !activeWithUserIds.includes(normalizedUserId)) {
            activeSession.withUserIds = activeWithUserIds;
            activeSession.withUserIds.push(normalizedUserId);
        }
    }

    const withUserIds = Object.entries(stats.activeSessions)
        .filter(([, session]) => session.channelId === normalizedChannelId)
        .map(([activeUserId]) => activeUserId)
        .filter(activeUserId => activeUserId !== normalizedUserId);
    stats.activeSessions[normalizedUserId] = {
        channelId: normalizedChannelId,
        channelName: channelName || normalizedChannelId,
        startedAt,
        sessionId: randomUUID(),
        startReason: reason,
        lastSeenAt: startedAt,
        startState: normalizeVoiceState(state),
        state: normalizeVoiceState(state),
        withUserIds
    };

    const entry = getUserEntry(stats, userId);
    entry.lastJoinedAt = startedAt;
    entry.lastChannelId = normalizedChannelId;
    entry.lastChannelName = channelName || normalizedChannelId;
    entry.lastSeenAt = startedAt;
    entry.currentState = normalizeVoiceState(state);
    stats.users[String(userId)] = entry;

    saveVoiceStats(stats, guildId);
}

// Ends the active voice session for a user and adds the elapsed time to their totals.
function endVoiceSession({ guildId, userId, at, reason = 'leave', state = null }) {
    if (!guildId || !userId) {
        return;
    }

    const stats = readVoiceStats(guildId);
    const session = stats.activeSessions[String(userId)];
    delete stats.activeSessions[String(userId)];

    const endedAt = at instanceof Date ? at : new Date();
    const entry = getUserEntry(stats, userId);

    if (session) {
        const startedAt = new Date(session.startedAt);
        const durationMs = endedAt.getTime() - startedAt.getTime();
        addDuration(entry, session.channelId, session.channelName, durationMs);
        entry.lastChannelId = session.channelId;
        entry.lastChannelName = session.channelName;
        const historyEntry = {
            channelId: session.channelId,
            channelName: session.channelName,
            sessionId: session.sessionId || randomUUID(),
            startedAt: session.startedAt,
            endedAt: endedAt.toISOString(),
            durationMs: Math.max(0, durationMs),
            endReason: reason,
            startReason: session.startReason || 'join',
            startState: session.startState || session.state || normalizeVoiceState(),
            endState: state ? normalizeVoiceState(state) : session.state || normalizeVoiceState(),
            withUserIds: Array.from(new Set(session.withUserIds || []))
        };
        entry.history.push(historyEntry);
        stats.history.push({ userId: String(userId), ...historyEntry });
    }

    entry.lastLeftAt = endedAt.toISOString();
    entry.lastSeenAt = endedAt.toISOString();
    entry.currentState = null;
    stats.users[String(userId)] = entry;

    saveVoiceStats(stats, guildId);
}

function updateVoiceSession({ guildId, userId, at, state = {} }) {
    if (!guildId || !userId) {
        return;
    }

    const stats = readVoiceStats(guildId);
    const session = stats.activeSessions[String(userId)];

    if (!session) {
        return;
    }

    const seenAt = at instanceof Date ? at.toISOString() : new Date().toISOString();
    const normalizedState = normalizeVoiceState(state);
    session.lastSeenAt = seenAt;
    session.state = normalizedState;

    const entry = getUserEntry(stats, userId);
    entry.lastSeenAt = seenAt;
    entry.currentState = normalizedState;
    stats.users[String(userId)] = entry;
    saveVoiceStats(stats, guildId);
}

function getUserVoiceStats(guildId, userId) {
    const stats = readVoiceStats(guildId);
    const entry = getUserEntry(stats, userId);
    const activeSession = stats.activeSessions[String(userId)] || null;

    return {
        totalMs: entry.totalMs,
        byChannel: Object.entries(entry.byChannel).map(([id, value]) => ({
            id,
            name: value.name || id,
            ms: Number(value.ms) || 0
        })).sort((left, right) => right.ms - left.ms),
        lastChannelId: entry.lastChannelId,
        lastChannelName: entry.lastChannelName,
        lastJoinedAt: entry.lastJoinedAt,
        lastLeftAt: entry.lastLeftAt,
        lastSeenAt: entry.lastSeenAt || null,
        currentState: activeSession ? activeSession.state || normalizeVoiceState() : null,
        currentChannelId: activeSession ? activeSession.channelId : null,
        currentChannelName: activeSession ? activeSession.channelName : null,
        currentSince: activeSession ? activeSession.startedAt : null,
        history: entry.history
    };
}

function getVoiceHistory(guildId, userId, channelId = null) {
    const stats = readVoiceStats(guildId);
    const normalizedChannelId = channelId ? String(channelId) : null;
    const history = stats.history.filter(entry =>
        entry.userId === String(userId) &&
        (!normalizedChannelId || entry.channelId === normalizedChannelId)
    );
    const activeSession = stats.activeSessions[String(userId)];

    if (activeSession && (!normalizedChannelId || activeSession.channelId === normalizedChannelId)) {
        history.push({
            userId: String(userId),
            channelId: activeSession.channelId,
            channelName: activeSession.channelName,
            sessionId: activeSession.sessionId || null,
            startedAt: activeSession.startedAt,
            endedAt: null,
            durationMs: Math.max(0, Date.now() - new Date(activeSession.startedAt).getTime()),
            endReason: null,
            startReason: activeSession.startReason || 'join',
            startState: activeSession.state || normalizeVoiceState(),
            endState: null,
            withUserIds: Array.from(new Set(activeSession.withUserIds || []))
        });
    }

    return history.sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
}

function getChannelVoiceMembers(guildId, channelId) {
    const stats = readVoiceStats(guildId);
    const normalizedChannelId = String(channelId);
    const members = new Map();

    for (const session of stats.history) {
        if (session.channelId !== normalizedChannelId || !session.userId) {
            continue;
        }

        const existing = members.get(session.userId);

        if (!existing || new Date(session.startedAt) > new Date(existing.lastJoinedAt)) {
            members.set(session.userId, {
                userId: session.userId,
                lastJoinedAt: session.startedAt,
                lastLeftAt: session.endedAt || null,
                lastSessionDurationMs: Number(session.durationMs) || 0,
                inVoice: false
            });
        }
    }

    for (const [userId, session] of Object.entries(stats.activeSessions)) {
        if (session.channelId !== normalizedChannelId) {
            continue;
        }

        members.set(userId, {
            userId,
            lastJoinedAt: session.startedAt,
            lastLeftAt: null,
            lastSessionDurationMs: null,
            inVoice: true
        });
    }

    return Array.from(members.values())
        .sort((left, right) => new Date(right.lastJoinedAt) - new Date(left.lastJoinedAt));
}

function getVoiceStatsSummary(guildId, limit = 10) {
    const stats = readVoiceStats(guildId);
    const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
    const now = Date.now();

    const rows = Object.entries(stats.users).map(([userId, raw]) => {
        const entry = normalizeUserEntry(raw);
        const activeSession = stats.activeSessions[userId];
        const liveMs = activeSession ? now - new Date(activeSession.startedAt).getTime() : 0;

        return {
            id: userId,
            totalMs: entry.totalMs + liveMs,
            lastLeftAt: entry.lastLeftAt,
            inVoice: Boolean(activeSession)
        };
    });

    return rows
        .sort((left, right) => right.totalMs - left.totalMs)
        .slice(0, safeLimit);
}

module.exports = {
    emptyVoiceStats,
    endVoiceSession,
    getChannelVoiceMembers,
    getUserVoiceStats,
    getVoiceHistory,
    getVoiceStatsSummary,
    readVoiceStats,
    saveVoiceStats,
    startVoiceSession,
    updateVoiceSession
};
