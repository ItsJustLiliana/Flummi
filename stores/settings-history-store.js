const fs = require('fs');
const path = require('path');
const recoveryWindowMs = 30 * 86400000;

function targetPath(guildId) {
    return path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'settings-history.json');
}

function readHistory(guildId) {
    try {
        const value = JSON.parse(fs.readFileSync(targetPath(guildId), 'utf8'));
        const entries = Array.isArray(value.entries) ? value.entries : [];
        return { revision: Number(value.revision) || 0, entries: entries.filter(entry => Date.now() - new Date(entry.at).getTime() <= recoveryWindowMs) };
    } catch {
        return { revision: 0, entries: [] };
    }
}

function write(guildId, value) {
    const file = targetPath(guildId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    return value;
}

function recordChange(guildId, { actorId, actorName, before, after, summary = 'Updated server settings' }) {
    const current = readHistory(guildId);
    const entry = {
        id: `settings-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        at: new Date().toISOString(), actorId: String(actorId || 'unknown'), actorName: String(actorName || 'Unknown'),
        summary: String(summary).slice(0, 160), before, after, undoneAt: null, undoneBy: null
    };
    const next = { revision: current.revision + 1, entries: [entry, ...current.entries].slice(0, 30) };
    write(guildId, next);
    return { entry, revision: next.revision };
}

function markUndone(guildId, id, actorId) {
    const current = readHistory(guildId);
    const entry = current.entries.find(item => item.id === String(id));
    if (!entry || entry.undoneAt) return null;
    entry.undoneAt = new Date().toISOString();
    entry.undoneBy = String(actorId || 'unknown');
    current.revision += 1;
    write(guildId, current);
    return { entry, revision: current.revision };
}

module.exports = { markUndone, readHistory, recordChange, recoveryWindowMs };
