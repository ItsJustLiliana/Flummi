const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { recordActivity } = require('./activity-store');
const { recordVoiceEvent, readEvents } = require('./analytics-store');

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

    return path.join(dataDir, 'guilds', String(guildId), 'analytics', 'rollups', 'voice-state.json');
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
    return { activeSessions, history: [], users };
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
    recordVoiceEvent(guildId, { action: 'joined', userId: normalizedUserId, channelId: normalizedChannelId, channelName: channelName || normalizedChannelId, reason });
    recordActivity('voice-join', `User ${normalizedUserId} joined ${channelName || normalizedChannelId}`, { guildId, userId: normalizedUserId, channelId: normalizedChannelId });
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
        recordVoiceEvent(guildId, { action: 'session-ended', userId: String(userId), ...historyEntry });
    }

    entry.lastLeftAt = endedAt.toISOString();
    entry.lastSeenAt = endedAt.toISOString();
    entry.currentState = null;
    stats.users[String(userId)] = entry;

    saveVoiceStats(stats, guildId);
    recordVoiceEvent(guildId, { action: 'left', userId: String(userId), channelId: session?.channelId || null, channelName: session?.channelName || null, durationMs: session ? Math.max(0, endedAt.getTime() - new Date(session.startedAt).getTime()) : 0, reason });
    recordActivity('voice-leave', `User ${userId} left voice`, { guildId, userId: String(userId), channelId: session?.channelId || null });
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
        history: getVoiceHistory(guildId, userId)
    };
}

function getVoiceHistory(guildId, userId, channelId = null) {
    const stats = readVoiceStats(guildId);
    const normalizedChannelId = channelId ? String(channelId) : null;
    const history = readEvents(guildId, 'voice').filter(entry => entry.action === 'session-ended' &&
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

    for (const session of readEvents(guildId, 'voice').filter(entry => entry.action === 'session-ended')) {
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

function getRecentVoiceHistory(guildId, limit = 25) {
    return readEvents(guildId, 'voice')
        .filter(entry => entry.action === 'session-ended')
        .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt))
        .slice(0, Math.max(1, Number(limit) || 25));
}

function getVoiceAnalytics(guildId, from = null, to = null, channelId = null) {
    const stats = readVoiceStats(guildId);
    const start = from ? new Date(from).getTime() : 0;
    const end = to ? new Date(to).getTime() : Date.now();
    const normalizedChannelId = channelId ? String(channelId) : null;
    const history = readEvents(guildId, 'voice').filter(row => row.action === 'session-ended' && (!normalizedChannelId || row.channelId === normalizedChannelId) && new Date(row.startedAt).getTime() <= end && new Date(row.endedAt || Date.now()).getTime() >= start);
    const channels = new Map(), users = new Map(), daily = new Map();
    for (const row of history) {
        const rowStart = Math.max(start, new Date(row.startedAt).getTime());
        const rowEnd = Math.min(end, new Date(row.endedAt || Date.now()).getTime());
        const ms = Math.max(0, rowEnd - rowStart);
        const channel = channels.get(row.channelId) || { channelId: row.channelId, channelName: row.channelName, totalMs: 0, sessions: 0 };
        channel.totalMs += ms; channel.sessions++; channels.set(row.channelId, channel);
        const user = users.get(row.userId) || { userId: row.userId, weeklyMs: 0, monthlyMs: 0, totalMs: 0 };
        user.totalMs += ms;
        if (Date.now() - rowEnd <= 7 * 86400000) user.weeklyMs += ms;
        if (Date.now() - rowEnd <= 31 * 86400000) user.monthlyMs += ms;
        users.set(row.userId, user);
        const day = new Date(rowStart).toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) || 0) + 1);
    }
    // A group session runs from the first join until the last leave while at least one tracked user remains in a channel.
    const events = history.flatMap(row => [{ at: new Date(row.startedAt).getTime(), kind: 'join', channelId: row.channelId, channelName: row.channelName, userId: row.userId }, { at: new Date(row.endedAt).getTime(), kind: 'leave', channelId: row.channelId, channelName: row.channelName, userId: row.userId }]).sort((a, b) => a.at - b.at || (a.kind === 'leave' ? -1 : 1));
    const active = new Map(), sessions = [];
    for (const event of events) {
        let state = active.get(event.channelId) || { users: new Set(), startedAt: null, participants: new Set(), channelName: event.channelName };
        if (event.kind === 'join') { if (!state.users.size) state.startedAt = event.at; state.users.add(event.userId); state.participants.add(event.userId); }
        else { state.users.delete(event.userId); if (!state.users.size && state.startedAt) { sessions.push({ channelId: event.channelId, channelName: state.channelName, startedAt: new Date(state.startedAt).toISOString(), endedAt: new Date(event.at).toISOString(), durationMs: event.at - state.startedAt, userIds: [...state.participants] }); state = { users: new Set(), startedAt: null, participants: new Set(), channelName: event.channelName }; } }
        active.set(event.channelId, state);
    }
    const activeByChannel = new Map();
    for (const [userId, session] of Object.entries(stats.activeSessions)) {
        const group = activeByChannel.get(session.channelId) || { channelId: session.channelId, channelName: session.channelName, startedAt: session.startedAt, endedAt: null, durationMs: 0, userIds: [], active: true };
        if (new Date(session.startedAt) < new Date(group.startedAt)) group.startedAt = session.startedAt;
        group.userIds.push(userId);
        group.durationMs = Date.now() - new Date(group.startedAt).getTime();
        activeByChannel.set(session.channelId, group);
    }
    sessions.push(...activeByChannel.values());
    return { topChannels: [...channels.values()].sort((a,b) => b.totalMs-a.totalMs), userTotals: [...users.values()].sort((a,b) => b.totalMs-a.totalMs), activeOverTime: [...daily.entries()].map(([date, count]) => ({ date, count })).sort((a,b) => a.date.localeCompare(b.date)), groupSessions: sessions.sort((a,b) => new Date(b.startedAt)-new Date(a.startedAt)).slice(0, 100) };
}

module.exports = {
    emptyVoiceStats,
    endVoiceSession,
    getChannelVoiceMembers,
    getUserVoiceStats,
    getRecentVoiceHistory,
    getVoiceHistory,
    getVoiceStatsSummary,
    getVoiceAnalytics,
    readVoiceStats,
    saveVoiceStats,
    startVoiceSession,
    updateVoiceSession
};
