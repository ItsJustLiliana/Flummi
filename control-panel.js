const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { exec } = require('child_process');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, GuildVerificationLevel } = require('discord.js');
const { installTimestampedConsole, readRecentLogs } = require('./utils/logger');
const { readActivity, recordActivity } = require('./stores/activity-store');
const { loadEnv } = require('./utils/env-loader');
const { readConfig, saveConfig: saveLocalConfig } = require('./utils/config');
const config = readConfig();
const settingsStore = require('./stores/settings-store');
const accessStore = require('./stores/access-store');
const triggerStore = require('./stores/trigger-store');
const shotStore = require('./stores/shot-store');
const voiceStore = require('./stores/voice-store');
const serverStatsStore = require('./stores/server-stats-store');
const analyticsStore = require('./stores/analytics-store');
const pingRequestStore = require('./stores/ping-request-store');
const serperUsageStore = require('./stores/serper-usage-store');
const pingMetricsStore = require('./stores/ping-metrics-store');
const aiHealthStore = require('./stores/ai-health-store');
const userConversationStore = require('./stores/user-conversation-store');
const profileStore = require('./stores/profile-store');
const { getAiConfig, buildTextModelCandidates, buildVisionModelCandidates } = require('./services/ai-chat');
const readyEvent = require('./events/ready');

installTimestampedConsole();
loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

const host = '0.0.0.0';
const port = 3789;
const openBrowserOnStart = config.panel?.openBrowserOnStart === true;
const indexPath = path.join(__dirname, 'panel', 'index.html');
const brandingDir = path.join(__dirname, 'assets', 'branding');
const runtimeFilePath = path.join(__dirname, 'data', 'runtime', 'runtime.json');
const updateStatusFilePath = path.join(__dirname, 'data', 'runtime', 'update-status.json');
const dataDir = path.join(__dirname, 'data');
const panelSessionsFilePath = path.join(__dirname, 'data', 'runtime', 'panel-sessions.json');
const panelSessions = new Map();
const oauthStates = new Map();
const sessionDurationMs = 14 * 24 * 60 * 60 * 1000;

