const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { exec, execFile, spawn } = require('child_process');
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField, GuildVerificationLevel } = require('discord.js');
const { installTimestampedConsole, readRecentLogs } = require('./utils/logger');
const { readActivity, recordActivity } = require('./stores/activity-store');
const { loadEnv } = require('./utils/env-loader');
const { readConfig, saveConfig: saveLocalConfig } = require('./utils/config');
const { applyConfiguredPresence } = require('./utils/presence');
const { buildFieldChanges } = require('./utils/audit-details');
const { RepositoryFileError, RepositoryFileManager, isSensitivePath } = require('./services/repository-file-manager');
const { buildReleaseStatus } = require('./services/release-status');
const config = readConfig();
config.commandPermissions = { ...(config.commandPermissions || {}), dashboard: 'member' };
const settingsStore = require('./stores/settings-store');
const accessStore = require('./stores/access-store');
config.commandPermissions = Object.fromEntries(Object.entries(config.commandPermissions).map(([commandPath, role]) => [commandPath, accessStore.normalizeRole(role)]));
delete config.commandPermissions['manage.role'];
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
const feedbackStore = require('./stores/feedback-store');
const { getAiConfig, buildTextModelCandidates, buildVisionModelCandidates } = require('./services/ai-chat');
const readyEvent = require('./events/ready');
const moderationStore = require('./stores/moderation-store');
const { executeModerationAction, parseDuration } = require('./services/moderation-service');
const { publishRoleMenu } = require('./services/role-service');

installTimestampedConsole();
loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

// Keep the default reachable through the LAN/Tailscale. Set PANEL_HOST=127.0.0.1
// for tunnel-only deployments.
const host = process.env.PANEL_HOST || '0.0.0.0';
const port = Number(process.env.PANEL_PORT) || 3789;
const openBrowserOnStart = config.panel?.openBrowserOnStart === true;
const indexPath = path.join(__dirname, 'panel', 'index.html');
const panelScriptPath = path.join(__dirname, 'panel', 'app.js');
const panelStylesPath = path.join(__dirname, 'panel', 'styles.css');
const faviconPath = path.join(__dirname, 'panel', 'favicon.png');
const commandsDir = path.join(__dirname, 'commands');
const brandingDir = path.join(__dirname, 'assets', 'branding');
const lottiePlayerPath = path.join(__dirname, 'node_modules', 'lottie-web', 'build', 'player', 'lottie.min.js');
const runtimeFilePath = path.join(__dirname, 'data', 'runtime', 'runtime.json');
const updateStatusFilePath = path.join(__dirname, 'data', 'runtime', 'update-status.json');
const dataDir = path.join(__dirname, 'data');
const repositoryFileManager = new RepositoryFileManager({
    rootDir: __dirname,
    stateDir: path.join(dataDir, 'runtime', 'file-manager')
});
const panelSessionsFilePath = path.join(__dirname, 'data', 'runtime', 'panel-sessions.json');
const panelSessions = new Map();
const oauthStates = new Map();
const sessionDurationMs = 14 * 24 * 60 * 60 * 1000;
const settingAuditLabels = {
    botEnabled: 'Bot enabled',
    triggersEnabled: 'Triggers enabled',
    triggerActionCooldownEnabled: 'Trigger cooldown enabled',
    triggerActionCooldownSeconds: 'Trigger cooldown seconds',
    exactTriggerMatch: 'Exact trigger matching',
    maxTriggerLength: 'Maximum trigger length',
    maxTriggers: 'Maximum triggers',
    'features.aiConversationsEnabled': 'AI conversations',
    'features.aiAttachmentsEnabled': 'AI attachments',
    'features.aiImageSearchEnabled': 'AI image search',
    'features.pingResponsesEnabled': 'Ping responses',
    'features.pingRequestSaveEnabled': 'Save ping requests',
    'features.shotsEnabled': 'Shots',
    'management.modules.moderation': 'Moderation module',
    'management.modules.automod': 'AutoMod & Safety module',
    'management.modules.cases': 'Cases & Logs module',
    'management.modules.roles': 'Roles & Onboarding module',
    'management.modules.automation': 'Automation module',
    'management.modules.tickets': 'Tickets module',
    'management.modules.suggestions': 'Suggestions module',
    'management.modules.joinSecurity': 'Join Security module',
    'management.modules.starboard': 'Starboard module',
    'management.modules.forms': 'Forms & Appeals module',
    'management.modules.channels': 'Channel Management module',
    'management.modules.integrations': 'Discord Integrations module',
    'management.moderation.requireReason': 'Require moderation reasons',
    'management.moderation.notifyMember': 'Notify moderated members',
    'management.moderation.defaultTimeoutMinutes': 'Default timeout duration',
    'management.automod.preset': 'AutoMod preset',
    'management.automod.mode': 'AutoMod mode',
    'management.automod.escalationEnabled': 'AutoMod escalation',
    'management.automod.logChannelId': 'AutoMod log channel',
    'management.automod.action': 'AutoMod action',
    'management.automod.timeoutMinutes': 'AutoMod timeout duration',
    'management.automod.blockedTerms': 'AutoMod blocked terms',
    'management.automod.allowedDomains': 'AutoMod allowed domains',
    'management.automod.allowedInviteCodes': 'AutoMod allowed invite codes',
    'management.automod.ignoredChannelIds': 'AutoMod ignored channels',
    'management.automod.ignoredRoleIds': 'AutoMod ignored roles',
    'management.cases.logChannelId': 'Case log channel',
    'management.cases.retentionDays': 'Case retention',
    'management.cases.logMessageChanges': 'Log message changes',
    'management.cases.logMemberChanges': 'Log member changes',
    'management.roles.autoroleId': 'Autorole',
    'management.roles.autoroleDelayMinutes': 'Autorole delay',
    'management.roles.persistRoles': 'Persist member roles',
    'management.roles.interactiveRoles': 'Interactive roles',
    'management.roles.selfAssignableRoleIds': 'Self-assignable roles',
    'management.roles.onboardingChannelId': 'Role-menu channel',
    'management.automation.welcomeEnabled': 'Welcome automation',
    'management.automation.goodbyeEnabled': 'Goodbye automation',
    'management.automation.welcomeChannelId': 'Welcome channel',
    'management.automation.goodbyeChannelId': 'Goodbye channel',
    'management.automation.scheduledMessagesEnabled': 'Scheduled messages',
    'management.automation.autoPurgeEnabled': 'Automatic purge',
    'management.tickets.categoryId': 'Ticket category',
    'management.tickets.supportRoleId': 'Ticket support role',
    'management.tickets.logChannelId': 'Ticket log channel',
    'management.tickets.maxOpenPerMember': 'Open-ticket limit',
    'management.suggestions.channelId': 'Suggestions channel',
    'management.suggestions.reviewChannelId': 'Suggestion review channel',
    'management.suggestions.anonymous': 'Anonymous suggestions',
    'management.joinSecurity.minimumAccountAgeDays': 'Minimum account age',
    'management.joinSecurity.joinBurstLimit': 'Join burst threshold',
    'management.joinSecurity.action': 'Join Security action',
    'management.starboard.channelId': 'Starboard channel',
    'management.starboard.emoji': 'Starboard emoji',
    'management.starboard.threshold': 'Starboard threshold',
    'management.forms.reviewChannelId': 'Form review channel',
    'management.forms.appealsEnabled': 'Moderation appeals',
    'management.channels.defaultSlowmodeSeconds': 'Default slowmode',
    'management.channels.stickyChannelId': 'Sticky notice channel',
    'management.channels.temporaryVoiceCategoryId': 'Temporary voice category',
    'management.integrations.nativeAutomodEnabled': 'Native Discord AutoMod sync',
    'management.integrations.scheduledEventsEnabled': 'Discord Scheduled Events'
};

function buildPublicCommandCatalog() {
    const rows = [];

    for (const file of fs.readdirSync(commandsDir).filter(name => name.endsWith('.js')).sort()) {
        const command = require(path.join(commandsDir, file));
        const payload = command.data.toJSON();
        const topLevelOptions = payload.options || [];
        const containers = topLevelOptions.filter(option => option.type === 1 || option.type === 2);

        if (!containers.length) {
            rows.push({
                path: `/${payload.name}`,
                description: payload.description,
                role: command.public ? 'member' : accessStore.getRequiredCommandRole(payload.name, null, command),
                restricted: Array.isArray(command.allowedGuildIds)
            });
            continue;
        }

        for (const option of containers) {
            const subcommands = option.type === 2 ? (option.options || []).filter(child => child.type === 1) : [option];
            for (const subcommand of subcommands) {
                const groupName = option.type === 2 ? option.name : null;
                rows.push({
                    path: `/${payload.name} ${groupName ? `${groupName} ` : ''}${subcommand.name}`,
                    description: subcommand.description,
                    role: command.public ? 'member' : accessStore.getRequiredCommandRole(payload.name, subcommand.name, command, groupName),
                    restricted: Array.isArray(command.allowedGuildIds)
                });
            }
        }
    }

    const roleRank = { member: 0, admin: 1, developer: 2 };
    return rows.sort((left, right) => (roleRank[left.role] ?? 9) - (roleRank[right.role] ?? 9) || left.path.localeCompare(right.path));
}

