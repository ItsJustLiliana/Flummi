const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, GuildVerificationLevel } = require('discord.js');
const { installTimestampedConsole } = require('./utils/logger');
const { loadEnv } = require('./utils/env-loader');
const config = require('./config.json');
const settingsStore = require('./stores/settings-store');
const accessStore = require('./stores/access-store');
const triggerStore = require('./stores/trigger-store');
const shotStore = require('./stores/shot-store');
const voiceStore = require('./stores/voice-store');
const serverStatsStore = require('./stores/server-stats-store');
const pingRequestStore = require('./stores/ping-request-store');
const serperUsageStore = require('./stores/serper-usage-store');
const userConversationStore = require('./stores/user-conversation-store');

installTimestampedConsole();
loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

const host = '127.0.0.1';
const port = 3789;
const openBrowserOnStart = config.panel?.openBrowserOnStart === true;
const indexPath = path.join(__dirname, 'panel', 'index.html');
const runtimeFilePath = path.join(__dirname, 'data', 'runtime', 'runtime.json');

function createClient(includeMembersIntent) {
    const intents = [GatewayIntentBits.Guilds];

    if (includeMembersIntent) {
        intents.push(GatewayIntentBits.GuildMembers);
    }

    return new Client({ intents });
}

let membersIntentEnabled = true;
let client = createClient(membersIntentEnabled);

// Retries the login without the privileged Members intent if it hasn't been enabled in the dev portal.
async function loginClient() {
    try {
        await client.login(botToken);
    } catch (error) {
        if (membersIntentEnabled && /disallowed intents/i.test(error.message)) {
            console.warn('Server Members Intent is not enabled for this bot in the Discord Developer Portal. Starting without it - the Server Members list will be unavailable until it is enabled.');
            membersIntentEnabled = false;
            client = createClient(membersIntentEnabled);
            await client.login(botToken);
            return;
        }

        throw error;
    }
}

let server = null;

const requiredBotPermissionFlags = [
    'ViewChannel',
    'SendMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
    'AddReactions',
    'MentionEveryone',
    'UseExternalEmojis'
];
const requiredBotPermissions = new PermissionsBitField(
    requiredBotPermissionFlags.map(flag => PermissionsBitField.Flags[flag])
);

