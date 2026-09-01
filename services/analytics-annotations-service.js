const visibleAnnotationTypes = new Set(['settings-update', 'settings-undo', 'settings-template', 'public-incident', 'moderation-action', 'module-test', 'server-restore']);

function buildAnalyticsAnnotations(entries, guildId, from = null, to = null) {
    const start = from ? new Date(from).getTime() : -Infinity;
    const end = to ? new Date(to).getTime() : Infinity;
    const grouped = new Map();

    for (const entry of entries || []) {
        const timestamp = new Date(entry?.at).getTime();
        if (String(entry?.guildId || '') !== String(guildId) || !visibleAnnotationTypes.has(entry?.type) || timestamp < start || timestamp > end) continue;
        const label = entry.message || entry.type;
        const key = `${String(entry.at).slice(0, 10)}\u001f${entry.type}\u001f${label}`;
        const existing = grouped.get(key);
        if (existing) existing.count++;
        else grouped.set(key, { at: entry.at, type: entry.type, label, count: 1 });
    }

    return [...grouped.values()].slice(0, 12);
}

module.exports = { buildAnalyticsAnnotations };
