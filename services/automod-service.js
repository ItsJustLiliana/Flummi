const { PermissionFlagsBits } = require('discord.js');
const { isDeveloper } = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');
const { addCase, addEvent, getMemberCases } = require('../stores/moderation-store');
const { publishCase } = require('./moderation-service');

const recentMessages = new Map();

const thresholds = {
    relaxed: { windowMs: 8000, messages: 8, mentions: 8, caps: 0.9, duplicate: 4, emoji: 16, invites: 3 },
    balanced: { windowMs: 8000, messages: 6, mentions: 6, caps: 0.8, duplicate: 3, emoji: 12, invites: 2 },
    strict: { windowMs: 8000, messages: 5, mentions: 4, caps: 0.7, duplicate: 2, emoji: 8, invites: 1 }
};

function normalizeContent(content) {
    return String(content || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function fallbackRules(preset) {
    const rule = thresholds[preset] || thresholds.balanced;
    return {
        badWords: { enabled: true, limit: 1 }, serverInvites: { enabled: true, limit: rule.invites }, externalLinks: { enabled: false, limit: 2 },
        messageSpam: { enabled: true, limit: rule.messages, windowSeconds: rule.windowMs / 1000 }, duplicateSpam: { enabled: true, limit: rule.duplicate, windowSeconds: 30 },
        mentionSpam: { enabled: true, limit: rule.mentions }, capsSpam: { enabled: true, limit: Math.round(rule.caps * 100) },
        emojiSpam: { enabled: true, limit: rule.emoji }, zalgoSpam: { enabled: false, limit: 12 }
    };
}

function evaluateContent({ content, mentions = 0, blockedTerms = [], allowedDomains = [], allowedInviteCodes = [], preset = 'balanced', rules = null, history = [], now = Date.now() }) {
    const configured = rules || fallbackRules(preset);
    const normalized = normalizeContent(content);
    const letters = String(content || '').match(/[a-z]/gi) || [];
    const capitals = String(content || '').match(/[A-Z]/g) || [];
    const blocked = blockedTerms.some(term => {
        const needle = normalizeContent(term);
        if (!needle) return false;
        if (/\s/.test(needle)) return normalized.includes(needle);
        return normalized.split(/[^\p{L}\p{N}_-]+/u).includes(needle);
    });
    const customEmoji = String(content || '').match(/<a?:\w+:\d+>/g) || [];
    const unicodeEmoji = String(content || '').match(/\p{Extended_Pictographic}/gu) || [];
    const inviteCodes = [...String(content || '').matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/gi)].map(match => match[1].toLowerCase()).filter(code => !allowedInviteCodes.includes(code));
    const urls = [...String(content || '').matchAll(/\b(?:https?:\/\/|www\.)([^\s/:?#]+)[^\s]*/gi)].map(match => match[1].toLowerCase().replace(/^www\./, '')).filter(domain => !domain.endsWith('discord.gg') && domain !== 'discord.com' && domain !== 'discordapp.com').filter(domain => !allowedDomains.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`)));
    const combiningMarks = String(content || '').match(/\p{M}/gu) || [];
    const recentFor = key => history.filter(item => now - Number(item.at || now) <= (configured[key]?.windowSeconds || 8) * 1000);
    if (configured.badWords?.enabled && blocked) return { rule: 'badWords', reason: 'Blocked word or phrase' };
    if (configured.mentionSpam?.enabled && mentions >= configured.mentionSpam.limit) return { rule: 'mentionSpam', reason: `Excessive mentions (${mentions})` };
    if (configured.emojiSpam?.enabled && customEmoji.length + unicodeEmoji.length >= configured.emojiSpam.limit) return { rule: 'emojiSpam', reason: 'Excessive emoji use' };
    if (configured.serverInvites?.enabled && inviteCodes.length >= configured.serverInvites.limit) return { rule: 'serverInvites', reason: 'Discord invite spam' };
    if (configured.externalLinks?.enabled && urls.length >= configured.externalLinks.limit) return { rule: 'externalLinks', reason: 'External link spam' };
    if (configured.zalgoSpam?.enabled && combiningMarks.length >= configured.zalgoSpam.limit) return { rule: 'zalgoSpam', reason: 'Excessive combining characters' };
    if (configured.capsSpam?.enabled && letters.length >= 12 && capitals.length / letters.length * 100 >= configured.capsSpam.limit) return { rule: 'capsSpam', reason: 'Excessive capital letters' };
    if (configured.duplicateSpam?.enabled && normalized.length >= 4 && recentFor('duplicateSpam').filter(item => item.content === normalized).length >= configured.duplicateSpam.limit - 1) return { rule: 'duplicateSpam', reason: 'Repeated message spam' };
    if (configured.messageSpam?.enabled && recentFor('messageSpam').length >= configured.messageSpam.limit - 1) return { rule: 'messageSpam', reason: 'Messages sent too quickly' };
    return null;
}

function memberBypasses(message, settings) {
    const member = message.member;
    if (!member) return true;
    if (isDeveloper(message.author.id)) return true;
    if (member.permissions?.has(PermissionFlagsBits.ManageMessages) || member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
    if (settings.ignoredChannelIds.includes(message.channelId)) return true;
    return member.roles?.cache?.some(role => settings.ignoredRoleIds.includes(role.id)) || false;
}

async function handleMessage(message) {
    const management = readSettings(message.guildId).management;
    if (!management.modules.automod || memberBypasses(message, management.automod)) return false;
    const key = `${message.guildId}:${message.author.id}`;
    const now = Date.now();
    const history = (recentMessages.get(key) || []).filter(item => now - item.at <= 300000);
    const roleIds = message.member?.roles?.cache ? [...message.member.roles.cache.keys()] : [];
    const effectiveRules = Object.fromEntries(Object.entries(management.automod.rules).map(([ruleKey, rule]) => [ruleKey, {
        ...rule,
        enabled: rule.enabled && !rule.ignoredChannelIds.includes(message.channelId) && !roleIds.some(id => rule.ignoredRoleIds.includes(id))
    }]));
    const violation = evaluateContent({
        content: message.content,
        mentions: (message.mentions?.users?.size || 0) + (message.mentions?.roles?.size || 0),
        blockedTerms: management.automod.blockedTerms,
        allowedDomains: management.automod.allowedDomains,
        allowedInviteCodes: management.automod.allowedInviteCodes,
        preset: management.automod.preset,
        rules: effectiveRules,
        history,
        now
    });
    history.push({ at: now, content: normalizeContent(message.content) });
    recentMessages.set(key, history.slice(-20));
    if (!violation) return false;

    const previous = getMemberCases(message.guildId, message.author.id, { limit: 20 })
        .filter(entry => entry.source === 'automod' && Date.now() - new Date(entry.createdAt).getTime() < 3600000).length;
    let action = management.automod.rules[violation.rule]?.action || 'inherit';
    if (action === 'inherit') action = management.automod.action;
    if (management.automod.escalationEnabled && previous >= 2) action = 'timeout';
    const enforce = management.automod.mode === 'enforce';
    if (enforce) await message.delete().catch(() => null);
    if (enforce && action === 'timeout' && message.member?.moderatable) {
        await message.member.timeout(management.automod.timeoutMinutes * 60000, `Flummi AutoMod: ${violation.reason}`).catch(() => null);
    }

    const entry = addCase(message.guildId, {
        action: enforce ? action : 'automod-test', targetId: message.author.id, targetLabel: message.author.tag,
        reason: violation.reason, evidence: String(message.content || '').slice(0, 500), channelId: message.channelId,
        durationMs: enforce && action === 'timeout' ? management.automod.timeoutMinutes * 60000 : null,
        expiresAt: enforce && action === 'timeout' ? new Date(Date.now() + management.automod.timeoutMinutes * 60000).toISOString() : null,
        source: 'automod', status: enforce && action === 'timeout' ? 'active' : 'completed', metadata: { rule: violation.rule, mode: management.automod.mode }
    });
    addEvent(message.guildId, { type: 'automod', userId: message.author.id, channelId: message.channelId, summary: violation.reason, metadata: { caseId: entry.id, rule: violation.rule, mode: management.automod.mode } });
    await publishCase(message.guild, entry);
    return enforce;
}

function resetRuntimeState() {
    recentMessages.clear();
}

module.exports = { evaluateContent, handleMessage, resetRuntimeState };