function buildPublicStatus() {
    const globalFeatures = config.features || {};
    const featureStatus = key => globalFeatures[key] === false ? 'maintenance' : 'operational';
    return {
        checkedAt: new Date().toISOString(),
        services: [
            { name: 'Discord connection', status: client.isReady() ? 'operational' : 'degraded', detail: client.isReady() ? 'Connected' : 'Connecting' },
            { name: 'Dashboard', status: 'operational', detail: 'Online' },
            { name: 'Triggers', status: featureStatus('triggersEnabled'), detail: globalFeatures.triggersEnabled === false ? 'Temporarily turned off' : 'Available' },
            { name: 'AI conversations', status: featureStatus('aiConversationsEnabled'), detail: globalFeatures.aiConversationsEnabled === false ? 'Temporarily turned off' : 'Available' },
            { name: 'Image search', status: featureStatus('aiImageSearchEnabled'), detail: globalFeatures.aiImageSearchEnabled === false ? 'Temporarily turned off' : 'Available' },
            { name: 'Shots', status: featureStatus('shotsEnabled'), detail: globalFeatures.shotsEnabled === false ? 'Temporarily turned off' : 'Available' }
        ]
    };
}
for (const [key, label] of Object.entries({ badWords: 'Bad words', serverInvites: 'Discord invites', externalLinks: 'External links', messageSpam: 'Fast message spam', duplicateSpam: 'Repeated messages', mentionSpam: 'Mention spam', capsSpam: 'Excessive capitals', emojiSpam: 'Emoji spam', zalgoSpam: 'Zalgo text' })) {
    settingAuditLabels[`management.automod.rules.${key}.enabled`] = `${label} enabled`;
    settingAuditLabels[`management.automod.rules.${key}.action`] = `${label} action`;
    settingAuditLabels[`management.automod.rules.${key}.limit`] = `${label} limit`;
    settingAuditLabels[`management.automod.rules.${key}.windowSeconds`] = `${label} window`;
    settingAuditLabels[`management.automod.rules.${key}.ignoredChannelIds`] = `${label} ignored channels`;
    settingAuditLabels[`management.automod.rules.${key}.ignoredRoleIds`] = `${label} ignored roles`;
}

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

function isCloudflareRequest(req) {
    return Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip']);
}