function sessionKey(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function persistPanelSessions() {
    fs.mkdirSync(path.dirname(panelSessionsFilePath), { recursive: true });
    fs.writeFileSync(panelSessionsFilePath, JSON.stringify([...panelSessions.entries()]));
}

function loadPanelSessions() {
    try {
        const records = JSON.parse(fs.readFileSync(panelSessionsFilePath, 'utf8'));
        if (!Array.isArray(records)) return;
        for (const [key, session] of records) {
            if (typeof key === 'string' && session?.expiresAt > Date.now()) panelSessions.set(key, session);
        }
    } catch { /* no persisted sessions yet */ }
}

loadPanelSessions();

function parseCookies(req) {
    return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => part.trim().split(/=(.*)/s, 2)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')]));
}

function isSecureRequest(req) {
    return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function panelPublicUrl(req) {
    const configured = process.env.PANEL_PUBLIC_URL || config.panel?.publicUrl;
    if (configured) return String(configured).replace(/\/$/, '');
    return `${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
}

function sendRedirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function sessionFor(req) {
    const token = parseCookies(req).flummi_panel_session;
    const key = token ? sessionKey(token) : null;
    const session = key ? panelSessions.get(key) : null;
    if (!session || session.expiresAt <= Date.now()) {
        if (key) {
            if (panelSessions.delete(key)) persistPanelSessions();
        }
        return null;
    }
    return { key, ...session };
}

function requirePanelAccess(req, res) {
    const session = sessionFor(req);
    if (!session) {
        sendJson(res, 401, { error: 'Discord sign-in required.' });
        return null;
    }
    return session;
}

function loginPage(message = '') {
    const safeMessage = String(message).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flummi Panel</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#edf2ff;font:16px Segoe UI,sans-serif}.card{width:min(420px,calc(100vw - 40px));padding:32px;border:1px solid #243157;border-radius:16px;background:#111a33;box-shadow:0 16px 50px #0006}h1{margin:0 0 8px}.sub{color:#a5b1d8;line-height:1.5}a{display:block;margin-top:24px;padding:12px 16px;border-radius:9px;background:#5865f2;color:white;text-align:center;text-decoration:none;font-weight:700}.error{margin-top:14px;color:#ffbf5b}</style><main class="card"><h1>Flummi Admin Panel</h1><p class="sub">Sign in with the Discord account configured as a Flummi developer.</p>${safeMessage ? `<p class="error">${safeMessage}</p>` : ''}<a href="/auth/login">Continue with Discord</a></main></html>`;
}

function cleanupAuthRecords() {
    const now = Date.now();
    let sessionsChanged = false;
    for (const [token, session] of panelSessions) {
        if (session.expiresAt <= now) {
            panelSessions.delete(token);
            sessionsChanged = true;
        }
    }
    if (sessionsChanged) persistPanelSessions();
    for (const [state, record] of oauthStates) if (record.expiresAt <= now) oauthStates.delete(state);
}

function saveConfig(updates) {
    Object.assign(config, updates);
    return saveLocalConfig(config);
}

function fileDetails(folder) {
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(name => name.endsWith('.json')).map(name => {
        const file = path.join(folder, name); const stat = fs.statSync(file);
        return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    });
}

function folderStats(folder) {
    if (!fs.existsSync(folder)) return { bytes: 0, oldestAt: null };
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    return entries.reduce((total, entry) => {
        const target = path.join(folder, entry.name);
        if (entry.isDirectory()) { const nested = folderStats(target); total.bytes += nested.bytes; total.oldestAt = !total.oldestAt || (nested.oldestAt && nested.oldestAt < total.oldestAt) ? nested.oldestAt : total.oldestAt; }
        else { const stat = fs.statSync(target); total.bytes += stat.size; const at = stat.mtime.toISOString(); total.oldestAt = !total.oldestAt || at < total.oldestAt ? at : total.oldestAt; }
        return total;
    }, { bytes: 0, oldestAt: null });
}

function backupRoot(guildId) { return path.join(dataDir, 'global', 'backups', String(guildId)); }
function latestBackup(guildId) {
    const root = backupRoot(guildId); if (!fs.existsSync(root)) return null;
    const name = fs.readdirSync(root).filter(name => name.endsWith('.snapshot')).sort().at(-1);
    return name ? { name, createdAt: fs.statSync(path.join(root, name)).mtime.toISOString() } : null;
}

function createClient(includeMembersIntent) {
    const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];

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

function sendAsset(res, filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === '.jpeg' || extension === '.jpg'
        ? 'image/jpeg'
        : extension === '.png'
            ? 'image/png'
            : 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(filePath).pipe(res);
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
            username: member.user.username,
            globalName: member.user.globalName || null,
            displayName: member.displayName || member.nickname || member.user.globalName || member.user.username,
            nickname: member.nickname || null,
            avatarUrl: member.displayAvatarURL({ size: 128 }),
            bannerUrl: typeof member.bannerURL === 'function' ? member.bannerURL({ size: 1024 }) : null
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
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
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
        analytics: analyticsStore.getAnalyticsSummary(guildId, 7),
        voiceAnalytics: voiceStore.getVoiceAnalytics(guildId, sevenDaysAgo),
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

function readBody(req, maxBytes = 20000) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (Buffer.byteLength(body, 'utf8') > maxBytes) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

async function auditGuildChannelPermissions(guildId) {
    const guild = await client.guilds.fetch(guildId); const me = guild.members.me || await guild.members.fetchMe(); await guild.channels.fetch();
    const textTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia]);
    const voiceTypes = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
    return Array.from(guild.channels.cache.values()).filter(channel => textTypes.has(channel.type) || voiceTypes.has(channel.type)).map(channel => {
        const required = textTypes.has(channel.type) ? ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'] : ['ViewChannel', 'Connect', 'Speak'];
        const missing = required.filter(permission => !channel.permissionsFor(me)?.has(permission));
        return missing.length ? { id: channel.id, name: channel.name, type: textTypes.has(channel.type) ? 'Text' : 'Voice', missing: missing.map(flag => flag.replace(/([a-z])([A-Z])/g, '$1 $2')) } : null;
    }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

function retentionSummary(guildId) {
    const root = path.join(dataDir, 'guilds', guildId); const analytics = folderStats(path.join(root, 'analytics')); const total = folderStats(root); const backups = folderStats(backupRoot(guildId)); const ageDays = total.oldestAt ? Math.max(1, (Date.now() - new Date(total.oldestAt).getTime()) / 86400000) : 1;
    const operational = Math.max(0, total.bytes - analytics.bytes);
    return { totalBytes: total.bytes, forecast30DaysBytes: Math.round(total.bytes / ageDays * 30), categories: [{ name: 'Analytics', bytes: analytics.bytes, forecast30DaysBytes: Math.round(analytics.bytes / ageDays * 30) }, { name: 'Guild data & settings', bytes: operational, forecast30DaysBytes: Math.round(operational / ageDays * 30) }, { name: 'Backups', bytes: backups.bytes, forecast30DaysBytes: 0 }] };
}

async function discordBotApi(pathname, options = {}) {
    const response = await fetch(`https://discord.com/api/v10${pathname}`, {
        ...options,
        headers: {
            Authorization: `Bot ${botToken}`,
            // Discord requires a recognised content type on HTTP API calls, including reads.
            // Without it, the API responds with 50035 "Invalid Form Body".
            'Content-Type': 'application/json',
            'User-Agent': 'DiscordBot (https://github.com/ItsJustLiliana/Flummi, 1.0)',
            ...(options.headers || {})
        }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.message || `Discord API request failed (${response.status}).`);
    }

    return payload;
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) throw new Error('Tags must be a list.');
    const normalized = [...new Set(tags.map(tag => String(tag || '').trim()).filter(Boolean))];
    if (normalized.length > 5 || normalized.some(tag => tag.length > 20)) {
        throw new Error('Use at most 5 tags, each up to 20 characters.');
    }
    return normalized;
}

function optionalImageData(value, fieldName) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
        throw new Error(`${fieldName} must be an uploaded PNG, JPEG, WebP, or GIF image.`);
    }
    if (Buffer.byteLength(value, 'utf8') > 7 * 1024 * 1024) {
        throw new Error(`${fieldName} image is too large. Use a file under 5 MB.`);
    }
    return value;
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

function formatTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

            if (req.method === 'GET' && requestUrl.pathname === '/auth/login') {
                const clientSecret = process.env.DISCORD_CLIENT_SECRET;
                if (!clientSecret || !config.clientId) {
                    sendHtml(res, loginPage('Discord OAuth is not configured yet. Add the client secret on the server first.'));
                    return;
                }

                cleanupAuthRecords();
                const state = crypto.randomBytes(32).toString('hex');
                const redirectUri = `${panelPublicUrl(req)}/auth/callback`;
                oauthStates.set(state, { redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
                const authorize = new URL('https://discord.com/oauth2/authorize');
                authorize.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state }).toString();
                sendRedirect(res, authorize.toString());
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/auth/callback') {
                const state = requestUrl.searchParams.get('state');
                const code = requestUrl.searchParams.get('code');
                const record = state ? oauthStates.get(state) : null;
                oauthStates.delete(state);

                if (!record || !code || record.expiresAt <= Date.now()) {
                    sendHtml(res, loginPage('This sign-in link expired. Please try again.'));
                    return;
                }

                const clientSecret = process.env.DISCORD_CLIENT_SECRET;
                try {
                    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ client_id: config.clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: record.redirectUri })
                    });
                    const token = await tokenResponse.json();
                    if (!tokenResponse.ok || !token.access_token) throw new Error('Discord did not return an access token.');

                    const userResponse = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
                    const user = await userResponse.json();
                    if (!userResponse.ok || !user?.id) throw new Error('Discord user lookup failed.');
                    if (!accessStore.isDeveloper(user.id)) {
                        sendHtml(res, loginPage('This Discord account is not allowed to access the panel.'));
                        return;
                    }

                    const sessionToken = crypto.randomBytes(32).toString('hex');
                    panelSessions.set(sessionKey(sessionToken), { userId: user.id, username: user.global_name || user.username, avatar: user.avatar || null, expiresAt: Date.now() + sessionDurationMs });
                    persistPanelSessions();
                    const secure = record.redirectUri.startsWith('https://') ? '; Secure' : '';
                    res.writeHead(302, { Location: '/', 'Set-Cookie': `flummi_panel_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secure}` });
                    res.end();
                } catch (error) {
                    console.error('Discord OAuth login failed:', error);
                    sendHtml(res, loginPage('Discord sign-in failed. Check the redirect URL and try again.'));
                }
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/auth/me') {
                const session = requirePanelAccess(req, res);
                if (!session) return;
                const avatarUrl = session.avatar ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number(session.userId) % 5}.png`;
                sendJson(res, 200, { user: { id: session.userId, username: session.username, avatarUrl } });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/auth/logout') {
                const session = sessionFor(req);
                if (session) {
                    panelSessions.delete(session.key);
                    persistPanelSessions();
                }
                res.writeHead(204, { 'Set-Cookie': 'flummi_panel_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
                res.end();
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/') {
                if (!sessionFor(req)) {
                    sendHtml(res, loginPage());
                    return;
                }
                const html = fs.readFileSync(indexPath, 'utf8');
                const tabOrder = Array.isArray(config.panel?.tabOrder) ? config.panel.tabOrder : [];
                const tabNames = config.panel?.tabNames && typeof config.panel.tabNames === 'object' ? config.panel.tabNames : {};
                const injected = html.replace(
                    '<!--PANEL_CONFIG-->',
                    `<script>window.__PANEL_TAB_ORDER__ = ${JSON.stringify(tabOrder)}; window.__PANEL_TAB_NAMES__ = ${JSON.stringify(tabNames)};</script>`
                );
                sendHtml(res, injected);
                return;
            }

            if (requestUrl.pathname.startsWith('/api/')) {
                if (!requirePanelAccess(req, res)) return;
            }

            if (req.method === 'GET' && requestUrl.pathname.startsWith('/assets/branding/')) {
                const fileName = path.basename(requestUrl.pathname);
                const filePath = path.join(brandingDir, fileName);

                if (!fs.existsSync(filePath)) {
                    sendJson(res, 404, { error: 'Asset not found.' });
                    return;
                }

                sendAsset(res, filePath);
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

            if (req.method === 'POST' && requestUrl.pathname === '/api/triggers') {
                const guildId = requestUrl.searchParams.get('guildId');
                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                if (!guildId || !parsed.phrase || (!parsed.response && !parsed.image)) {
                    sendJson(res, 400, { error: 'guildId, phrase, and a response or image are required.' });
                    return;
                }

                const settings = settingsStore.readSettings(guildId);
                const phrase = String(parsed.phrase).trim();

                if (phrase.length > settings.maxTriggerLength) {
                    sendJson(res, 400, { error: `Trigger phrase cannot exceed ${settings.maxTriggerLength} characters.` });
                    return;
                }

                const result = triggerStore.addTrigger({
                    trigger: phrase,
                    response: String(parsed.response || '').trim() || null,
                    image: String(parsed.image || '').trim() || null,
                    addedById: 'panel',
                    addedByTag: 'Admin Panel',
                    addedAt: formatTimestamp()
                }, guildId);

                if (!result.ok) {
                    sendJson(res, 400, { error: result.reason === 'duplicate' ? 'That trigger already exists.' : 'Trigger limit reached.' });
                    return;
                }

                triggerStore.appendAuditEntry({ action: 'add', trigger: phrase, byId: 'panel', byTag: 'Admin Panel', at: formatTimestamp() }, guildId);
                recordActivity('trigger-add', `Trigger "${phrase}" added`, { guildId });
                sendJson(res, 200, { ok: true, trigger: result.trigger });
                return;
            }

            if (req.method === 'PATCH' && requestUrl.pathname === '/api/triggers') {
                const guildId = requestUrl.searchParams.get('guildId');
                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');
                const phrase = String(parsed.phrase || '').trim();
                const updates = {};

                if (Object.prototype.hasOwnProperty.call(parsed, 'response')) updates.response = String(parsed.response || '').trim() || null;
                if (Object.prototype.hasOwnProperty.call(parsed, 'image')) updates.image = String(parsed.image || '').trim() || null;
                if (typeof parsed.enabled === 'boolean') updates.enabled = parsed.enabled;

                if (!guildId || !phrase || Object.keys(updates).length === 0 || (!updates.response && !updates.image && Object.keys(updates).every(key => ['response', 'image'].includes(key)))) {
                    sendJson(res, 400, { error: 'Provide a phrase and at least one response or image value.' });
                    return;
                }

                const result = triggerStore.updateTrigger(phrase, updates, guildId);

                if (!result.ok) {
                    sendJson(res, 404, { error: 'Trigger not found.' });
                    return;
                }

                triggerStore.appendAuditEntry({ action: 'edit', trigger: result.trigger.trigger, byId: 'panel', byTag: 'Admin Panel', at: formatTimestamp(), changes: updates }, guildId);
                recordActivity('trigger-edit', `Trigger "${result.trigger.trigger}" updated`, { guildId });
                sendJson(res, 200, { ok: true, trigger: result.trigger });
                return;
            }

            if (req.method === 'DELETE' && requestUrl.pathname === '/api/triggers') {
                const guildId = requestUrl.searchParams.get('guildId');
                const phrase = requestUrl.searchParams.get('phrase');

                if (!guildId || !phrase) {
                    sendJson(res, 400, { error: 'guildId and phrase are required.' });
                    return;
                }

                const result = triggerStore.removeTrigger(phrase, guildId);

                if (!result.ok) {
                    sendJson(res, 404, { error: 'Trigger not found.' });
                    return;
                }

                triggerStore.appendAuditEntry({ action: 'remove', trigger: result.trigger.trigger, byId: 'panel', byTag: 'Admin Panel', at: formatTimestamp() }, guildId);
                recordActivity('trigger-remove', `Trigger "${result.trigger.trigger}" removed`, { guildId });
                sendJson(res, 200, { ok: true });
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
                const recentHistory = voiceStore.getRecentVoiceHistory(guildId, 25)
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

            if (req.method === 'GET' && requestUrl.pathname === '/api/voice-analytics') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                const analytics = voiceStore.getVoiceAnalytics(guildId, requestUrl.searchParams.get('from'), requestUrl.searchParams.get('to'), requestUrl.searchParams.get('channelId'));
                const ids = [...analytics.userTotals.map(row => row.userId), ...analytics.groupSessions.flatMap(row => row.userIds)];
                const labels = await resolveUserLabels(ids, guildId);
                analytics.userTotals = analytics.userTotals.map(row => ({ ...row, label: labels[row.userId]?.tag || row.userId, nickname: labels[row.userId]?.nickname || null }));
                analytics.groupSessions = analytics.groupSessions.map(row => ({ ...row, labels: row.userIds.map(id => labels[id]?.tag || id) }));
                sendJson(res, 200, analytics);
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

            if (req.method === 'GET' && requestUrl.pathname === '/api/soundboard') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const guild = client.guilds.cache.get(guildId); if (!guild) { sendJson(res, 404, { error: 'Guild is not available.' }); return; }
                const sounds = await guild.soundboardSounds.fetch();
                const summary = analyticsStore.getSoundboardSummary(guildId, requestUrl.searchParams.get('days'));
                const useCounts = new Map(summary.topSounds.map(row => [String(row.soundId), row.count]));
                sendJson(res, 200, { sounds: [...sounds.values()].map(sound => ({ id: String(sound.soundId), name: sound.name, volume: sound.volume, emoji: sound.emoji?.name || null, available: sound.available, uses: useCounts.get(String(sound.soundId)) || 0 })).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)), summary });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/analytics') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                const days = Math.min(90, Math.max(1, Number(requestUrl.searchParams.get('days')) || 30));
                sendJson(res, 200, analyticsStore.getAnalyticsSummary(guildId, days, requestUrl.searchParams.get('channelId'), requestUrl.searchParams.get('userId')));
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

            if (req.method === 'GET' && requestUrl.pathname === '/api/profile') {
                const userId = requestUrl.searchParams.get('userId');

                if (!userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                const labels = await resolveUserLabels([userId], requestUrl.searchParams.get('guildId'));
                const discordUser = await client.users.fetch(userId).catch(() => null);
                const memory = userConversationStore.getUserMemory(userId);
                const guildId = requestUrl.searchParams.get('guildId');
                const messageStats = guildId ? serverStatsStore.getUserMessageStats(guildId, userId).count : 0;
                const voice = guildId ? voiceStore.getUserVoiceStats(guildId, userId) : null;

                sendJson(res, 200, {
                    user: {
                        id: userId,
                        tag: labels[userId]?.tag || userId,
                        nickname: labels[userId]?.nickname || null,
                        avatarUrl: discordUser?.displayAvatarURL({ size: 256 }) || null,
                        bannerUrl: discordUser?.bannerURL({ size: 1024, extension: 'png' }) || null
                    },
                    profile: profileStore.getProfile(userId),
                    statistics: { messages: messageStats, voiceMs: voice?.totalMs || 0, shots: guildId ? shotStore.getShots(userId, guildId).total : 0, role: guildId ? accessStore.getUserRole(userId, guildId) : 'user' },
                    aiMemory: {
                        summary: memory.summary || '',
                        profile: memory.profile || '',
                        updatedAt: memory.updatedAt || null
                    }
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/profile') {
                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                if (!parsed.userId) {
                    sendJson(res, 400, { error: 'userId is required.' });
                    return;
                }

                const editableFields = [
                    'nickname', 'bio', 'pronouns', 'birthday', 'timezone',
                    'languages', 'website', 'bannerUrl', 'color', 'socials'
                ];
                const updates = Object.fromEntries(
                    editableFields
                        .filter(field => Object.prototype.hasOwnProperty.call(parsed, field))
                        .map(field => [field, parsed[field]])
                );
                const profile = profileStore.updateProfile(parsed.userId, parsed.guildId || null, updates);

                sendJson(res, 200, { ok: true, profile });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/serper-usage') {
                sendJson(res, 200, serperUsageStore.readSerperUsage());
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/logs') {
                sendJson(res, 200, { logs: readRecentLogs(requestUrl.searchParams.get('level'), requestUrl.searchParams.get('limit')) });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/activity') {
                const guildId = requestUrl.searchParams.get('guildId');
                sendJson(res, 200, { entries: readActivity().filter(row => !guildId || !row.guildId || row.guildId === guildId).slice(0, 100) });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/bot-profile') {
                const guildId = requestUrl.searchParams.get('guildId');
                const application = await discordBotApi('/applications/@me');
                let guildProfile = null;

                if (guildId) {
                    // GET Guild Member requires the concrete bot user ID. Discord only accepts
                    // @me for the separate "Modify Current Member" route used when saving.
                    guildProfile = await discordBotApi(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(client.user.id)}`);
                }

                sendJson(res, 200, {
                    application: {
                        id: application.id,
                        name: application.name,
                        description: application.description || '',
                        tags: application.tags || [],
                        iconUrl: application.icon ? `https://cdn.discordapp.com/app-icons/${application.id}/${application.icon}.png?size=256` : null,
                        coverImageUrl: application.cover_image ? `https://cdn.discordapp.com/app-icons/${application.id}/${application.cover_image}.png?size=1024` : null
                    },
                    guildProfile: guildProfile ? {
                        nick: guildProfile.nick || '',
                        bio: guildProfile.bio || '',
                        avatarUrl: guildProfile.avatar && (guildProfile.user?.id || client.user?.id) ? `https://cdn.discordapp.com/guilds/${guildId}/users/${guildProfile.user?.id || client.user?.id}/avatars/${guildProfile.avatar}.png?size=256` : null,
                        bannerUrl: guildProfile.banner && (guildProfile.user?.id || client.user?.id) ? `https://cdn.discordapp.com/guilds/${guildId}/users/${guildProfile.user?.id || client.user?.id}/banners/${guildProfile.banner}.png?size=1024` : null
                    } : null
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/bot-profile/application') {
                const parsed = JSON.parse(await readBody(req, 8 * 1024 * 1024) || '{}');
                const payload = {};
                if (Object.prototype.hasOwnProperty.call(parsed, 'description')) payload.description = String(parsed.description || '').trim().slice(0, 400);
                if (Object.prototype.hasOwnProperty.call(parsed, 'tags')) payload.tags = normalizeTags(parsed.tags);
                const icon = optionalImageData(parsed.icon, 'App icon');
                const coverImage = optionalImageData(parsed.coverImage, 'Cover image');
                if (icon !== undefined) payload.icon = icon;
                if (coverImage !== undefined) payload.cover_image = coverImage;
                const application = await discordBotApi('/applications/@me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                recordActivity('bot-profile', 'Updated global Discord application profile');
                sendJson(res, 200, { ok: true, application });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/bot-profile/guild') {
                const parsed = JSON.parse(await readBody(req, 8 * 1024 * 1024) || '{}');
                const guildId = String(parsed.guildId || '').trim();
                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }
                const payload = {};
                if (Object.prototype.hasOwnProperty.call(parsed, 'nick')) payload.nick = String(parsed.nick || '').trim().slice(0, 32) || null;
                if (Object.prototype.hasOwnProperty.call(parsed, 'bio')) payload.bio = String(parsed.bio || '').trim().slice(0, 190) || null;
                const avatar = optionalImageData(parsed.avatar, 'Guild avatar');
                const banner = optionalImageData(parsed.banner, 'Guild banner');
                if (avatar !== undefined) payload.avatar = avatar;
                if (banner !== undefined) payload.banner = banner;
                const member = await discordBotApi(`/guilds/${encodeURIComponent(guildId)}/members/@me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                recordActivity('bot-profile', `Updated Flummi's profile in guild ${guildId}`, { guildId });
                sendJson(res, 200, { ok: true, member });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
                const parsed = JSON.parse(await readBody(req) || '{}');
                const allowed = ['ai', 'features', 'presence', 'commandPermissions', 'panel', 'analytics'];
                const updates = Object.fromEntries(allowed.filter(key => parsed[key] && typeof parsed[key] === 'object').map(key => [key, { ...(config[key] || {}), ...parsed[key] }]));
                if (typeof parsed.deployCommandsOnStart === 'boolean') {
                    updates.deployCommandsOnStart = parsed.deployCommandsOnStart;
                }
                if (parsed.ai?.imageSearch) updates.ai = { ...(updates.ai || config.ai), imageSearch: { ...(config.ai?.imageSearch || {}), ...parsed.ai.imageSearch } };
                Object.assign(config, updates);
                saveConfig(config);
                recordActivity('config', 'Global configuration updated from the panel');
                sendJson(res, 200, { ok: true, config: { ai: config.ai, features: config.features, presence: config.presence, commandPermissions: config.commandPermissions, panel: config.panel, analytics: config.analytics, deployCommandsOnStart: config.deployCommandsOnStart } });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/data-tools') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                sendJson(res, 200, { guildFiles: fileDetails(path.join(dataDir, 'guilds', guildId)), globalFiles: fileDetails(path.join(dataDir, 'global', 'users')) });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/backup') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const folder = path.join(dataDir, 'guilds', guildId);
                const backup = Object.fromEntries(fileDetails(folder).map(({ name }) => [name, JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))]));
                res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="guild-${guildId}-backup.json"` }); res.end(JSON.stringify(backup, null, 2)); return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/data-tools/reset') {
                const parsed = JSON.parse(await readBody(req) || '{}'); const guildId = requestUrl.searchParams.get('guildId');
                if (!guildId || !parsed.userId || !['memory', 'profile', 'voice', 'shots', 'permissions'].includes(parsed.store) || parsed.confirmation !== 'RESET') { sendJson(res, 400, { error: 'guildId, userId, valid store, and confirmation RESET are required.' }); return; }
                const userId = String(parsed.userId);
                if (parsed.store === 'memory') userConversationStore.clearUserHistory(userId);
                if (parsed.store === 'profile') profileStore.updateProfile(userId, guildId, { nickname: null, bio: null, pronouns: null, birthday: null, timezone: null, languages: [], website: null, bannerUrl: null, socials: {} });
                if (parsed.store === 'voice') { const stats = voiceStore.readVoiceStats(guildId); delete stats.users[userId]; delete stats.activeSessions[userId]; voiceStore.saveVoiceStats(stats, guildId); }
                if (parsed.store === 'shots') shotStore.setShots(userId, 0, guildId, 'panel', { action: 'reset' });
                if (parsed.store === 'permissions') accessStore.resetUserPermissions(userId, guildId);
                recordActivity('data-reset', `Reset ${parsed.store} for ${userId}`, { guildId, userId }); sendJson(res, 200, { ok: true }); return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/reliability') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const storage = folderStats(path.join(dataDir, 'guilds', guildId));
                const ageDays = storage.oldestAt ? Math.max(1, (Date.now() - new Date(storage.oldestAt).getTime()) / 86400000) : 1;
                const health = Object.fromEntries(fs.readdirSync(path.join(__dirname, 'events')).filter(name => name.endsWith('.js')).map(name => [name.replace('.js', ''), 'Loaded']));
                const panelGatewayMs = Number.isFinite(client.ws.ping) ? Math.max(0, Math.round(client.ws.ping)) : null;
                const permissionAudit = await auditGuildChannelPermissions(guildId).catch(() => []);
                sendJson(res, 200, {
                    storage: { ...storage, forecast30DaysBytes: Math.round(storage.bytes / ageDays * 30) },
                    lastBackup: latestBackup(guildId),
                    handlerHealth: health,
                    ping: { ...pingMetricsStore.getPingMetrics(), panelGatewayMs },
                    retention: retentionSummary(guildId),
                    permissionAudit
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/ai-health') {
                const ai = getAiConfig();
                sendJson(res, 200, { ...aiHealthStore.getAiHealth(), currentModel: ai.model, fastModel: ai.fastModel });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/reliability/backup') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const source = path.join(dataDir, 'guilds', guildId); const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.snapshot`; const destination = path.join(backupRoot(guildId), name);
                fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.cpSync(source, destination, { recursive: true });
                recordActivity('backup', `Created guild backup ${name}`, { guildId }); sendJson(res, 200, { ok: true, backup: name }); return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/reliability/reconcile-voice') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const guild = client.guilds.cache.get(guildId); if (!guild) { sendJson(res, 404, { error: 'Guild is not available to the panel client.' }); return; }
                readyEvent.reconcileVoiceSessions(guild); recordActivity('voice-reconcile', 'Manual voice session reconciliation completed', { guildId }); sendJson(res, 200, { ok: true }); return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/health') {
                const ai = getAiConfig();
                sendJson(res, 200, {
                    discord: client.isReady() ? 'Connected' : 'Connecting',
                    panel: 'Running',
                    openRouter: ai.apiKey ? 'Configured' : 'Missing API key',
                    textModels: buildTextModelCandidates(ai, '', []).length,
                    visionModels: buildVisionModelCandidates(ai).length,
                    imageSearch: config.features?.aiImageSearchEnabled !== false && config.ai?.imageSearch?.enabled !== false ? 'Enabled' : 'Disabled'
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/runtime') {
                sendJson(res, 200, { instances: readRuntimeInstances() });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/update-status') {
                let status = {};
                try { status = JSON.parse(fs.readFileSync(updateStatusFilePath, 'utf8')); } catch { /* updater has not run yet */ }
                sendJson(res, 200, status);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/config') {
                sendJson(res, 200, {
                    developerUserIds: accessStore.getDeveloperUserIds(),
                    commandPermissions: config.commandPermissions || {},
                    ai: config.ai || {},
                    features: config.features || {},
                    presence: config.presence || {},
                    panel: config.panel || {},
                    analytics: config.analytics || {},
                    deployCommandsOnStart: config.deployCommandsOnStart !== false
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
