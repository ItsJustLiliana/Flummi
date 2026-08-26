const fs = require('fs');
const path = require('path');

const DAY_MS = 86400000;
const defaultRoot = path.join(__dirname, '..', 'data');
const DEFAULT_RETENTION_DAYS = Object.freeze({
    analytics: 365,
    aiMemory: 90,
    profiles: 365,
    notifications: 90,
    privacyRequests: 365,
    abuseReports: 365,
    feedback: 365,
    operations: 365,
    completedReminders: 30,
    pulseResponses: 90,
    pingRequests: 30,
    fileManagerRecovery: 30,
    guildBackups: 90,
    activityLog: 90
});

function normalizedPolicies(overrides = {}) {
    return Object.fromEntries(Object.entries(DEFAULT_RETENTION_DAYS).map(([key, fallback]) => {
        const value = Number(overrides[key]);
        return [key, Number.isFinite(value) ? Math.min(3650, Math.max(1, Math.floor(value))) : fallback];
    }));
}

function readJson(filePath, fallback) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.retention.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, filePath);
}

function recordTime(record, fields = ['updatedAt', 'closedAt', 'resolvedAt', 'readAt', 'createdAt', 'at', 'submittedAt', 'savedAt']) {
    for (const field of fields) {
        const raw = record?.[field];
        const value = typeof raw === 'number' ? raw : Date.parse(raw || '');
        if (Number.isFinite(value)) return value;
    }
    return null;
}

function isExpired(record, days, now, fields) {
    const timestamp = recordTime(record, fields);
    return timestamp !== null && timestamp < now - days * DAY_MS;
}

function pruneArrayFile(filePath, keep) {
    if (!fs.existsSync(filePath)) return 0;
    const rows = readJson(filePath, null);
    if (!Array.isArray(rows)) return 0;
    const retained = rows.filter(keep);
    if (retained.length !== rows.length) writeJson(filePath, retained);
    return rows.length - retained.length;
}

function pruneRecoveryFolder(folder, days, now) {
    if (!fs.existsSync(folder)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const target = path.join(folder, entry.name);
        const modifiedAt = fs.statSync(target).mtimeMs;
        if (modifiedAt >= now - days * DAY_MS) continue;
        fs.rmSync(target, { recursive: entry.isDirectory(), force: true });
        removed++;
    }
    return removed;
}

function listFiles(folder) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(folder, entry.name);
        return entry.isDirectory() ? listFiles(target) : [target];
    });
}

function readNdjson(folder) {
    return listFiles(folder).filter(file => file.endsWith('.ndjson')).flatMap(file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
    }));
}

function pruneNdjson(folder, days, now) {
    let removed = 0;
    for (const file of listFiles(folder).filter(target => target.endsWith('.ndjson'))) {
        const kept = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).filter(line => {
            try {
                const row = JSON.parse(line);
                if (!isExpired(row, days, now, ['at', 'createdAt'])) return true;
                removed++;
                return false;
            } catch { return false; }
        });
        if (kept.length) fs.writeFileSync(file, `${kept.join('\n')}\n`);
        else fs.rmSync(file, { force: true });
    }
    return removed;
}

function pruneJsonLinesFile(filePath, days, now) {
    if (!fs.existsSync(filePath)) return 0;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    let removed = 0;
    const kept = lines.filter(line => {
        try {
            const row = JSON.parse(line);
            if (!isExpired(row, days, now, ['at', 'createdAt'])) return true;
            removed++;
            return false;
        } catch {
            removed++;
            return false;
        }
    });
    if (kept.length !== lines.length) {
        if (kept.length) fs.writeFileSync(filePath, `${kept.join('\n')}\n`);
        else fs.rmSync(filePath, { force: true });
    }
    return removed;
}

function increment(bucket, id, name) {
    if (!id) return;
    const key = String(id);
    const current = bucket[key] || { id: key, name: name || key, count: 0 };
    bucket[key] = { id: key, name: name || current.name || key, count: current.count + 1 };
}

function rebuildMessageRollup(guildRoot) {
    const events = readNdjson(path.join(guildRoot, 'analytics', 'messages')).filter(row => row.type === 'message');
    const stats = { recentMessageIds: [], messages: { total: events.length, byChannel: {}, byUser: {} } };
    for (const row of events) {
        increment(stats.messages.byChannel, row.channelId, row.channelName);
        increment(stats.messages.byUser, row.userId, row.userTag);
        if (row.messageId) stats.recentMessageIds.push(String(row.messageId));
    }
    stats.recentMessageIds = stats.recentMessageIds.slice(-5000);
    writeJson(path.join(guildRoot, 'analytics', 'rollups', 'message-stats.json'), stats);
}