function isPotentiallyTrustworthyRequest(req) {
    if (isSecureRequest(req)) return true;

    const hostname = String(req.headers.host || '').replace(/^\[|\](?::\d+)?$|:\d+$/g, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function panelPublicUrl(req) {
    const requestUrl = `${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}`;
    let requestHostname = '';
    try { requestHostname = new URL(requestUrl).hostname.replace(/^\[|\]$/g, ''); } catch { /* invalid Host is handled by OAuth */ }
    const configuredPrivateHost = String(process.env.PANEL_HOST || '').trim().replace(/^\[|\]$/g, '');
    const isPrivatePanelHost = requestHostname === configuredPrivateHost
        || ['localhost', '127.0.0.1', '::1'].includes(requestHostname.toLowerCase());

    // Preserve the separately registered Tailscale/localhost OAuth callback.
    if (isPrivatePanelHost) return requestUrl;

    const configured = process.env.PANEL_PUBLIC_URL || config.panel?.publicUrl;
    if (configured) return String(configured).replace(/\/$/, '');
    return requestUrl;
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

function isDeveloperSession(session) {
    return Boolean(session && (session.isDeveloper || accessStore.isConfiguredDeveloper(session.userId)));
}

function getPreviewPanelRole(session) {
    if (!isDeveloperSession(session)) return null;
    if (['admin', 'member'].includes(session.previewPanelRole)) return session.previewPanelRole;
    return session.previewAdminView === true ? 'admin' : null;
}

function hasDeveloperView(session) {
    return isDeveloperSession(session) && !getPreviewPanelRole(session);
}

function getPanelGuildRole(session, guildId) {
    if (hasDeveloperView(session)) return 'developer';
    const previewRole = getPreviewPanelRole(session);
    if (previewRole) return previewRole;
    return Array.isArray(session?.adminGuildIds) && session.adminGuildIds.includes(String(guildId)) ? 'admin' : 'member';
}

function canAccessGuild(session, guildId) {
    if (!session || !guildId) return false;
    if (hasDeveloperView(session)) return true;
    const sharedGuildIds = Array.isArray(session.sharedGuildIds) ? session.sharedGuildIds : session.adminGuildIds;
    return Array.isArray(sharedGuildIds) && sharedGuildIds.includes(String(guildId));
}

async function hasCurrentGuildAccess(session, guildId) {
    if (!canAccessGuild(session, guildId)) return false;
    if (hasDeveloperView(session)) return true;
    try {
        const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
        const member = guild.members.cache.get(String(session.userId)) || await guild.members.fetch(String(session.userId));
        const adminGuildIds = new Set(Array.isArray(session.adminGuildIds) ? session.adminGuildIds.map(String) : []);
        if (member.permissions.has(PermissionsBitField.Flags.Administrator)) adminGuildIds.add(String(guildId));
        else adminGuildIds.delete(String(guildId));
        session.adminGuildIds = Array.from(adminGuildIds);
        return Boolean(member);
    } catch {
        return false;
    }
}

async function requireGuildAccess(session, guildId, res) {
    if (await hasCurrentGuildAccess(session, guildId)) return true;
    const previouslyAllowed = Array.isArray(session?.sharedGuildIds) && session.sharedGuildIds.includes(String(guildId));
    if (!isDeveloperSession(session) && previouslyAllowed) {
        panelSessions.delete(session.key);
        persistPanelSessions();
        sendJson(res, 401, { error: 'Your Discord server access changed. Sign in again to refresh access.' });
        return false;
    }
    sendJson(res, 403, { error: 'You are not a member of this server.' });
    return false;
}

function requireDeveloperAccess(session, res) {
    if (hasDeveloperView(session)) return true;
    sendJson(res, 403, { error: 'This feature is only available to Flummi developers.' });
    return false;
}

async function requireGuildAdminAccess(session, guildId, res, errorMessage) {
    if (hasDeveloperView(session)) return true;
    try {
        const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
        accessStore.setGuildOwner(guild.id, guild.ownerId);
    } catch {
        sendJson(res, 403, { error: 'Could not verify your settings role for this server.' });
        return false;
    }
    const role = getPanelGuildRole(session, guildId);
    if (role === 'admin') return true;
    sendJson(res, 403, { error: errorMessage || 'This feature requires a server administrator.' });
    return false;
}

async function requireSettingsAccess(session, guildId, res) {
    return requireGuildAdminAccess(session, guildId, res, 'Settings can only be changed by a server administrator.');
}

const developerFileReauthMs = 30 * 60 * 1000;

function normalizedRemoteAddress(req) {
    return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isTailscaleAddress(address) {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
    if (!match) return false;
    const first = Number(match[1]);
    const second = Number(match[2]);
    return first === 100 && second >= 64 && second <= 127;
}

function developerFileWriteStatus(req, session) {
    const remoteAddress = normalizedRemoteAddress(req);
    const throughCloudflare = isCloudflareRequest(req);
    const privateConnection = !throughCloudflare && (
        isTailscaleAddress(remoteAddress)
        || ['127.0.0.1', '::1'].includes(remoteAddress)
    );
    const authenticatedAt = Number(session?.authenticatedAt) || 0;
    const recentAuthentication = authenticatedAt > 0 && Date.now() - authenticatedAt <= developerFileReauthMs;
    return { privateConnection, recentAuthentication, canWrite: privateConnection && recentAuthentication };
}

function requireDeveloperFileWriteAccess(req, session, res) {
    const status = developerFileWriteStatus(req, session);
    if (!status.privateConnection) {
        sendJson(res, 403, { code: 'TAILSCALE_REQUIRED', error: 'File changes are only allowed through the direct Tailscale or localhost panel address.' });
        return false;
    }
    if (!status.recentAuthentication) {
        sendJson(res, 401, { code: 'REAUTH_REQUIRED', error: 'Refresh your Discord sign-in before changing repository files.' });
        return false;
    }
    return true;
}

function requireDeveloperSensitiveFileAccess(req, res) {
    if (developerFileWriteStatus(req, null).privateConnection) return true;
    sendJson(res, 403, { code: 'TAILSCALE_REQUIRED', error: 'Runtime data and log files are only available through the direct Tailscale or localhost panel address.' });
    return false;
}

function requirePublicSiteToggleAccess(req, session, res) {
    const status = developerFileWriteStatus(req, session);
    if (!status.privateConnection) {
        sendJson(res, 403, { code: 'TAILSCALE_REQUIRED', error: 'Public site access can only be changed through the direct Tailscale or localhost panel address.' });
        return false;
    }
    if (!status.recentAuthentication) {
        sendJson(res, 401, { code: 'REAUTH_REQUIRED', error: 'Refresh your Discord sign-in before changing public site access.' });
        return false;
    }
    return true;
}

function runRepositoryTests() {
    return new Promise(resolve => {
        execFile(process.execPath, ['--test'], { cwd: __dirname, timeout: 120000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            const output = `${stdout || ''}${stderr || ''}`.slice(-200000);
            resolve({ ok: !error, exitCode: Number.isInteger(error?.code) ? error.code : (error ? 1 : 0), output });
        });
    });
}

function serializeForInlineScript(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizedOrigin(value) {
    try {
        return new URL(String(value)).origin;
    } catch {
        return null;
    }
}

// SameSite cookies are useful defense in depth, but exact Origin checks also
// protect against requests from another subdomain on the same parent domain.
function hasAllowedMutationOrigin(req) {
    if (!stateChangingMethods.has(req.method)) return true;

    const suppliedOrigin = normalizedOrigin(req.headers.origin);
    const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();

    if (!suppliedOrigin) {
        // Preserve non-browser/Tailscale tooling while rejecting browser requests
        // explicitly identified as cross-site.
        return fetchSite !== 'cross-site';
    }

    const requestOrigin = normalizedOrigin(`${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}`);
    const publicOrigin = normalizedOrigin(panelPublicUrl(req));
    return suppliedOrigin === requestOrigin || suppliedOrigin === publicOrigin;
}

function applySecurityHeaders(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

    if (isPotentiallyTrustworthyRequest(req)) {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }

    if (isSecureRequest(req)) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
}

async function canEditMemberPermissions(session, guildId, targetUserId) {
    if (hasDeveloperView(session)) return !accessStore.isConfiguredDeveloper(targetUserId);
    try {
        const guild = await client.guilds.fetch(String(guildId));
        accessStore.setGuildOwner(guild.id, guild.ownerId);
        const targetMember = guild.members.cache.get(String(targetUserId)) || await guild.members.fetch(String(targetUserId));
        return getPanelGuildRole(session, guildId) === 'admin'
            && !accessStore.isConfiguredDeveloper(targetUserId)
            && !targetMember.permissions.has(PermissionsBitField.Flags.Administrator);
    } catch {
        return false;
    }
}

async function getCurrentMemberRole(userId, guildId) {
    if (accessStore.isConfiguredDeveloper(userId)) return 'developer';
    try {
        const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
        const member = guild.members.cache.get(String(userId)) || await guild.members.fetch(String(userId));
        return member.permissions.has(PermissionsBitField.Flags.Administrator) ? 'admin' : 'member';
    } catch {
        return 'member';
    }
}

async function requireMemberPermissionAccess(session, guildId, targetUserId, res) {
    if (await canEditMemberPermissions(session, guildId, targetUserId)) return true;
    sendJson(res, 403, { error: 'Admins can only edit members, not other admins or developers.' });
    return false;
}

function auditPanelAction(session, type, message, details = {}) {
    recordActivity(type, message, {
        ...details,
        actorId: session?.userId || 'unknown',
        actorName: session?.username || 'Unknown panel user',
        source: 'panel'
    });
}

function loginPage(message = '') {
    const safeMessage = String(message).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Flummi Panel</title><style>body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:20px;background:#0b1020;color:#edf2ff;font:16px Segoe UI,sans-serif;box-sizing:border-box}.card{width:min(420px,100%);padding:32px;border:1px solid #243157;border-radius:16px;background:#111a33;box-shadow:0 16px 50px #0006;box-sizing:border-box}h1{margin:0 0 8px}.sub{color:#a5b1d8;line-height:1.5}a{display:block;margin-top:24px;padding:12px 16px;border-radius:9px;background:#5865f2;color:white;text-align:center;text-decoration:none;font-weight:700}.error{margin-top:14px;color:#ffbf5b}</style><main class="card"><h1>Flummi Dashboard</h1><p class="sub">Sign in with Discord to view every server you share with Flummi. Server administrators automatically receive admin controls.</p>${safeMessage ? `<p class="error">${safeMessage}</p>` : ''}<a href="/auth/login">Continue with Discord</a></main></html>`;
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
        applyConfiguredPresence(client);
    } catch (error) {
        if (membersIntentEnabled && /disallowed intents/i.test(error.message)) {
            console.warn('Server Members Intent is not enabled for this bot in the Discord Developer Portal. Starting without it - the Server Members list will be unavailable until it is enabled.');
            membersIntentEnabled = false;
            client = createClient(membersIntentEnabled);
            await client.login(botToken);
            applyConfiguredPresence(client);
            return;
        }

        throw error;
    }
}

let servers = [];

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

function sendHtml(res, html, statusCode = 200, headers = {}) {
    res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
}

function sendAsset(res, filePath, cacheControl = 'public, max-age=3600') {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === '.jpeg' || extension === '.jpg'
        ? 'image/jpeg'
        : extension === '.png'
            ? 'image/png'
            : extension === '.css'
                ? 'text/css; charset=utf-8'
                : extension === '.js'
                    ? 'text/javascript; charset=utf-8'
                    : 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl });
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

async function listGuilds(session) {
    await client.guilds.fetch();

    const guilds = Array.from(client.guilds.cache.values());
    for (const guild of guilds) accessStore.setGuildOwner(guild.id, guild.ownerId);
    const permitted = hasDeveloperView(session)
        ? guilds
        : (await Promise.all(guilds.map(async guild => ({ guild, allowed: await hasCurrentGuildAccess(session, guild.id) }))))
            .filter(result => result.allowed)
            .map(result => result.guild);

    const developerView = hasDeveloperView(session);
    const rows = await Promise.all(permitted.map(async guild => {
        let displayRole = getPanelGuildRole(session, guild.id);
        if (developerView) {
            try {
                const member = guild.members.cache.get(String(session.userId)) || await guild.members.fetch(String(session.userId));
                displayRole = member.permissions.has(PermissionsBitField.Flags.Administrator) ? 'admin' : 'member';
            } catch {
                displayRole = 'not a member';
            }
        }
        return {
            id: guild.id,
            name: guild.name,
            role: getPanelGuildRole(session, guild.id),
            displayRole,
            isAdmin: displayRole === 'admin',
            iconUrl: guild.iconURL({ size: 128, extension: 'png' }) || null
        };
    }));
    const relationshipRank = { admin: 0, member: 1, 'not a member': 2 };
    return rows.sort((a, b) => (relationshipRank[a.displayRole] ?? 9) - (relationshipRank[b.displayRole] ?? 9) || a.name.localeCompare(b.name));
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
    accessStore.setGuildOwner(guild.id, guild.ownerId);

    let fetched;

    try {
        fetched = await guild.members.fetch();
    } catch (error) {
        if (cached) {
            return cached.members;
        }

        throw error;
    }

    const fetchedMembers = Array.from(fetched.values());
    const botCount = fetchedMembers.filter(member => member.user.bot).length;
    const members = fetchedMembers
        .filter(member => !member.user.bot)
        .map(member => ({
            id: member.id,
            tag: member.user.tag,
            username: member.user.username,
            globalName: member.user.globalName || null,
            displayName: member.displayName || member.nickname || member.user.globalName || member.user.username,
            nickname: member.nickname || null,
            avatarUrl: member.displayAvatarURL({ size: 128 }),
            bannerUrl: typeof member.bannerURL === 'function' ? member.bannerURL({ size: 1024 }) : null,
            isAdministrator: member.permissions.has(PermissionsBitField.Flags.Administrator)
        }))
        .sort((a, b) => a.tag.localeCompare(b.tag));

    memberCache.set(guildId, { members, botCount, fetchedAt: Date.now() });
    return members;
}

function publicSiteUnavailablePage() {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Flummi is temporarily unavailable</title><style>:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;color:#f6f4ff;background:radial-gradient(circle at 20% 0%,#342d5e 0,transparent 42%),radial-gradient(circle at 100% 100%,#173c52 0,transparent 38%),#0d0c16}main{width:min(100%,560px);padding:38px;border:1px solid #ffffff1f;border-radius:24px;background:#181627db;box-shadow:0 24px 80px #00000059}.brand{font-size:20px;font-weight:750}.status{display:inline-flex;align-items:center;gap:8px;margin-top:28px;padding:7px 11px;border-radius:999px;color:#ffd8a8;background:#ffa94d1a;border:1px solid #ffa94d33;font-size:13px;font-weight:700}.dot{width:8px;height:8px;border-radius:50%;background:#ffa94d;box-shadow:0 0 0 5px #ffa94d1f}h1{margin:20px 0 12px;font-size:clamp(30px,6vw,44px);line-height:1.08;letter-spacing:-.035em}p{margin:0;color:#b9b5ca;font-size:16px;line-height:1.65}button{margin-top:28px;width:100%;padding:13px 18px;border:0;border-radius:12px;color:#171224;background:linear-gradient(135deg,#c9b6ff,#75ddff);font:inherit;font-weight:750;cursor:pointer}</style><main><div class="brand">Flummi</div><span class="status"><span class="dot"></span>Public access paused</span><h1>Temporarily unavailable</h1><p>The public Flummi panel has been temporarily disabled. Please try again later.</p><button type="button" onclick="location.reload()">Try again</button></main></html>`;
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
    accessStore.setGuildOwner(guild.id, guild.ownerId);

    const owner = await guild.fetchOwner().catch(() => null);
    let humanMemberCount = null;
    let botCount = null;

    if (membersIntentEnabled) {
        try {
            const humanMembers = await listGuildMembers(guild.id);
            const cachedMembers = memberCache.get(guild.id);
            humanMemberCount = humanMembers.length;
            botCount = Number.isFinite(cachedMembers?.botCount) ? cachedMembers.botCount : null;
        } catch {
            // Exact human/bot counts require the privileged Server Members intent.
        }
    }

    return {
        id: guild.id,
        name: guild.name,
        description: guild.description || null,
        iconUrl: guild.iconURL({ size: 256, extension: 'png' }) || null,
        bannerUrl: guild.bannerURL({ size: 1024, extension: 'png' }) || null,
        memberCount: humanMemberCount,
        botCount,
        totalMemberCount: guild.memberCount,
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
    const developerIds = accessStore.getDeveloperUserIds();
    const adminCount = membersIntentEnabled
        ? await listGuildMembers(guildId).then(members => members.filter(member => member.isAdministrator).length).catch(() => null)
        : null;
    const activeVoiceCount = voiceSummary.filter(row => row.inVoice).length;
    const totalVoiceMs = Object.values(voiceStats.users)
        .reduce((sum, entry) => sum + (Number(entry.totalMs) || 0), 0);
    const missingPermissions = await getMissingBotPermissions(guildId);
    const guildInfo = await buildGuildInfo(guildId).catch(() => null);
    const labels = await resolveUserLabels([
        ...shotLeaderboard.map(row => row.userId),
        ...voiceSummary.map(row => row.id),
        ...developerIds
    ], guildId);

    return {
        settings,
        globalFeatures: config.features || {},
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
        adminCount,
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

async function listManagementChannels(guildId) {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) return [];
    await guild.channels.fetch();
    const me = guild.members.me || await guild.members.fetchMe();
    return Array.from(guild.channels.cache.values())
        .filter(channel => channel.viewable)
        .filter(channel => channel.type === ChannelType.GuildCategory || (isSendableGuildTextChannel(channel) && channel.permissionsFor(me)?.has('SendMessages')))
        .map(channel => ({ id: channel.id, name: channel.name, kind: channel.type === ChannelType.GuildCategory ? 'category' : 'text' }))
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
            applySecurityHeaders(req, res);

            if (!hasAllowedMutationOrigin(req)) {
                sendJson(res, 403, { error: 'Cross-site request blocked.' });
                return;
            }

            const requestUrl = new URL(req.url, `http://${req.headers.host}`);

            if (config.panel?.publicAccessEnabled === false && isCloudflareRequest(req)) {
                res.setHeader('X-Flummi-Maintenance', 'public-paused');
                res.setHeader('Cache-Control', 'no-store');
                if (requestUrl.pathname.startsWith('/api/')) {
                    sendJson(res, 503, { error: 'The public Flummi panel is temporarily unavailable.' });
                } else {
                    sendHtml(res, publicSiteUnavailablePage(), 503, { 'Retry-After': '300' });
                }
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/auth/login') {
                const clientSecret = process.env.DISCORD_CLIENT_SECRET;
                if (!clientSecret || !config.clientId) {
                    sendHtml(res, loginPage('Discord OAuth is not configured yet. Add the client secret on the server first.'));
                    return;
                }

                cleanupAuthRecords();
                const state = crypto.randomBytes(32).toString('hex');
                const redirectUri = `${panelPublicUrl(req)}/auth/callback`;
                const previousSession = requestUrl.searchParams.get('refresh') === '1' ? sessionFor(req) : null;
                oauthStates.set(state, { redirectUri, previousSessionKey: previousSession?.key || null, expiresAt: Date.now() + 10 * 60 * 1000 });
                const authorize = new URL('https://discord.com/oauth2/authorize');
                authorize.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify guilds', state, ...(previousSession ? { prompt: 'consent' } : {}) }).toString();
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

                    const isDeveloper = accessStore.isConfiguredDeveloper(user.id);
                    const guildResponse = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${token.access_token}` } });
                    const userGuilds = await guildResponse.json();
                    if (!guildResponse.ok || !Array.isArray(userGuilds)) throw new Error('Discord server lookup failed.');
                    const administratorPermission = PermissionsBitField.Flags.Administrator;
                    let adminGuildIds = userGuilds
                        .filter(guild => guild.owner || (BigInt(guild.permissions || '0') & administratorPermission) === administratorPermission)
                        .map(guild => String(guild.id));

                    await client.guilds.fetch();
                    const availableGuildIds = new Set(client.guilds.cache.keys());
                    const sharedGuildIds = userGuilds
                        .map(guild => String(guild.id))
                        .filter(guildId => availableGuildIds.has(guildId));
                    adminGuildIds = adminGuildIds.filter(guildId => availableGuildIds.has(guildId));
                    if (!isDeveloper && sharedGuildIds.length === 0) {
                        sendHtml(res, loginPage('No server shared with Flummi was found.'));
                        return;
                    }

                    const sessionToken = crypto.randomBytes(32).toString('hex');
                    panelSessions.set(sessionKey(sessionToken), { userId: user.id, username: user.global_name || user.username, avatar: user.avatar || null, isDeveloper, sharedGuildIds, adminGuildIds, authenticatedAt: Date.now(), expiresAt: Date.now() + sessionDurationMs });
                    if (record.previousSessionKey) panelSessions.delete(record.previousSessionKey);
                    persistPanelSessions();
                    const secure = record.redirectUri.startsWith('https://') ? '; Secure' : '';
                    // Lax is required for the top-level redirect returning from Discord.
                    // State validation and exact Origin checks protect the OAuth flow and
                    // every state-changing panel request from cross-site submission.
                    res.writeHead(302, { Location: '/', 'Set-Cookie': `flummi_panel_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionDurationMs / 1000)}${secure}` });
                    res.end();
                } catch (error) {
                    console.error('Discord OAuth login failed:', error);
                    sendHtml(res, loginPage('Discord sign-in failed. Check the redirect URL and try again.'));
                }
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/auth/me') {
                const session = sessionFor(req);
                if (!session) {
                    sendJson(res, 200, { authenticated: false });
                    return;
                }
                const avatarUrl = session.avatar ? `https://cdn.discordapp.com/avatars/${session.userId}/${session.avatar}.png?size=64` : `https://cdn.discordapp.com/embed/avatars/${Number(session.userId) % 5}.png`;
                sendJson(res, 200, {
                    authenticated: true,
                    user: { id: session.userId, username: session.username, avatarUrl },
                    role: hasDeveloperView(session) ? 'developer' : (getPreviewPanelRole(session) || 'member'),
                    actualRole: isDeveloperSession(session) ? 'developer' : 'admin',
                    globalFeatures: config.features || {},
                    privateConnection: developerFileWriteStatus(req, session).privateConnection,
                    previewAdminView: Boolean(getPreviewPanelRole(session)),
                    previewPanelRole: getPreviewPanelRole(session),
                    discordRoleSimulation: accessStore.getDeveloperRoleSimulation(session.userId)
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/auth/logout') {
                const session = sessionFor(req);
                if (session) {
                    panelSessions.delete(session.key);
                    persistPanelSessions();
                }
                const secure = isSecureRequest(req) ? '; Secure' : '';
                res.writeHead(204, { 'Set-Cookie': `flummi_panel_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}` });
                res.end();
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/') {
                const html = fs.readFileSync(indexPath, 'utf8');
                const tabOrder = Array.isArray(config.panel?.tabOrder) ? config.panel.tabOrder : [];
                const tabNames = config.panel?.tabNames && typeof config.panel.tabNames === 'object' ? config.panel.tabNames : {};
                const injected = html.replace(
                    '<!--PANEL_CONFIG-->',
                    `<script>window.__PANEL_TAB_ORDER__ = ${serializeForInlineScript(tabOrder)}; window.__PANEL_TAB_NAMES__ = ${serializeForInlineScript(tabNames)};</script>`
                );
                sendHtml(res, injected);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/favicon.png') {
                if (!fs.existsSync(faviconPath)) {
                    sendJson(res, 404, { error: 'Favicon not found.' });
                    return;
                }
                sendAsset(res, faviconPath);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/panel/app.js') {
                sendAsset(res, panelScriptPath, 'no-store');
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/panel/styles.css') {
                sendAsset(res, panelStylesPath, 'no-store');
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/vendor/lottie.min.js') {
                if (!fs.existsSync(lottiePlayerPath)) { sendJson(res, 404, { error: 'Lottie player not found.' }); return; }
                sendAsset(res, lottiePlayerPath);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/public/commands') {
                sendJson(res, 200, { commands: buildPublicCommandCatalog() });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/public/status') {
                sendJson(res, 200, buildPublicStatus());
                return;
            }

            let panelSession = null;
            if (requestUrl.pathname.startsWith('/api/')) {
                panelSession = requirePanelAccess(req, res);
                if (!panelSession) return;

                if (requestUrl.pathname === '/api/experiments' && !isDeveloperSession(panelSession)) {
                    sendJson(res, 403, { error: 'Experiments are only available to configured developers.' });
                    return;
                }

                const developerPaths = new Set([
                    '/api/ai-memory', '/api/profile', '/api/serper-usage', '/api/logs', '/api/activity',
                    '/api/bot-profile', '/api/bot-profile/application', '/api/bot-profile/guild', '/api/config',
                    '/api/data-tools', '/api/backup', '/api/data-tools/reset', '/api/reliability',
                    '/api/ai-health', '/api/reliability/backup', '/api/reliability/reconcile-voice',
                    '/api/health', '/api/runtime', '/api/update-status', '/api/send', '/api/release/promote'
                ]);
                if (developerPaths.has(requestUrl.pathname) && !requireDeveloperAccess(panelSession, res)) return;
                if (requestUrl.pathname.startsWith('/api/developer/files') && !requireDeveloperAccess(panelSession, res)) return;

                const requestedGuildId = requestUrl.searchParams.get('guildId');
                if (requestedGuildId && !await requireGuildAccess(panelSession, requestedGuildId, res)) return;

                if (req.method === 'GET' && requestUrl.pathname === '/api/developer/files/list') {
                    const requestedPath = requestUrl.searchParams.get('path') || '';
                    if (isSensitivePath(requestedPath) && !requireDeveloperSensitiveFileAccess(req, res)) return;
                    const result = repositoryFileManager.list(requestedPath);
                    sendJson(res, 200, { ...result, writeAccess: developerFileWriteStatus(req, panelSession) });
                    return;
                }

                if (req.method === 'GET' && requestUrl.pathname === '/api/developer/files/read') {
                    const requestedPath = requestUrl.searchParams.get('path');
                    if (isSensitivePath(requestedPath) && !requireDeveloperSensitiveFileAccess(req, res)) return;
                    sendJson(res, 200, repositoryFileManager.read(requestedPath));
                    return;
                }

                if (req.method === 'GET' && requestUrl.pathname === '/api/developer/files/search') {
                    if (!requireDeveloperSensitiveFileAccess(req, res)) return;
                    sendJson(res, 200, repositoryFileManager.search(requestUrl.searchParams.get('q')));
                    return;
                }

                if (req.method === 'GET' && requestUrl.pathname === '/api/developer/files/download') {
                    const requestedPath = requestUrl.searchParams.get('path');
                    if (isSensitivePath(requestedPath) && !requireDeveloperSensitiveFileAccess(req, res)) return;
                    const file = repositoryFileManager.download(requestedPath);
                    const filename = path.basename(file.path);
                    res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
                        'Content-Length': file.buffer.length
                    });
                    res.end(file.buffer);
                    return;
                }

                if (req.method === 'POST' && requestUrl.pathname.startsWith('/api/developer/files/')) {
                    if (!requireDeveloperFileWriteAccess(req, panelSession, res)) return;
                    const action = requestUrl.pathname.slice('/api/developer/files/'.length);
                    const parsed = JSON.parse(await readBody(req, action === 'upload' ? 12 * 1024 * 1024 : 2 * 1024 * 1024) || '{}');

                    if (action === 'save') {
                        const result = repositoryFileManager.save(parsed.path, parsed.content, parsed.expectedHash, { force: parsed.force === true });
                        auditPanelAction(panelSession, 'developer-file-save', `Saved ${result.path}`, { path: result.path, forced: parsed.force === true, backup: result.backup });
                        sendJson(res, 200, { ok: true, ...result });
                        return;
                    }
                    if (action === 'create') {
                        const result = repositoryFileManager.create(parsed.path, parsed.type);
                        auditPanelAction(panelSession, 'developer-file-create', `Created ${result.path}`, { path: result.path, fileType: result.type });
                        sendJson(res, 201, { ok: true, ...result });
                        return;
                    }
                    if (action === 'rename') {
                        const result = repositoryFileManager.rename(parsed.path, parsed.destination);
                        auditPanelAction(panelSession, 'developer-file-rename', `Renamed ${result.from} to ${result.path}`, { path: result.path, previousPath: result.from, backup: result.backup });
                        sendJson(res, 200, { ok: true, ...result });
                        return;
                    }
                    if (action === 'trash') {
                        if (parsed.confirmation !== 'TRASH') throw new RepositoryFileError('Trash confirmation is required.', 'CONFIRMATION_REQUIRED');
                        const result = repositoryFileManager.trash(parsed.path);
                        auditPanelAction(panelSession, 'developer-file-trash', `Moved ${result.path} to recoverable trash`, { path: result.path, trashPath: result.trashPath });
                        sendJson(res, 200, { ok: true, ...result });
                        return;
                    }
                    if (action === 'upload') {
                        const result = repositoryFileManager.upload(parsed.path, parsed.base64, parsed.expectedHash, { force: parsed.force === true });
                        auditPanelAction(panelSession, 'developer-file-upload', `Uploaded ${result.path}`, { path: result.path, size: result.size, forced: parsed.force === true, backup: result.backup });
                        sendJson(res, 200, { ok: true, ...result });
                        return;
                    }
                    if (action === 'test') {
                        const result = await runRepositoryTests();
                        auditPanelAction(panelSession, 'developer-file-test', `Repository tests ${result.ok ? 'passed' : 'failed'}`, { exitCode: result.exitCode });
                        sendJson(res, result.ok ? 200 : 422, result);
                        return;
                    }
                    if (action === 'restart') {
                        if (parsed.confirmation !== 'RESTART') throw new RepositoryFileError('Restart confirmation is required.', 'CONFIRMATION_REQUIRED');
                        auditPanelAction(panelSession, 'developer-file-restart', 'Requested Flummi service restart');
                        sendJson(res, 202, { ok: true, message: 'Flummi restart scheduled.' });
                        const helper = path.join(__dirname, 'scripts', 'restart-flummi-service.js');
                        spawn(process.execPath, [helper], { cwd: __dirname, detached: true, stdio: 'ignore' }).unref();
                        return;
                    }

                    sendJson(res, 404, { error: 'Unknown file-manager action.' });
                    return;
                }
                if (requestedGuildId && requestUrl.pathname === '/api/triggers' && req.method !== 'GET'
                    && !await requireGuildAdminAccess(panelSession, requestedGuildId, res, 'Triggers can only be managed by a server administrator.')) return;
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
                const guilds = await listGuilds(panelSession);
                if (!isDeveloperSession(panelSession) && guilds.length === 0) {
                    panelSessions.delete(panelSession.key);
                    persistPanelSessions();
                    sendJson(res, 401, { error: 'Your Discord server access changed. Sign in again to refresh access.' });
                    return;
                }
                sendJson(res, 200, { guilds });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/experiments') {
                sendJson(res, 200, {
                    previewAdminView: Boolean(getPreviewPanelRole(panelSession)),
                    previewPanelRole: getPreviewPanelRole(panelSession) || 'admin',
                    discordRole: accessStore.getDeveloperRoleSimulation(panelSession.userId)?.role || 'developer',
                    expiresAt: accessStore.getDeveloperRoleSimulation(panelSession.userId)?.expiresAt || null
                });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/experiments') {
                const parsed = JSON.parse(await readBody(req) || '{}');
                if (typeof parsed.previewAdminView === 'boolean') {
                    if (parsed.previewAdminView && (!Array.isArray(panelSession.adminGuildIds) || panelSession.adminGuildIds.length === 0)) {
                        sendJson(res, 409, { error: 'Refresh Discord access before enabling admin view so the preview has a current server list.' });
                        return;
                    }
                    const stored = panelSessions.get(panelSession.key);
                    stored.previewAdminView = parsed.previewAdminView;
                    stored.previewPanelRole = parsed.previewAdminView
                        ? (['admin', 'member'].includes(parsed.previewPanelRole) ? parsed.previewPanelRole : 'admin')
                        : null;
                    persistPanelSessions();
                    auditPanelAction(panelSession, 'experiment-admin-view', parsed.previewAdminView
                        ? `Enabled ${stored.previewPanelRole} panel preview`
                        : 'Disabled panel role preview');
                }
                if (parsed.discordRole !== undefined) {
                    const simulation = accessStore.setDeveloperRoleSimulation(panelSession.userId, parsed.discordRole);
                    auditPanelAction(panelSession, 'experiment-discord-role', `Changed Discord role simulation to ${simulation?.role || 'developer'}`);
                }
                sendJson(res, 200, {
                    ok: true,
                    previewAdminView: Boolean(getPreviewPanelRole(panelSessions.get(panelSession.key))),
                    previewPanelRole: getPreviewPanelRole(panelSessions.get(panelSession.key)) || 'admin',
                    discordRole: accessStore.getDeveloperRoleSimulation(panelSession.userId)?.role || 'developer',
                    expiresAt: accessStore.getDeveloperRoleSimulation(panelSession.userId)?.expiresAt || null
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/audit') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireGuildAdminAccess(panelSession, guildId, res, 'The audit log is only available to server administrators.')) return;
                const entries = readActivity()
                    .filter(entry => String(entry.guildId || '') === String(guildId) && entry.source === 'panel')
                    .slice(0, 100);
                sendJson(res, 200, { entries });
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
                    addedByTag: 'Dashboard',
                    addedAt: formatTimestamp()
                }, guildId);

                if (!result.ok) {
                    sendJson(res, 400, { error: result.reason === 'duplicate' ? 'That trigger already exists.' : 'Trigger limit reached.' });
                    return;
                }

                triggerStore.appendAuditEntry({ action: 'add', trigger: phrase, byId: 'panel', byTag: 'Dashboard', at: formatTimestamp() }, guildId);
                auditPanelAction(panelSession, 'trigger-add', `Trigger "${phrase}" added`, { guildId });
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

                triggerStore.appendAuditEntry({ action: 'edit', trigger: result.trigger.trigger, byId: 'panel', byTag: 'Dashboard', at: formatTimestamp(), changes: updates }, guildId);
                auditPanelAction(panelSession, 'trigger-edit', `Trigger "${result.trigger.trigger}" updated`, { guildId });
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

                triggerStore.appendAuditEntry({ action: 'remove', trigger: result.trigger.trigger, byId: 'panel', byTag: 'Dashboard', at: formatTimestamp() }, guildId);
                auditPanelAction(panelSession, 'trigger-remove', `Trigger "${result.trigger.trigger}" removed`, { guildId });
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
                const requestedDays = requestUrl.searchParams.get('days');
                const channelId = requestUrl.searchParams.get('channelId');
                const now = Date.now();
                const rangeDays = requestedDays === null ? undefined : requestedDays.toLowerCase() === 'all' ? null : Math.min(365, Math.max(1, Number(requestedDays) || 30));
                const span = Number.isFinite(rangeDays) ? rangeDays * 86400000 : null;
                const from = requestedDays === null ? requestUrl.searchParams.get('from') : span === null ? null : new Date(now - span).toISOString();
                const to = requestedDays === null ? requestUrl.searchParams.get('to') : new Date(now).toISOString();
                const analytics = voiceStore.getVoiceAnalytics(guildId, from, to, channelId);
                if (requestedDays !== null) {
                    const allTime = rangeDays === null ? analytics : voiceStore.getVoiceAnalytics(guildId, null, null, channelId);
                    const previous = span === null ? null : voiceStore.getVoiceAnalytics(guildId, new Date(now - span * 2).toISOString(), new Date(now - span - 1).toISOString(), channelId);
                    analytics.totalAllTimeMs = allTime.totalMs;
                    analytics.previousTotalMs = previous?.totalMs ?? null;
                }
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

            if (req.method === 'GET' && requestUrl.pathname === '/api/management/channels') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireGuildAdminAccess(panelSession, guildId, res, 'Management channels are only available to server administrators.')) return;
                sendJson(res, 200, { channels: await listManagementChannels(guildId) });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/feedback') {
                const parsed = JSON.parse(await readBody(req) || '{}');
                if (!String(parsed.message || '').trim()) {
                    sendJson(res, 400, { error: 'Feedback cannot be empty.' });
                    return;
                }
                try {
                    const feedback = feedbackStore.addFeedback({ userId: panelSession.userId, username: panelSession.username, message: parsed.message });
                    const rateLimit = feedbackStore.getRateLimit(panelSession.userId);
                    auditPanelAction(panelSession, 'feedback-submit', 'Submitted product feedback', { feedbackId: feedback.id });
                    sendJson(res, 201, {
                        ok: true,
                        feedback,
                        rateLimit: { cooldownSeconds: 60, hourlyLimit: 5, remainingThisHour: rateLimit.remainingThisHour }
                    });
                } catch (error) {
                    if (error?.code !== 'FEEDBACK_RATE_LIMITED') throw error;
                    res.setHeader('Retry-After', String(error.retryAfterSeconds));
                    sendJson(res, 429, {
                        code: error.code,
                        error: error.message,
                        retryAfterSeconds: error.retryAfterSeconds,
                        hourlyLimit: 5
                    });
                }
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/feedback') {
                if (!requireDeveloperAccess(panelSession, res)) return;
                sendJson(res, 200, { feedback: feedbackStore.readFeedback() });
                return;
            }

            if (req.method === 'DELETE' && requestUrl.pathname === '/api/feedback') {
                if (!requireDeveloperAccess(panelSession, res)) return;
                const feedbackId = requestUrl.searchParams.get('id');
                if (!feedbackId) {
                    sendJson(res, 400, { error: 'Feedback id is required.' });
                    return;
                }
                const deleted = feedbackStore.deleteFeedback(feedbackId);
                if (!deleted) {
                    sendJson(res, 404, { error: 'Feedback was already removed or could not be found.' });
                    return;
                }
                auditPanelAction(panelSession, 'feedback-delete', 'Deleted product feedback', {
                    feedbackId: deleted.id,
                    submittedBy: deleted.username,
                    submittedByUserId: deleted.userId
                });
                sendJson(res, 200, { ok: true });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/activity-heatmap') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                const activity = requestUrl.searchParams.get('activity');
                const from = requestUrl.searchParams.get('from');
                const to = requestUrl.searchParams.get('to');
                const channelId = requestUrl.searchParams.get('channelId');

                if (!['messages', 'voice'].includes(activity)) {
                    sendJson(res, 400, { error: 'activity must be messages or voice.' });
                    return;
                }

                const heatmap = activity === 'voice'
                    ? voiceStore.getVoiceActivityHeatmap(guildId, from, to, channelId)
                    : analyticsStore.getMessageActivityHeatmap(guildId, from, to, channelId, requestUrl.searchParams.get('userId'));
                sendJson(res, 200, { heatmap });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/analytics-summary') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;

                const periodDays = Math.min(365, Math.max(1, Number(requestUrl.searchParams.get('days')) || 30));
                const canViewModeration = ['developer', 'admin'].includes(getPanelGuildRole(panelSession, guildId));
                const now = Date.now();
                const messages = analyticsStore.getAnalyticsSummary(guildId, periodDays);
                const voice = voiceStore.getVoiceAnalytics(
                    guildId,
                    new Date(now - periodDays * 86400000).toISOString(),
                    new Date(now).toISOString()
                );
                const sounds = analyticsStore.getSoundboardSummary(guildId, periodDays);
                const media = analyticsStore.getMediaUsageSummary(guildId, periodDays);
                const shotLeaderboard = shotStore.getShotLeaderboard(guildId, 10000);

                sendJson(res, 200, {
                    periodDays,
                    messages: {
                        count: messages.messageCount,
                        uniqueAuthors: messages.uniqueAuthors,
                        changePercent: messages.comparison?.changePercent ?? null,
                        busiestHour: messages.comparison?.busiestHour ?? null,
                        activity: messages.dailyMessages
                    },
                    voice: {
                        totalMs: voice.totalMs,
                        sessions: voice.activeOverTime.reduce((total, row) => total + row.count, 0),
                        activeMembers: voice.userTotals.length,
                        averageSessionMs: voice.averageSessionMs,
                        busiestHour: voice.busiestHour,
                        activity: voice.activeOverTime
                    },
                    media: {
                        soundPlays: sounds.plays,
                        emojiUses: media.emojiUses,
                        stickerUses: media.stickerUses
                    },
                    shots: {
                        total: shotLeaderboard.reduce((total, row) => total + row.total, 0),
                        members: shotLeaderboard.length,
                        highest: shotLeaderboard[0]?.total || 0
                    },
                    events: canViewModeration ? messages.moderation : null
                });
                return;
            }

            if (req.method === 'GET' && ['/api/soundboard', '/api/media'].includes(requestUrl.pathname)) {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const guild = client.guilds.cache.get(guildId); if (!guild) { sendJson(res, 404, { error: 'Guild is not available.' }); return; }
                const [sounds, emojis, stickers] = await Promise.all([
                    guild.soundboardSounds.fetch(),
                    guild.emojis.fetch(),
                    guild.stickers.fetch()
                ]);
                const summary = analyticsStore.getSoundboardSummary(guildId, requestUrl.searchParams.get('days'));
                const mediaUsage = analyticsStore.getMediaUsageSummary(guildId, requestUrl.searchParams.get('days'));
                const soundUsage = new Map(summary.itemDetails.map(row => [String(row.id), row]));
                const emojiUsage = new Map(mediaUsage.emojis.map(row => [String(row.id), row]));
                const stickerUsage = new Map(mediaUsage.stickers.map(row => [String(row.id), row]));
                const trackedUserIds = [
                    ...summary.topUsers.map(row => row.userId),
                    ...mediaUsage.emojis.flatMap(row => row.topMembers.map(member => member.userId)),
                    ...mediaUsage.stickers.flatMap(row => row.topMembers.map(member => member.userId))
                ].filter(Boolean);
                const userLabels = await resolveUserLabels(trackedUserIds, guildId);
                const channelLabels = new Map(guild.channels.cache.map(channel => [String(channel.id), channel.name]));
                const labelMembers = members => members.map(member => ({ ...member, label: userLabels[member.userId]?.tag || member.label || member.userId, nickname: userLabels[member.userId]?.nickname || null }));
                summary.topUsers = summary.topUsers.map(row => ({ ...row, label: userLabels[row.userId]?.tag || row.userId || 'Unknown user', nickname: userLabels[row.userId]?.nickname || null }));
                summary.topChannels = summary.topChannels.map(row => ({ ...row, name: channelLabels.get(String(row.channelId)) || row.channelId || 'Unknown channel' }));
                const tier = Math.max(0, Math.min(3, Number(guild.premiumTier) || 0));
                const emojiCapacity = [50, 100, 150, 250][tier];
                const stickerCapacity = (guild.features || []).includes('MORE_STICKERS') ? 60 : [5, 15, 30, 60][tier];
                sendJson(res, 200, {
                    sounds: [...sounds.values()].map(sound => ({
                        id: String(sound.soundId), name: sound.name, volume: sound.volume, emoji: sound.emoji?.name || null,
                        emojiUrl: sound.emoji?.id ? sound.emoji.url : null, available: sound.available,
                        ...(soundUsage.get(String(sound.soundId)) || { count: 0, previousCount: 0, firstUsed: null, lastUsed: null, averagePerDay: 0, trend: { status: 'flat', percent: 0 } }),
                        uses: soundUsage.get(String(sound.soundId))?.count || 0,
                        url: sound.url, createdAt: sound.createdAt?.toISOString() || null, creator: sound.user?.tag || null
                    })).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)),
                    emojis: [...emojis.values()].map(emoji => ({
                        ...(emojiUsage.get(String(emoji.id)) || { count: 0, previousCount: 0, firstUsed: null, lastUsed: null, averagePerDay: 0, topMembers: [], trend: { status: 'flat', percent: 0 } }),
                        id: String(emoji.id), name: emoji.name, url: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'webp', size: 128 }), animated: emoji.animated,
                        available: emoji.available, managed: emoji.managed, requiresColons: emoji.requiresColons,
                        roleCount: emoji.roles?.cache?.size || 0, createdAt: emoji.createdAt?.toISOString() || null,
                        creator: emoji.author?.tag || null, uses: emojiUsage.get(String(emoji.id))?.count || 0,
                        topMembers: labelMembers(emojiUsage.get(String(emoji.id))?.topMembers || [])
                    })).sort((a, b) => a.name.localeCompare(b.name)),
                    stickers: [...stickers.values()].map(sticker => ({
                        ...(stickerUsage.get(String(sticker.id)) || { count: 0, previousCount: 0, firstUsed: null, lastUsed: null, averagePerDay: 0, topMembers: [], trend: { status: 'flat', percent: 0 } }),
                        id: String(sticker.id), name: sticker.name, description: sticker.description || '', tags: sticker.tags || '',
                        url: sticker.url, previewUrl: sticker.format === 3 ? `https://media.discordapp.net/stickers/${sticker.id}.png?size=320` : sticker.url,
                        lottieUrl: sticker.format === 3 ? sticker.url : null,
                        format: sticker.format, formatName: ({ 1: 'PNG', 2: 'APNG', 3: 'Lottie', 4: 'GIF' })[sticker.format] || 'Unknown',
                        type: sticker.type, available: sticker.available, createdAt: sticker.createdAt?.toISOString() || null,
                        creator: sticker.user?.tag || null, uses: stickerUsage.get(String(sticker.id))?.count || 0,
                        topMembers: labelMembers(stickerUsage.get(String(sticker.id))?.topMembers || [])
                    })).sort((a, b) => a.name.localeCompare(b.name)),
                    summary,
                    mediaUsage: {
                        rangeDays: mediaUsage.rangeDays,
                        totalEmojiUses: mediaUsage.totalEmojiUses, totalStickerUses: mediaUsage.totalStickerUses,
                        emojiUses: mediaUsage.emojiUses, previousEmojiUses: mediaUsage.previousEmojiUses,
                        stickerUses: mediaUsage.stickerUses, previousStickerUses: mediaUsage.previousStickerUses,
                        emojiTrend: mediaUsage.emojiTrend, stickerTrend: mediaUsage.stickerTrend
                    },
                    capacity: {
                        staticEmojis: { used: [...emojis.values()].filter(emoji => !emoji.animated).length, total: emojiCapacity },
                        animatedEmojis: { used: [...emojis.values()].filter(emoji => emoji.animated).length, total: emojiCapacity },
                        stickers: { used: stickers.size, total: stickerCapacity }
                    }
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/analytics') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                const days = requestUrl.searchParams.get('days') || '30';
                const analytics = analyticsStore.getAnalyticsSummary(guildId, days, requestUrl.searchParams.get('channelId'), requestUrl.searchParams.get('userId'));
                if (!['developer', 'admin'].includes(getPanelGuildRole(panelSession, guildId))) analytics.moderation = null;
                sendJson(res, 200, analytics);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/settings') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireSettingsAccess(panelSession, guildId, res)) return;

                sendJson(res, 200, {
                    settings: settingsStore.readSettings(guildId),
                    globalFeatures: config.features || {}
                });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/management/cases') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireGuildAdminAccess(panelSession, guildId, res, 'Cases and event logs are only available to server administrators.')) return;
                const userId = requestUrl.searchParams.get('userId');
                const cases = userId ? moderationStore.getMemberCases(guildId, userId, { limit: 200 }) : moderationStore.readCases(guildId).slice(0, 200);
                sendJson(res, 200, { cases, events: moderationStore.readEvents(guildId, { limit: 200 }) });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/management/action') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireGuildAdminAccess(panelSession, guildId, res, 'Moderation actions are only available to server administrators.')) return;
                const parsed = JSON.parse(await readBody(req) || '{}');
                const allowed = new Set(['warn', 'note', 'timeout', 'untimeout', 'kick', 'ban', 'tempban', 'unban', 'softban', 'purge']);
                if (!allowed.has(parsed.action)) return sendJson(res, 400, { error: 'Unknown moderation action.' });
                const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
                const channel = parsed.channelId ? (guild.channels.cache.get(String(parsed.channelId)) || await guild.channels.fetch(String(parsed.channelId)).catch(() => null)) : null;
                const durationMs = parsed.duration ? parseDuration(parsed.duration) : null;
                if (parsed.duration && durationMs === null) return sendJson(res, 400, { error: 'Invalid duration. Use 30m, 2h or 7d.' });
                try {
                    const entry = await executeModerationAction({ guild, action: parsed.action, actorId: panelSession.userId, actorLabel: panelSession.userTag || panelSession.userId, targetId: parsed.targetId, reason: parsed.reason, durationMs, channel, count: parsed.count, seconds: parsed.seconds });
                    auditPanelAction(panelSession, 'moderation-action', `${entry.action} created case ${entry.id}`, { guildId, caseId: entry.id, targetId: entry.targetId });
                    sendJson(res, 200, { ok: true, case: entry });
                } catch (error) {
                    sendJson(res, 400, { error: error.message });
                }
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/management/roles/publish') {
                const guildId = requireGuildId(requestUrl, res);
                if (!guildId) return;
                if (!await requireGuildAdminAccess(panelSession, guildId, res, 'Role menus can only be published by server administrators.')) return;
                try {
                    const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
                    const message = await publishRoleMenu(guild);
                    auditPanelAction(panelSession, 'role-menu-publish', `Published role menu ${message.id}`, { guildId, channelId: message.channelId });
                    sendJson(res, 200, { ok: true, messageId: message.id, channelId: message.channelId });
                } catch (error) {
                    sendJson(res, 400, { error: error.message });
                }
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/settings') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                if (!await requireSettingsAccess(panelSession, guildId, res)) return;

                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');
                const current = settingsStore.readSettings(guildId);
                const next = { ...current, ...parsed };
                const saved = settingsStore.writeSettings(next, guildId);
                const changes = buildFieldChanges(current, saved, settingAuditLabels);
                auditPanelAction(panelSession, 'settings-update', 'Updated server settings', { guildId, changes });

                sendJson(res, 200, { ok: true, settings: saved });
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
                        role: accessStore.isConfiguredDeveloper(member.id) ? 'developer' : member.isAdministrator ? 'admin' : 'member',
                        isOwner: accessStore.isGuildOwner(member.id, guildId),
                        isDeveloper: accessStore.isConfiguredDeveloper(member.id),
                        overrideCount: Object.keys(permissions.commandOverrides || {}).length,
                        nonDefaultFeatureCount: featureKeys.filter(key => permissions[key] === false).length
                    };
                });

                sendJson(res, 200, { members: rows });
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

                if (!await requireMemberPermissionAccess(panelSession, guildId, parsed.userId, res)) return;

                if (accessStore.isGuildOwner(parsed.userId, guildId)) {
                    sendJson(res, 400, { error: 'The server owner role and permissions cannot be reset.' });
                    return;
                }

                if (accessStore.isConfiguredDeveloper(parsed.userId)) {
                    sendJson(res, 400, { error: 'Developers cannot be reset from this panel.' });
                    return;
                }

                accessStore.resetUserPermissions(String(parsed.userId), guildId);
                auditPanelAction(panelSession, 'member-reset', `Reset permissions for ${parsed.userId}`, { guildId, userId: String(parsed.userId) });
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
                    role: await getCurrentMemberRole(userId, guildId),
                    permissions: accessStore.getUserPermissions(userId, guildId),
                    canEdit: await canEditMemberPermissions(panelSession, guildId, userId)
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

                if (!await requireMemberPermissionAccess(panelSession, guildId, userId, res)) return;

                if (accessStore.isConfiguredDeveloper(userId)) {
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

                auditPanelAction(panelSession, 'permissions-update', `Updated permissions for ${userId}`, { guildId, userId: String(userId) });

                sendJson(res, 200, {
                    role: await getCurrentMemberRole(userId, guildId),
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
                    statistics: { messages: messageStats, voiceMs: voice?.totalMs || 0, shots: guildId ? shotStore.getShots(userId, guildId).total : 0, role: guildId ? await getCurrentMemberRole(userId, guildId) : 'member' },
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
                auditPanelAction(panelSession, 'bot-profile', 'Updated global Discord application profile');
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
                auditPanelAction(panelSession, 'bot-profile', `Updated Flummi's profile in guild ${guildId}`, { guildId });
                sendJson(res, 200, { ok: true, member });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/config') {
                const parsed = JSON.parse(await readBody(req) || '{}');
                const changesPublicAccess = Object.prototype.hasOwnProperty.call(parsed.panel || {}, 'publicAccessEnabled');
                if (changesPublicAccess) {
                    if (typeof parsed.panel.publicAccessEnabled !== 'boolean') {
                        sendJson(res, 400, { error: 'publicAccessEnabled must be a boolean.' });
                        return;
                    }
                    if (!requirePublicSiteToggleAccess(req, panelSession, res)) return;
                }
                const previousPublicAccess = config.panel?.publicAccessEnabled !== false;
                const allowed = ['ai', 'features', 'presence', 'commandPermissions', 'panel', 'analytics'];
                const updates = Object.fromEntries(allowed.filter(key => parsed[key] && typeof parsed[key] === 'object').map(key => [key, { ...(config[key] || {}), ...parsed[key] }]));
                if (typeof parsed.deployCommandsOnStart === 'boolean') {
                    updates.deployCommandsOnStart = parsed.deployCommandsOnStart;
                }
                if (parsed.ai?.imageSearch) updates.ai = { ...(updates.ai || config.ai), imageSearch: { ...(config.ai?.imageSearch || {}), ...parsed.ai.imageSearch } };
                Object.assign(config, updates);
                config.commandPermissions = Object.fromEntries(Object.entries({ ...(config.commandPermissions || {}), dashboard: 'member' }).map(([commandPath, role]) => [commandPath, accessStore.normalizeRole(role)]));
                delete config.commandPermissions['manage.role'];
                saveConfig(config);
                if (updates.presence) {
                    applyConfiguredPresence(client);
                    console.log('Applied updated Discord presence to the control panel connection.');
                }
                auditPanelAction(panelSession, 'config', 'Global configuration updated from the panel');
                if (changesPublicAccess && previousPublicAccess !== (config.panel?.publicAccessEnabled !== false)) {
                    auditPanelAction(panelSession, 'public-site-access', config.panel.publicAccessEnabled
                        ? 'Enabled public Cloudflare panel access'
                        : 'Paused public Cloudflare panel access');
                }
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
                auditPanelAction(panelSession, 'data-reset', `Reset ${parsed.store} for ${userId}`, { guildId, userId }); sendJson(res, 200, { ok: true }); return;
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
                auditPanelAction(panelSession, 'backup', `Created guild backup ${name}`, { guildId }); sendJson(res, 200, { ok: true, backup: name }); return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/reliability/reconcile-voice') {
                const guildId = requireGuildId(requestUrl, res); if (!guildId) return;
                const guild = client.guilds.cache.get(guildId); if (!guild) { sendJson(res, 404, { error: 'Guild is not available to the panel client.' }); return; }
                readyEvent.reconcileVoiceSessions(guild); auditPanelAction(panelSession, 'voice-reconcile', 'Manual voice session reconciliation completed', { guildId }); sendJson(res, 200, { ok: true }); return;
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
                sendJson(res, 200, { ...status, release: buildReleaseStatus() });
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

            if (req.method === 'POST' && requestUrl.pathname === '/api/release/promote') {
                if (!requireDeveloperFileWriteAccess(req, panelSession, res)) return;
                const helper = path.join(__dirname, 'deploy', 'promote-live.sh');
                if (!fs.existsSync(helper)) {
                    sendJson(res, 500, { error: 'The live promotion helper is not installed.' });
                    return;
                }
                auditPanelAction(panelSession, 'release-promote', 'Requested promotion of the tested Tailscale release to live');
                sendJson(res, 202, { ok: true, message: 'Live promotion started. The public service will restart when the copy is complete.' });
                spawn('bash', [helper], { cwd: __dirname, detached: true, stdio: 'ignore' }).unref();
                return;
            }

            sendJson(res, 404, { error: 'Not found.' });
        } catch (error) {
            if (error instanceof RepositoryFileError) {
                sendJson(res, error.statusCode, { error: error.message, code: error.code, ...error.details });
                return;
            }
            sendJson(res, 500, { error: error.message || 'Internal server error.' });
        }
    });
}

async function start() {
    if (!botToken) {
        throw new Error('Missing bot token. Set DISCORD_BOT_TOKEN in .env.');
    }

    await loginClient();

    const listenHosts = (host === '0.0.0.0' || host === '::' || host === '127.0.0.1')
        ? [host]
        : [host, '127.0.0.1'];

    servers = listenHosts.map(() => createServer());

    try {
        await Promise.all(servers.map((panelServer, index) => new Promise((resolve, reject) => {
            panelServer.once('error', reject);
            panelServer.listen(port, listenHosts[index], () => {
                panelServer.off('error', reject);
                resolve();
            });
        })));
    } catch (error) {
        for (const panelServer of servers) panelServer.close();
        servers = [];
        throw error;
    }

    const urls = listenHosts.map(listenHost => `http://${listenHost}:${port}`);
    console.log(`Bot control panel running at ${urls.join(' and ')}`);

    if (openBrowserOnStart) {
        openBrowser(urls[0]);
    }
}

function shutdown() {
    for (const panelServer of servers) panelServer.close();
    servers = [];

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