function buildInviteUrl() {
    const params = new URLSearchParams({
        client_id: config.clientId || '',
        permissions: requiredBotPermissions.bitfield.toString(),
        scope: 'bot applications.commands'
    });

    return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function getMissingBotPermissions(guildId) {
    try {
        const guild = await client.guilds.fetch(guildId);
        const me = guild.members.me || await guild.members.fetchMe();
        return me.permissions.missing(requiredBotPermissions).map(flag =>
            flag.replace(/([a-z])([A-Z])/g, '$1 $2')
        );
    } catch {
        return [];
    }
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function openBrowser(url) {
    const escapedUrl = `"${url}"`;

    if (process.platform === 'win32') {
        exec(`start "" ${escapedUrl}`);
        return;
    }

    if (process.platform === 'darwin') {
        exec(`open ${escapedUrl}`);
        return;
    }

    exec(`xdg-open ${escapedUrl}`);
}

function isSendableGuildTextChannel(channel) {
    return channel && (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
    );
}

function isVoiceChannel(channel) {
    return channel && (
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice
    );
}

async function listVoiceChannels(guildId) {
    const guild = await client.guilds.fetch(guildId);

    if (!guild) {
        return [];
    }

    await guild.channels.fetch();

    return Array.from(guild.channels.cache.values())
        .filter(isVoiceChannel)
        .map(channel => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function listGuilds() {
    await client.guilds.fetch();

    return Array.from(client.guilds.cache.values())
        .map(guild => ({ id: guild.id, name: guild.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

const memberCacheTtlMs = 5 * 60 * 1000;
const memberCache = new Map();

// guild.members.fetch() uses the rate-limited REQUEST_GUILD_MEMBERS gateway opcode, so cache results per guild.
async function listGuildMembers(guildId) {
    const cached = memberCache.get(guildId);

    if (cached && Date.now() - cached.fetchedAt < memberCacheTtlMs) {
        return cached.members;
    }

    const guild = await client.guilds.fetch(guildId);

    let fetched;

    try {
        fetched = await guild.members.fetch();
    } catch (error) {
        if (cached) {
            return cached.members;
        }

        throw error;
    }

    const members = Array.from(fetched.values())
        .filter(member => !member.user.bot)
        .map(member => ({
            id: member.id,
            tag: member.user.tag,
            nickname: member.nickname || null
        }))
        .sort((a, b) => a.tag.localeCompare(b.tag));

    memberCache.set(guildId, { members, fetchedAt: Date.now() });
    return members;
}

// Resolves a display tag plus (when guildId is given) the member's current server nickname, for tooltips.
async function resolveUserLabels(userIds, guildId) {
    const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean).map(String)));
    let guild = null;

    if (guildId) {
        try {
            guild = await client.guilds.fetch(guildId);
        } catch {
            guild = null;
        }
    }

    const entries = await Promise.all(uniqueIds.map(async id => {
        if (guild) {
            try {
                const member = await guild.members.fetch(id);
                return [id, { tag: member.user.tag, nickname: member.nickname || null }];
            } catch {
                // Not a member of this guild (left, wrong guild, etc.) - fall back to a global user lookup.
            }
        }

        try {
            const user = await client.users.fetch(id);
            return [id, { tag: user.tag, nickname: null }];
        } catch {
            return [id, { tag: id, nickname: null }];
        }
    }));

    return Object.fromEntries(entries);
}

function requireGuildId(requestUrl, res) {
    const guildId = requestUrl.searchParams.get('guildId');

    if (!guildId) {
        sendJson(res, 400, { error: 'guildId is required.' });
        return null;
    }

    return guildId;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}

const verificationLevelLabels = {
    [GuildVerificationLevel.None]: 'None',
    [GuildVerificationLevel.Low]: 'Low',
    [GuildVerificationLevel.Medium]: 'Medium',
    [GuildVerificationLevel.High]: 'High',
    [GuildVerificationLevel.VeryHigh]: 'Highest'
};

async function buildGuildInfo(guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.fetch();

    const owner = await guild.fetchOwner().catch(() => null);

    return {
        id: guild.id,
        name: guild.name,
        description: guild.description || null,
        iconUrl: guild.iconURL({ size: 256, extension: 'png' }) || null,
        bannerUrl: guild.bannerURL({ size: 1024, extension: 'png' }) || null,
        memberCount: guild.memberCount,
        channelCount: guild.channels.cache.size,
        roleCount: guild.roles.cache.size,
        emojiCount: guild.emojis.cache.size,
        boostTier: guild.premiumTier ? String(guild.premiumTier) : '0',
        boostCount: guild.premiumSubscriptionCount || 0,
        verificationLevel: verificationLevelLabels[guild.verificationLevel] || 'Unknown',
        ownerTag: owner?.user?.tag || null,
        createdAt: guild.createdAt.toISOString()
    };
}

async function buildOverview(guildId) {
    const settings = settingsStore.readSettings(guildId);
    const triggers = triggerStore.getTriggers(guildId);
    const shotLeaderboard = shotStore.getShotLeaderboard(guildId, 3);
    const voiceSummary = voiceStore.getVoiceStatsSummary(guildId, 5);
    const voiceStats = voiceStore.readVoiceStats(guildId);
    const statsSummary = serverStatsStore.getServerStatsSummary(guildId, 3);
    const managers = accessStore.getManagerUserIds(guildId);
    const developerIds = accessStore.getDeveloperUserIds();
    const activeVoiceCount = voiceSummary.filter(row => row.inVoice).length;
    const totalVoiceMs = Object.values(voiceStats.users)
        .reduce((sum, entry) => sum + (Number(entry.totalMs) || 0), 0);
    const missingPermissions = await getMissingBotPermissions(guildId);
    const guildInfo = await buildGuildInfo(guildId).catch(() => null);
    const labels = await resolveUserLabels([
        ...shotLeaderboard.map(row => row.userId),
        ...voiceSummary.map(row => row.id),
        ...managers,
        ...developerIds
    ], guildId);

    return {
        settings,
        guildInfo,
        triggerCount: triggers.length,
        triggerLimit: triggerStore.getTriggerLimit(guildId),
        shotLeaderboard: shotLeaderboard.map(row => ({
            ...row,
            label: labels[row.userId]?.tag || row.userId,
            nickname: labels[row.userId]?.nickname || null
        })),
        activeVoiceCount,
        totalVoiceFormatted: formatDuration(totalVoiceMs),
        totalMessages: statsSummary.totalMessages,
        topChannels: statsSummary.channels,
        managerCount: managers.length,
        developerCount: developerIds.length,
        missingPermissions,
        inviteUrl: buildInviteUrl(),
        labels
    };
}


function readRuntimeInstances() {
    try {
        const raw = JSON.parse(fs.readFileSync(runtimeFilePath, 'utf8'));
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

async function listChannels(guildId) {
    const guild = await client.guilds.fetch(guildId);

    if (!guild) {
        return [];
    }

    await guild.channels.fetch();

    const me = guild.members.me || await guild.members.fetchMe();

    return Array.from(guild.channels.cache.values())
        .filter(channel => isSendableGuildTextChannel(channel))
        .filter(channel => channel.viewable)
        .filter(channel => {
            const permissions = channel.permissionsFor(me);
            return permissions && permissions.has('SendMessages');
        })
        .map(channel => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 20000) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function normalizeImageUrls(imageUrls) {
    if (!imageUrls) {
        return [];
    }

    if (!Array.isArray(imageUrls)) {
        throw new Error('imageUrls must be an array.');
    }

    const normalized = imageUrls
        .map(value => String(value || '').trim())
        .filter(Boolean);

    if (normalized.length > 4) {
        throw new Error('You can send up to 4 image URLs at once.');
    }

    for (const imageUrl of normalized) {
        let parsed;

        try {
            parsed = new URL(imageUrl);
        } catch {
            throw new Error(`Invalid image URL: ${imageUrl}`);
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Image URL must use http or https: ${imageUrl}`);
        }
    }

    return normalized;
}

function buildAllowedMentions(allowEveryoneMentions) {
    const parse = ['users', 'roles'];

    if (allowEveryoneMentions) {
        parse.push('everyone');
    }

    return {
        parse,
        repliedUser: false
    };
}

async function sendComposedMessage(guildId, channelId, content, imageUrls, allowEveryoneMentions) {
    const trimmed = typeof content === 'string' ? content.trim() : '';
    const files = normalizeImageUrls(imageUrls);

    if (!trimmed && files.length === 0) {
        throw new Error('Add message text or at least one image URL.');
    }

    if (trimmed.length > 2000) {
        throw new Error('Message exceeds Discord limit of 2000 characters.');
    }

    const channel = await client.channels.fetch(channelId);

    if (!channel || !isSendableGuildTextChannel(channel)) {
        throw new Error('Selected channel is not a guild text channel.');
    }

    if (channel.guildId !== guildId) {
        throw new Error('Channel does not belong to the selected guild.');
    }

    const sent = await channel.send({
        content: trimmed || undefined,
        files,
        allowedMentions: buildAllowedMentions(Boolean(allowEveryoneMentions))
    });

    return {
        id: sent.id,
        url: sent.url
    };
}

function createServer() {
    return http.createServer(async (req, res) => {
        try {
            const requestUrl = new URL(req.url, `http://${req.headers.host}`);

            if (req.method === 'GET' && requestUrl.pathname === '/') {
                const html = fs.readFileSync(indexPath, 'utf8');
                const tabOrder = Array.isArray(config.panel?.tabOrder) ? config.panel.tabOrder : [];
                const injected = html.replace(
                    '<!--PANEL_CONFIG-->',
                    `<script>window.__PANEL_TAB_ORDER__ = ${JSON.stringify(tabOrder)};</script>`
                );
                sendHtml(res, injected);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/guilds') {
                const guilds = await listGuilds();
                sendJson(res, 200, { guilds });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/channels') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const channels = await listChannels(guildId);
                sendJson(res, 200, { channels });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/overview') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                sendJson(res, 200, await buildOverview(guildId));
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/triggers') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const triggers = triggerStore.getTriggers(guildId);
                const stats = triggerStore.getAllTriggerStats(guildId);
                const audit = triggerStore.readAuditLog(guildId).slice(0, 25);
                const labels = await resolveUserLabels([
                    ...triggers.map(t => t.addedById),
                    ...audit.map(entry => entry.byId)
                ], guildId);

                sendJson(res, 200, {
                    limit: triggerStore.getTriggerLimit(guildId),
                    triggers: triggers.map(trigger => ({
                        ...trigger,
                        addedByLabel: labels[trigger.addedById]?.tag || trigger.addedById || 'Unknown',
                        addedByNickname: labels[trigger.addedById]?.nickname || null,
                        uses: stats[String(trigger.trigger).toLowerCase()] || 0
                    })).sort((a, b) => (b.uses || 0) - (a.uses || 0)),
                    audit: audit.map(entry => ({
                        ...entry,
                        byNickname: labels[entry.byId]?.nickname || null
                    }))
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/shots') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const scope = requestUrl.searchParams.get('scope') === 'global' ? 'global' : 'guild';
                const leaderboard = scope === 'global'
                    ? shotStore.getGlobalShotLeaderboard(25)
                    : shotStore.getShotLeaderboard(guildId, 25);
                const audit = shotStore.readShotAuditLog(guildId).slice(0, 25);
                const labels = await resolveUserLabels([
                    ...leaderboard.map(row => row.userId),
                    ...audit.flatMap(entry => [entry.byUserId, entry.targetUserId])
                ], guildId);

                sendJson(res, 200, {
                    scope,
                    leaderboard: leaderboard.map(row => ({
                        ...row,
                        label: labels[row.userId]?.tag || row.userId,
                        nickname: labels[row.userId]?.nickname || null
                    })),
                    audit: audit.map(entry => ({
                        ...entry,
                        byLabel: labels[entry.byUserId]?.tag || entry.byUserId || 'Unknown',
                        byNickname: labels[entry.byUserId]?.nickname || null,
                        targetLabel: labels[entry.targetUserId]?.tag || entry.targetUserId || 'Unknown',
                        targetNickname: labels[entry.targetUserId]?.nickname || null
                    }))
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/voice') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const leaderboard = voiceStore.getVoiceStatsSummary(guildId, 25);
                const stats = voiceStore.readVoiceStats(guildId);
                const activeSessions = Object.entries(stats.activeSessions).map(([userId, session]) => ({
                    userId,
                    channelId: session.channelId,
                    channelName: session.channelName,
                    startedAt: session.startedAt,
                    durationMs: Date.now() - new Date(session.startedAt).getTime()
                }));
                const recentHistory = stats.history
                    .slice()
                    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
                    .slice(0, 25);
                const labels = await resolveUserLabels([
                    ...leaderboard.map(row => row.id),
                    ...activeSessions.map(row => row.userId),
                    ...recentHistory.flatMap(row => [row.userId, ...(row.withUserIds || [])])
                ], guildId);

                sendJson(res, 200, {
                    leaderboard: leaderboard.map(row => ({
                        ...row,
                        label: labels[row.id]?.tag || row.id,
                        nickname: labels[row.id]?.nickname || null,
                        totalFormatted: formatDuration(row.totalMs)
                    })),
                    activeSessions: activeSessions.map(row => ({
                        ...row,
                        label: labels[row.userId]?.tag || row.userId,
                        nickname: labels[row.userId]?.nickname || null,
                        durationFormatted: formatDuration(row.durationMs)
                    })),
                    recentHistory: recentHistory.map(row => ({
                        ...row,
                        label: labels[row.userId]?.tag || row.userId,
                        nickname: labels[row.userId]?.nickname || null,
                        withLabels: (row.withUserIds || []).map(id => labels[id]?.tag || id),
                        withNicknames: (row.withUserIds || []).map(id => labels[id]?.nickname || null),
                        durationFormatted: formatDuration(row.durationMs)
                    }))
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/voice-channels') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const channels = await listVoiceChannels(guildId);
                sendJson(res, 200, { channels });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/voice-channel-members') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const channelId = requestUrl.searchParams.get('channelId');

                if (!channelId) {
                    sendJson(res, 400, { error: 'channelId is required.' });
                    return;
                }

                const members = voiceStore.getChannelVoiceMembers(guildId, channelId);
                const labels = await resolveUserLabels(members.map(member => member.userId), guildId);

                sendJson(res, 200, {
                    members: members.map(member => ({
                        ...member,
                        label: labels[member.userId]?.tag || member.userId,
                        nickname: labels[member.userId]?.nickname || null
                    }))
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/serverstats') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const guildInfo = await buildGuildInfo(guildId).catch(() => null);
                sendJson(res, 200, {
                    ...serverStatsStore.getServerStatsSummary(guildId, 25),
                    guildInfo
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/settings') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                sendJson(res, 200, { settings: settingsStore.readSettings(guildId) });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/settings') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');
                const current = settingsStore.readSettings(guildId);
                const next = { ...current, ...parsed };
                const saved = settingsStore.writeSettings(next, guildId);

                sendJson(res, 200, { ok: true, settings: saved });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/managers') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const managers = accessStore.getManagerUserIds(guildId);
                const developerIds = accessStore.getDeveloperUserIds();
                const labels = await resolveUserLabels([...managers, ...developerIds], guildId);

                sendJson(res, 200, {
                    managers: managers.map(id => ({ id, label: labels[id]?.tag || id, nickname: labels[id]?.nickname || null })),
                    developers: developerIds.map(id => ({ id, label: labels[id]?.tag || id, nickname: labels[id]?.nickname || null }))
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/managers') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                if (!parsed.userId || typeof parsed.shouldBeManager !== 'boolean') {
                    sendJson(res, 400, { error: 'userId and shouldBeManager are required.' });
                    return;
                }

                const managers = accessStore.setManagerRole(String(parsed.userId), parsed.shouldBeManager, guildId);
                sendJson(res, 200, { ok: true, managers });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/members') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                if (!membersIntentEnabled) {
                    sendJson(res, 502, {
                        error: 'Server members cannot be listed because the "Server Members Intent" is not enabled for this bot. Enable it in the Discord Developer Portal (Bot settings) and restart the bot.'
                    });
                    return;
                }

                let members;

                try {
                    members = await listGuildMembers(guildId);
                } catch (error) {
                    const rateLimited = /rate limited/i.test(error.message);
                    sendJson(res, 502, {
                        error: rateLimited
                            ? `Discord is rate limiting member list requests right now. Please wait a bit and try again. (${error.message})`
                            : `Failed to fetch server members. Make sure the "Server Members Intent" is enabled for this bot in the Discord Developer Portal, then restart the bot. (${error.message})`
                    });
                    return;
                }

                const featureKeys = ['useTriggers', 'addTriggers', 'useAiChat', 'useBotMentions', 'savePingRequests'];
                const rows = members.map(member => {
                    const permissions = accessStore.getUserPermissions(member.id, guildId);

                    return {
                        ...member,
                        role: accessStore.getUserRole(member.id, guildId),
                        isDeveloper: accessStore.isDeveloper(member.id),
                        overrideCount: Object.keys(permissions.commandOverrides || {}).length,
                        nonDefaultFeatureCount: featureKeys.filter(key => permissions[key] === false).length
                    };
                });

                sendJson(res, 200, { members: rows });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/members/role') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                if (!parsed.userId || !['user', 'manager'].includes(parsed.role)) {
                    sendJson(res, 400, { error: 'userId and a valid role (user or manager) are required.' });
                    return;
                }

                if (accessStore.isDeveloper(parsed.userId)) {
                    sendJson(res, 400, { error: 'Developers are managed through config.json, not this panel.' });
                    return;
                }

                accessStore.setManagerRole(String(parsed.userId), parsed.role === 'manager', guildId);
                sendJson(res, 200, { ok: true, role: accessStore.getUserRole(parsed.userId, guildId) });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/members/reset') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                if (!parsed.userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                if (accessStore.isDeveloper(parsed.userId)) {
                    sendJson(res, 400, { error: 'Developers cannot be reset from this panel.' });
                    return;
                }

                accessStore.resetUserPermissions(String(parsed.userId), guildId);
                sendJson(res, 200, { ok: true });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/permissions') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const userId = requestUrl.searchParams.get('userId');

                if (!userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                sendJson(res, 200, {
                    role: accessStore.getUserRole(userId, guildId),
                    permissions: accessStore.getUserPermissions(userId, guildId)
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/permissions') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');
                const userId = parsed.userId;

                if (!userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                if (accessStore.isDeveloper(userId)) {
                    sendJson(res, 400, { error: 'Developers always have full access and cannot be edited here.' });
                    return;
                }

                const featureKeys = ['useTriggers', 'addTriggers', 'useAiChat', 'useBotMentions', 'savePingRequests'];

                for (const key of featureKeys) {
                    if (typeof parsed[key] === 'boolean') {
                        accessStore.setUserPermission(userId, key, parsed[key], guildId);
                    }
                }

                if (parsed.commandPath) {
                    const normalizedPath = accessStore.normalizeCommandPath(parsed.commandPath);

                    if (!normalizedPath) {
                        sendJson(res, 400, { error: `Invalid command path: ${parsed.commandPath}` });
                        return;
                    }

                    const accessValue = parsed.commandAccess === 'allow'
                        ? true
                        : parsed.commandAccess === 'block'
                            ? false
                            : parsed.commandAccess === 'inherit'
                                ? null
                                : undefined;

                    if (accessValue === undefined) {
                        sendJson(res, 400, { error: 'commandAccess must be allow, block, or inherit.' });
                        return;
                    }

                    accessStore.setUserCommandPermission(userId, normalizedPath, accessValue, guildId);
                }

                sendJson(res, 200, {
                    role: accessStore.getUserRole(userId, guildId),
                    permissions: accessStore.getUserPermissions(userId, guildId)
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/pingrequests') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const entries = pingRequestStore.readPingRequests(guildId).slice(0, 25);
                const labels = await resolveUserLabels(entries.flatMap(entry => [
                    entry.byId,
                    ...(entry.content || []).map(item => item.sendById)
                ]), guildId);

                sendJson(res, 200, {
                    entries: entries.map(entry => ({
                        ...entry,
                        byLabel: labels[entry.byId]?.tag || entry.byId || 'Unknown',
                        byNickname: labels[entry.byId]?.nickname || null
                    }))
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/ai-memory') {
                const userId = requestUrl.searchParams.get('userId');

                if (!userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                sendJson(res, 200, userConversationStore.getUserConversationSummary(userId));
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/serper-usage') {
                sendJson(res, 200, serperUsageStore.readSerperUsage());
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/runtime') {
                sendJson(res, 200, { instances: readRuntimeInstances() });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
                sendJson(res, 200, {
                    developerUserIds: accessStore.getDeveloperUserIds(),
                    commandPermissions: config.commandPermissions || {}
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/invite-link') {
                sendJson(res, 200, {
                    url: buildInviteUrl(),
                    permissions: requiredBotPermissionFlags
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/send') {
                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                const guildId = parsed.guildId;
                const channelId = parsed.channelId;
                const content = parsed.content;
                const imageUrls = parsed.imageUrls;
                const allowEveryoneMentions = parsed.allowEveryoneMentions;

                if (!guildId || !channelId) {
                    sendJson(res, 400, { error: 'guildId and channelId are required.' });
                    return;
                }

                const result = await sendComposedMessage(
                    guildId,
                    channelId,
                    content,
                    imageUrls,
                    allowEveryoneMentions
                );
                sendJson(res, 200, { ok: true, message: result });
                return;
            }

            sendJson(res, 404, { error: 'Not found.' });
        } catch (error) {
            sendJson(res, 500, { error: error.message || 'Internal server error.' });
        }
    });
}

async function start() {
    if (!botToken) {
        throw new Error('Missing bot token. Set DISCORD_BOT_TOKEN in .env.');
    }

    await loginClient();

    const url = `http://${host}:${port}`;

    server = createServer();
    server.listen(port, host, () => {
        console.log(`Bot control panel running at ${url}`);

        if (openBrowserOnStart) {
            openBrowser(url);
        }
    });
}

function shutdown() {
    if (server) {
        server.close();
    }

    client.destroy();
}

process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
});

start().catch(error => {
    console.error('Failed to start control panel:', error);
    process.exit(1);
});