function rebuildVoiceRollup(guildRoot) {
    const target = path.join(guildRoot, 'analytics', 'rollups', 'voice-state.json');
    const existing = readJson(target, {});
    const activeSessions = existing.activeSessions && typeof existing.activeSessions === 'object' ? existing.activeSessions : {};
    const users = {};
    const sessions = readNdjson(path.join(guildRoot, 'analytics', 'voice')).filter(row => row.action === 'session-ended' && row.userId);
    for (const row of sessions) {
        const userId = String(row.userId);
        const channelId = String(row.channelId || 'unknown');
        const durationMs = Math.max(0, Number(row.durationMs) || 0);
        const current = users[userId] || { totalMs: 0, byChannel: {}, lastChannelId: null, lastChannelName: null, lastJoinedAt: null, lastLeftAt: null, lastSeenAt: null, currentState: null, history: [] };
        const channel = current.byChannel[channelId] || { ms: 0, name: row.channelName || channelId };
        channel.ms += durationMs;
        current.byChannel[channelId] = channel;
        current.totalMs += durationMs;
        current.lastChannelId = channelId;
        current.lastChannelName = row.channelName || channelId;
        current.lastJoinedAt = row.startedAt || current.lastJoinedAt;
        current.lastLeftAt = row.endedAt || row.at || current.lastLeftAt;
        current.lastSeenAt = row.endedAt || row.at || current.lastSeenAt;
        users[userId] = current;
    }
    for (const [userId, session] of Object.entries(activeSessions)) {
        users[userId] ||= { totalMs: 0, byChannel: {}, lastChannelId: null, lastChannelName: null, lastJoinedAt: null, lastLeftAt: null, lastSeenAt: null, currentState: null, history: [] };
        users[userId].lastChannelId = session.channelId || users[userId].lastChannelId;
        users[userId].lastChannelName = session.channelName || users[userId].lastChannelName;
        users[userId].lastJoinedAt = session.startedAt || users[userId].lastJoinedAt;
        users[userId].lastSeenAt = session.lastSeenAt || session.startedAt || users[userId].lastSeenAt;
        users[userId].currentState = session.state || session.startState || null;
    }
    writeJson(target, { activeSessions, history: [], users });
}

function pruneOperations(filePath, policies, now) {
    if (!fs.existsSync(filePath)) return 0;
    const state = readJson(filePath, null);
    if (!state || typeof state !== 'object') return 0;
    let removed = 0;
    const retainTerminal = (rows, terminal, days = policies.operations) => {
        if (!Array.isArray(rows)) return [];
        const retained = rows.filter(row => !terminal.has(String(row.status || '').toLowerCase()) || !isExpired(row, days, now));
        removed += rows.length - retained.length;
        return retained;
    };
    state.reports = retainTerminal(state.reports, new Set(['resolved', 'dismissed']));
    state.modmail = retainTerminal(state.modmail, new Set(['closed', 'blocked']));
    state.incidents = retainTerminal(state.incidents, new Set(['resolved']));
    state.reminders = retainTerminal(state.reminders, new Set(['sent', 'completed', 'failed', 'dismissed']), policies.completedReminders);
    state.giveaways = retainTerminal(state.giveaways, new Set(['closed', 'completed', 'cancelled']), policies.operations);
    state.temporaryRoles = retainTerminal(state.temporaryRoles, new Set(['removed', 'completed', 'failed']), policies.completedReminders);
    if (Array.isArray(state.pulseResponses)) {
        const retained = state.pulseResponses.filter(row => !isExpired(row, policies.pulseResponses, now));
        removed += state.pulseResponses.length - retained.length;
        state.pulseResponses = retained;
    }
    for (const key of Object.keys(state.levels || {})) {
        if (isExpired(state.levels[key], policies.analytics, now)) { delete state.levels[key]; removed++; }
    }
    for (const key of Object.keys(state.afk || {})) {
        if (isExpired(state.afk[key], policies.completedReminders, now, ['since'])) { delete state.afk[key]; removed++; }
    }
    if (removed) writeJson(filePath, state);
    return removed;
}

function pruneCommunity(filePath, days, now) {
    if (!fs.existsSync(filePath)) return 0;
    const state = readJson(filePath, null);
    if (!state || typeof state !== 'object') return 0;
    let removed = 0;
    const terminalStatuses = {
        tickets: new Set(['closed']),
        suggestions: new Set(['implemented', 'rejected', 'closed']),
        submissions: new Set(['approved', 'rejected', 'resolved', 'closed'])
    };
    for (const collection of Object.keys(terminalStatuses)) {
        if (!Array.isArray(state[collection])) continue;
        const retained = state[collection].filter(row => {
            const terminal = terminalStatuses[collection].has(String(row.status || '').toLowerCase());
            return !terminal || !isExpired(row, days, now);
        });
        removed += state[collection].length - retained.length;
        state[collection] = retained;
    }
    if (removed) writeJson(filePath, state);
    return removed;
}

