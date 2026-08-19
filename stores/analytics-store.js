const fs = require('fs');
const path = require('path');

// NDJSON is intentionally used here: an event is appended without rewriting a
// growing array.  Files rotate before 1 MiB, so a single busy server can never
// turn one analytics file into an unmanageable document.
const dataDir = path.join(__dirname, '..', 'data');
const MAX_SHARD_BYTES = 1024 * 1024;
const MAX_QUERY_EVENTS = 100000;

function analyticsDir(guildId, category) {
    return path.join(dataDir, 'guilds', String(guildId), 'analytics', category);
}

function monthKey(iso) {
    return String(iso || new Date().toISOString()).slice(0, 7);
}

function nextShardPath(guildId, category, at, lineBytes) {
    const folder = path.join(analyticsDir(guildId, category), monthKey(at));
    fs.mkdirSync(folder, { recursive: true });
    const parts = fs.readdirSync(folder).filter(name => /^part-\d{4}\.ndjson$/.test(name)).sort();
    let name = parts.at(-1) || 'part-0001.ndjson';
    let filePath = path.join(folder, name);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size + lineBytes > MAX_SHARD_BYTES) {
        const number = Number(name.match(/\d+/)?.[0] || 1) + 1;
        name = `part-${String(number).padStart(4, '0')}.ndjson`;
        filePath = path.join(folder, name);
    }
    return filePath;
}

function appendEvent(guildId, category, event) {
    if (!guildId || !category) return;
    const row = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...event };
    const line = `${JSON.stringify(row)}\n`;
    fs.appendFileSync(nextShardPath(guildId, category, row.at, Buffer.byteLength(line)), line);
    return row;
}

function recordMessageEvent({ guildId, channelId, channelName, userId, userTag, message }) {
    return appendEvent(guildId, 'messages', {
        type: 'message', channelId: String(channelId || ''), channelName: channelName || String(channelId || ''),
        userId: String(userId || ''), userTag: userTag || String(userId || ''),
        characters: String(message?.content || '').length, attachments: message?.attachments?.size || 0,
        embeds: message?.embeds?.length || 0, hasReply: Boolean(message?.reference?.messageId)
    });
}

function recordVoiceEvent(guildId, event) { return appendEvent(guildId, 'voice', { type: 'voice', ...event }); }

function listFiles(folder) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? listFiles(file) : entry.name.endsWith('.ndjson') ? [file] : [];
    });
}

function readEvents(guildId, category, from = 0, to = Date.now()) {
    const rows = [];
    for (const file of listFiles(analyticsDir(guildId, category))) {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            try {
                const row = JSON.parse(line); const at = new Date(row.at).getTime();
                if (at >= from && at <= to) rows.push(row);
            } catch { /* an incomplete final line after a power loss is safely ignored */ }
            if (rows.length >= MAX_QUERY_EVENTS) return rows;
        }
    }
    return rows;
}

function getAnalyticsSummary(guildId, days = 30) {
    const from = Date.now() - Math.max(1, Number(days) || 30) * 86400000;
    const messages = readEvents(guildId, 'messages', from);
    const voice = readEvents(guildId, 'voice', from);
    const byDay = new Map(), channels = new Map(), users = new Map();
    for (const row of messages) {
        const day = row.at.slice(0, 10); byDay.set(day, (byDay.get(day) || 0) + 1);
        const channel = channels.get(row.channelId) || { id: row.channelId, name: row.channelName, count: 0 };
        channel.count++; channels.set(row.channelId, channel);
        const user = users.get(row.userId) || { id: row.userId, name: row.userTag, count: 0 };
        user.count++; users.set(row.userId, user);
    }
    return {
        periodDays: Math.max(1, Number(days) || 30), messageCount: messages.length,
        voiceEvents: voice.length, uniqueAuthors: users.size,
        dailyMessages: [...byDay].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
        topChannels: [...channels.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        topUsers: [...users.values()].sort((a, b) => b.count - a.count).slice(0, 10)
    };
}

function getStorageDetails(guildId) {
    const base = path.join(dataDir, 'guilds', String(guildId), 'analytics');
    return listFiles(base).map(file => ({ name: path.relative(base, file).replace(/\\/g, '/'), size: fs.statSync(file).size }));
}

module.exports = { MAX_SHARD_BYTES, appendEvent, getAnalyticsSummary, getStorageDetails, readEvents, recordMessageEvent, recordVoiceEvent };
