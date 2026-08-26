const fs = require('fs');
const path = require('path');
const { rebuildAnalyticsRollups } = require('./data-retention-service');
const { historyPathForGuildRoot, readAnonymousAnalyticsAt, writeAnonymousAnalyticsAt } = require('../stores/anonymous-analytics-store');

const defaultRoot = path.join(__dirname, '..', 'data');
const categories = new Set(['messages', 'voice', 'moderation', 'soundboard']);

function listNdjson(folder) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(folder, entry.name);
        return entry.isDirectory() ? listNdjson(target) : target.endsWith('.ndjson') ? [target] : [];
    });
}

function normalizeFilters(input = {}) {
    const category = String(input.category || '');
    if (!categories.has(category)) throw new Error('Unsupported analytics category.');
    const from = Date.parse(input.from || '');
    const to = Date.parse(input.to || '');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) throw new Error('A valid from/to range is required.');
    const includeAnonymous = input.includeAnonymous === true;
    const userId = String(input.userId || '').trim() || null;
    const channelId = String(input.channelId || '').trim() || null;
    if (includeAnonymous && (userId || channelId)) throw new Error('Anonymous history can only be corrected for complete server-wide UTC days.');
    return { category, from, to, fromDate: new Date(from).toISOString().slice(0, 10), toDate: new Date(to).toISOString().slice(0, 10), userId, channelId, includeAnonymous };
}

function matches(row, filters) {
    const timestamp = Date.parse(row.at || row.startedAt || row.createdAt || '');
    if (!Number.isFinite(timestamp) || timestamp < filters.from || timestamp > filters.to) return false;
    if (filters.userId && ![row.userId, row.authorId, row.memberId].some(value => String(value || '') === filters.userId)) return false;
    if (filters.channelId && String(row.channelId || '') !== filters.channelId) return false;
    return true;
}

function inspectRaw(guildRoot, filters, apply) {
    const folder = path.join(guildRoot, 'analytics', filters.category);
    let matched = 0;
    const files = [];
    for (const filePath of listNdjson(folder)) {
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
        let fileMatches = 0;
        const kept = lines.filter(line => {
            try {
                const remove = matches(JSON.parse(line), filters);
                if (remove) { matched++; fileMatches++; }
                return !remove;
            } catch { return true; }
        });
        if (fileMatches) files.push({ file: path.relative(guildRoot, filePath).replace(/\\/g, '/'), records: fileMatches });
        if (apply && fileMatches) {
            const temporary = `${filePath}.${process.pid}.correction.tmp`;
            fs.writeFileSync(temporary, kept.length ? `${kept.join('\n')}\n` : '');
            fs.renameSync(temporary, filePath);
            if (!kept.length) fs.rmSync(filePath, { force: true });
        }
    }
    return { matched, files };
}

function inspectAnonymous(guildRoot, filters, apply) {
    if (!filters.includeAnonymous || !['messages', 'voice'].includes(filters.category)) return { matchedDays: 0, dates: [] };
    const filePath = historyPathForGuildRoot(guildRoot);
    const history = readAnonymousAnalyticsAt(filePath);
    const bucket = history[filters.category].byDay;
    const dates = Object.keys(bucket).filter(date => date >= filters.fromDate && date <= filters.toDate).sort();
    if (apply && dates.length) {
        for (const date of dates) delete bucket[date];
        writeAnonymousAnalyticsAt(filePath, history);
    }
    return { matchedDays: dates.length, dates };
}

function correctAnalytics(guildId, input, { root = defaultRoot, apply = false } = {}) {
    const filters = normalizeFilters(input);
    const guildRoot = path.join(root, 'guilds', String(guildId));
    if (!fs.existsSync(guildRoot)) throw new Error('Guild analytics storage was not found.');
    const raw = inspectRaw(guildRoot, filters, apply);
    const anonymous = inspectAnonymous(guildRoot, filters, apply);
    if (apply && (raw.matched || anonymous.matchedDays)) rebuildAnalyticsRollups(guildRoot);
    return { guildId: String(guildId), filters, raw, anonymous, applied: apply };
}

module.exports = { correctAnalytics, normalizeFilters };
