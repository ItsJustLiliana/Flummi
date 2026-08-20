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
        embeds: message?.embeds?.length || 0, reactions: message?.reactions?.cache?.size || 0,
        hasReply: Boolean(message?.reference?.messageId), isThread: Boolean(message?.channel?.isThread?.())
    });
}

function recordVoiceEvent(guildId, event) { return appendEvent(guildId, 'voice', { type: 'voice', ...event }); }
function recordModerationEvent(guildId, event) { return appendEvent(guildId, 'moderation', { type: 'moderation', ...event }); }
function recordSoundboardEvent(guildId, event) { return appendEvent(guildId, 'soundboard', { type: 'soundboard', ...event }); }

function getSoundboardSummary(guildId, days = 30) {
    const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
    const rows = readEvents(guildId, 'soundboard', Date.now() - safeDays * 86400000);
    const sounds = new Map(), channels = new Map(), users = new Map(), daysByDate = new Map();
    for (const row of rows) {
        const sound = sounds.get(row.soundId) || { soundId: row.soundId, count: 0 }; sound.count++; sounds.set(row.soundId, sound);
        if (row.channelId) { const channel = channels.get(row.channelId) || { channelId: row.channelId, count: 0 }; channel.count++; channels.set(row.channelId, channel); }
        if (row.userId) { const user = users.get(row.userId) || { userId: row.userId, count: 0 }; user.count++; users.set(row.userId, user); }
        const date = String(row.at || '').slice(0, 10);
        if (date) daysByDate.set(date, (daysByDate.get(date) || 0) + 1);
    }
    const byDay = [];
    for (let offset = safeDays - 1; offset >= 0; offset--) {
        const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
        byDay.push({ date, count: daysByDate.get(date) || 0 });
    }
    return {
        plays: rows.length,
        byDay,
        topSounds: [...sounds.values()].sort((a, b) => b.count - a.count),
        topChannels: [...channels.values()].sort((a, b) => b.count - a.count),
        topUsers: [...users.values()].sort((a, b) => b.count - a.count)
    };
}

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

function getAnalyticsSummary(guildId, days = 30, channelId = null, userId = null) {
    const safeDays = Math.max(1, Number(days) || 30);
    const from = Date.now() - safeDays * 86400000;
    const normalizedChannelId = channelId ? String(channelId) : null;
    const normalizedUserId = userId ? String(userId) : null;
    const messages = readEvents(guildId, 'messages', from).filter(row => (!normalizedChannelId || row.channelId === normalizedChannelId) && (!normalizedUserId || row.userId === normalizedUserId));
    const voice = readEvents(guildId, 'voice', from);
    const moderationRows = readEvents(guildId, 'moderation', from);
    const previousMessages = readEvents(guildId, 'messages', from - safeDays * 86400000, from - 1).filter(row => (!normalizedChannelId || row.channelId === normalizedChannelId) && (!normalizedUserId || row.userId === normalizedUserId));
    const byDay = new Map(), channels = new Map(), users = new Map(), heatmap = Array.from({ length: 7 }, () => Array(24).fill(0));
    const engagement = { attachments: 0, embeds: 0, reactions: 0, replies: 0, threads: 0 };
    for (const row of messages) {
        const day = row.at.slice(0, 10); byDay.set(day, (byDay.get(day) || 0) + 1);
        const channel = channels.get(row.channelId) || { id: row.channelId, name: row.channelName, count: 0 };
        channel.count++; channels.set(row.channelId, channel);
        const user = users.get(row.userId) || { id: row.userId, name: row.userTag, count: 0 };
        user.count++; users.set(row.userId, user);
        const date = new Date(row.at); heatmap[date.getUTCDay()][date.getUTCHours()]++;
        engagement.attachments += Number(row.attachments) || 0; engagement.embeds += Number(row.embeds) || 0;
        engagement.reactions += Number(row.reactions) || 0; engagement.replies += row.hasReply ? 1 : 0; engagement.threads += row.isThread ? 1 : 0;
    }
    const dailyMessages = [];
    for (let offset = safeDays - 1; offset >= 0; offset--) {
        const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
        dailyMessages.push({ date, count: byDay.get(date) || 0 });
    }
    const moderation = { joins: 0, leaves: 0, deletedMessages: 0, roleChanges: 0, inviteUses: 0 };
    for (const row of moderationRows) {
        if (row.action === 'member-join') moderation.joins++;
        if (row.action === 'member-leave') moderation.leaves++;
        if (row.action === 'message-delete') moderation.deletedMessages++;
        if (row.action === 'role-change') moderation.roleChanges++;
        if (row.action === 'invite-use') moderation.inviteUses++;
    }
    const busiestDay = dailyMessages.reduce((best, row) => row.count > best.count ? row : best, { date: null, count: 0 });
    const hourlyTotals = heatmap.reduce((totals, day) => day.map((count, hour) => totals[hour] + count), Array(24).fill(0));
    const busiestHour = hourlyTotals.indexOf(Math.max(...hourlyTotals));
    const changePercent = previousMessages.length ? Math.round((messages.length - previousMessages.length) / previousMessages.length * 100) : (messages.length ? 100 : 0);
    return {
        periodDays: safeDays, messageCount: messages.length,
        voiceEvents: voice.length, uniqueAuthors: users.size,
        dailyMessages, engagement, heatmap, moderation,
        comparison: { previousMessageCount: previousMessages.length, changePercent, busiestDay, busiestHour },
        topChannels: [...channels.values()].sort((a, b) => b.count - a.count).slice(0, 10),
        topUsers: [...users.values()].sort((a, b) => b.count - a.count).slice(0, 10)
    };
}

function getStorageDetails(guildId) {
    const base = path.join(dataDir, 'guilds', String(guildId), 'analytics');
    return listFiles(base).map(file => ({ name: path.relative(base, file).replace(/\\/g, '/'), size: fs.statSync(file).size }));
}

function pruneAnalytics(guildId, retentionDays = 365) {
    const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 365) * 86400000;
    let removed = 0;
    for (const category of ['messages', 'voice', 'moderation', 'soundboard']) {
        for (const file of listFiles(analyticsDir(guildId, category))) {
            const kept = fs.readFileSync(file, 'utf8').split('\n').filter(line => {
                try { const row = JSON.parse(line); if (new Date(row.at).getTime() >= cutoff) return true; removed++; return false; } catch { return false; }
            });
            if (kept.length) fs.writeFileSync(file, `${kept.join('\n')}\n`); else fs.rmSync(file, { force: true });
        }
    }
    return removed;
}

module.exports = { MAX_SHARD_BYTES, appendEvent, getAnalyticsSummary, getSoundboardSummary, getStorageDetails, pruneAnalytics, readEvents, recordMessageEvent, recordModerationEvent, recordSoundboardEvent, recordVoiceEvent };
