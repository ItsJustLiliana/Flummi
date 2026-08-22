const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'guilds');
const maxEvents = 5000;

function moderationDir(guildId) {
    return path.join(dataDir, String(guildId), 'moderation');
}

function appendRecord(filePath, record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

function readRecords(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8')
            .split(/\r?\n/)
            .filter(Boolean)
            .map(line => {
                try { return JSON.parse(line); } catch { return null; }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function makeId(prefix = 'case') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function caseFile(guildId) {
    return path.join(moderationDir(guildId), 'cases.jsonl');
}

function eventFile(guildId) {
    return path.join(moderationDir(guildId), 'events.jsonl');
}

function addCase(guildId, input) {
    const now = new Date().toISOString();
    const moderationCase = {
        id: makeId('case'),
        guildId: String(guildId),
        action: String(input.action || 'note'),
        targetId: input.targetId ? String(input.targetId) : null,
        targetLabel: input.targetLabel || null,
        moderatorId: input.moderatorId ? String(input.moderatorId) : null,
        moderatorLabel: input.moderatorLabel || null,
        reason: String(input.reason || 'No reason provided').slice(0, 1000),
        evidence: input.evidence ? String(input.evidence).slice(0, 1000) : null,
        channelId: input.channelId ? String(input.channelId) : null,
        durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.floor(input.durationMs)) : null,
        expiresAt: input.expiresAt || null,
        source: input.source || 'manual',
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
        status: input.status || 'active',
        createdAt: now,
        updatedAt: now
    };
    appendRecord(caseFile(guildId), { type: 'create', at: now, case: moderationCase });
    return moderationCase;
}

function updateCase(guildId, caseId, changes, actor = {}) {
    const allowed = ['reason', 'evidence', 'expiresAt', 'status', 'metadata'];
    const safeChanges = Object.fromEntries(Object.entries(changes || {}).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(safeChanges).length) return getCase(guildId, caseId);
    const at = new Date().toISOString();
    appendRecord(caseFile(guildId), {
        type: 'update',
        at,
        caseId: String(caseId),
        changes: safeChanges,
        actorId: actor.id ? String(actor.id) : null,
        actorLabel: actor.label || null
    });
    return getCase(guildId, caseId);
}

function readCases(guildId) {
    const cases = new Map();
    for (const record of readRecords(caseFile(guildId))) {
        if (record.type === 'create' && record.case?.id) {
            cases.set(record.case.id, { ...record.case, history: [] });
        } else if (record.type === 'update' && cases.has(record.caseId)) {
            const current = cases.get(record.caseId);
            Object.assign(current, record.changes, { updatedAt: record.at });
            current.history.push({ at: record.at, changes: record.changes, actorId: record.actorId, actorLabel: record.actorLabel });
        }
    }
    return [...cases.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function getCase(guildId, caseId) {
    return readCases(guildId).find(entry => entry.id === String(caseId)) || null;
}

function getMemberCases(guildId, userId, { limit = 50, action = null, since = null } = {}) {
    const sinceMs = since ? new Date(since).getTime() : null;
    return readCases(guildId)
        .filter(entry => entry.targetId === String(userId))
        .filter(entry => !action || entry.action === action)
        .filter(entry => !sinceMs || new Date(entry.createdAt).getTime() >= sinceMs)
        .slice(0, Math.max(1, Math.min(500, Number(limit) || 50)));
}

function getDueCases(guildId, now = new Date()) {
    const nowMs = now.getTime();
    return readCases(guildId).filter(entry => entry.status === 'active' && entry.expiresAt && new Date(entry.expiresAt).getTime() <= nowMs);
}

function addEvent(guildId, input) {
    const event = {
        id: makeId('event'),
        guildId: String(guildId),
        type: String(input.type || 'unknown'),
        userId: input.userId ? String(input.userId) : null,
        actorId: input.actorId ? String(input.actorId) : null,
        channelId: input.channelId ? String(input.channelId) : null,
        summary: String(input.summary || '').slice(0, 1000),
        metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
        createdAt: new Date().toISOString()
    };
    appendRecord(eventFile(guildId), event);
    return event;
}

function readEvents(guildId, { limit = 200, type = null } = {}) {
    const rows = readRecords(eventFile(guildId));
    return rows
        .filter(entry => !type || entry.type === type)
        .slice(-maxEvents)
        .reverse()
        .slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
}

function pruneModerationData(guildId, retentionDays, now = new Date()) {
    const cutoff = now.getTime() - Math.max(1, Number(retentionDays) || 365) * 86400000;
    const cases = readCases(guildId).filter(entry => entry.status === 'active' || new Date(entry.createdAt).getTime() >= cutoff);
    const events = readRecords(eventFile(guildId)).filter(entry => new Date(entry.createdAt).getTime() >= cutoff).slice(-maxEvents);
    fs.mkdirSync(moderationDir(guildId), { recursive: true });
    fs.writeFileSync(caseFile(guildId), cases.map(entry => {
        const { history: _history, ...clean } = entry;
        return JSON.stringify({ type: 'create', at: clean.createdAt, case: clean });
    }).join('\n') + (cases.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(eventFile(guildId), events.map(entry => JSON.stringify(entry)).join('\n') + (events.length ? '\n' : ''), 'utf8');
    return { cases: cases.length, events: events.length };
}

module.exports = {
    addCase,
    updateCase,
    readCases,
    getCase,
    getMemberCases,
    getDueCases,
    addEvent,
    readEvents,
    pruneModerationData
};