function pruneUserFiles(usersRoot, policies, now) {
    if (!fs.existsSync(usersRoot)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const userRoot = path.join(usersRoot, entry.name);
        removed += pruneArrayFile(path.join(userRoot, 'notifications.json'), row => !isExpired(row, policies.notifications, now));
        for (const [name, days] of [['aiMemory.json', policies.aiMemory], ['profile.json', policies.profiles]]) {
            const target = path.join(userRoot, name);
            if (!fs.existsSync(target)) continue;
            const record = readJson(target, null);
            if (record && isExpired(record, days, now)) { fs.rmSync(target, { force: true }); removed++; }
        }
        if (!fs.readdirSync(userRoot).length) fs.rmdirSync(userRoot);
    }
    return removed;
}

function pruneDataRetention({ root = defaultRoot, now = Date.now(), retentionDays = {} } = {}) {
    const policies = normalizedPolicies(retentionDays);
    const result = { removedRecords: 0, removedRecoveryEntries: 0, processedGuilds: 0, policies };
    const globalRoot = path.join(root, 'global');
    result.removedRecords += pruneUserFiles(path.join(globalRoot, 'users'), policies, now);
    result.removedRecords += pruneArrayFile(path.join(globalRoot, 'notifications.json'), row => !isExpired(row, policies.notifications, now));
    result.removedRecords += pruneArrayFile(path.join(globalRoot, 'feedback.json'), row => !isExpired(row, policies.feedback, now));
    result.removedRecords += pruneArrayFile(path.join(globalRoot, 'feedback-rate-limits.json'), row => !isExpired(row, 1, now, ['submittedAt']));
    result.removedRecords += pruneArrayFile(path.join(globalRoot, 'privacy-requests.json'), row => !['corrected', 'rejected'].includes(String(row.status)) || !isExpired(row, policies.privacyRequests, now));
    result.removedRecords += pruneArrayFile(path.join(globalRoot, 'abuse-reports.json'), row => !['resolved', 'dismissed'].includes(String(row.status)) || !isExpired(row, policies.abuseReports, now));
    result.removedRecords += pruneArrayFile(path.join(root, 'runtime', 'activity.json'), row => !isExpired(row, policies.activityLog, now));
    result.removedRecords += pruneJsonLinesFile(path.join(root, 'runtime', 'bot.log'), policies.activityLog, now);
    result.removedRecoveryEntries += pruneRecoveryFolder(path.join(root, 'runtime', 'file-manager', 'backups'), policies.fileManagerRecovery, now);
    result.removedRecoveryEntries += pruneRecoveryFolder(path.join(root, 'runtime', 'file-manager', 'trash'), policies.fileManagerRecovery, now);

    const backupsRoot = path.join(globalRoot, 'backups');
    if (fs.existsSync(backupsRoot)) {
        for (const guild of fs.readdirSync(backupsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
            result.removedRecoveryEntries += pruneRecoveryFolder(path.join(backupsRoot, guild.name), policies.guildBackups, now);
        }
    }

    const guildsRoot = path.join(root, 'guilds');
    if (fs.existsSync(guildsRoot)) for (const guild of fs.readdirSync(guildsRoot, { withFileTypes: true })) {
        if (!guild.isDirectory()) continue;
        const guildRoot = path.join(guildsRoot, guild.name);
        result.processedGuilds++;
        for (const category of ['messages', 'voice', 'moderation', 'soundboard']) {
            result.removedRecords += pruneNdjson(path.join(guildRoot, 'analytics', category), policies.analytics, now);
        }
        result.removedRecords += pruneOperations(path.join(guildRoot, 'operations.json'), policies, now);
        result.removedRecords += pruneCommunity(path.join(guildRoot, 'community-management.json'), policies.operations, now);
        result.removedRecords += pruneArrayFile(path.join(guildRoot, 'pingRequests.json'), row => !isExpired(row, policies.pingRequests, now));
        result.removedRecords += pruneArrayFile(path.join(guildRoot, 'shotAudit.json'), row => !isExpired(row, policies.analytics, now));
        const shotsPath = path.join(guildRoot, 'shots.json');
        if (fs.existsSync(shotsPath)) {
            const shots = readJson(shotsPath, {});
            for (const userId of Object.keys(shots)) if (isExpired(shots[userId], policies.profiles, now, ['lastUpdatedAt'])) { delete shots[userId]; result.removedRecords++; }
            writeJson(shotsPath, shots);
        }
        const rolesPath = path.join(guildRoot, 'management', 'persistent-roles.json');
        if (fs.existsSync(rolesPath)) {
            const roles = readJson(rolesPath, {});
            for (const userId of Object.keys(roles)) if (isExpired(roles[userId], policies.profiles, now, ['savedAt'])) { delete roles[userId]; result.removedRecords++; }
            writeJson(rolesPath, roles);
        }
        rebuildMessageRollup(guildRoot);
        rebuildVoiceRollup(guildRoot);
    }
    return result;
}

module.exports = { DAY_MS, DEFAULT_RETENTION_DAYS, normalizedPolicies, pruneDataRetention };
