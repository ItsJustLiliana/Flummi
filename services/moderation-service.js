const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { readSettings } = require('../stores/settings-store');
const moderationStore = require('../stores/moderation-store');

class ModerationError extends Error {
    constructor(message, code = 'MODERATION_FAILED') {
        super(message);
        this.name = 'ModerationError';
        this.code = code;
    }
}

const actionPermissions = {
    timeout: PermissionFlagsBits.ModerateMembers,
    untimeout: PermissionFlagsBits.ModerateMembers,
    kick: PermissionFlagsBits.KickMembers,
    ban: PermissionFlagsBits.BanMembers,
    tempban: PermissionFlagsBits.BanMembers,
    softban: PermissionFlagsBits.BanMembers,
    unban: PermissionFlagsBits.BanMembers,
    purge: PermissionFlagsBits.ManageMessages
};

function parseDuration(input, fallbackMs = null) {
    if (Number.isFinite(input)) return Math.max(0, Number(input));
    const value = String(input || '').trim().toLowerCase();
    if (!value) return fallbackMs;
    if (/^\d+$/.test(value)) return Number(value) * 60 * 1000;
    const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
    let total = 0;
    let matched = '';
    for (const match of value.matchAll(/(\d+)\s*([smhdw])/g)) {
        total += Number(match[1]) * units[match[2]];
        matched += match[0];
    }
    return matched.replace(/\s+/g, '') === value.replace(/\s+/g, '') && total > 0 ? total : fallbackMs;
}

function durationLabel(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 'Permanent';
    const units = [['w', 604800000], ['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];
    let remaining = durationMs;
    const parts = [];
    for (const [label, size] of units) {
        const count = Math.floor(remaining / size);
        if (count) {
            parts.push(`${count}${label}`);
            remaining %= size;
        }
        if (parts.length === 2) break;
    }
    return parts.join(' ') || '<1s';
}

function requiredPermission(action) {
    return actionPermissions[action] || null;
}

async function fetchMember(guild, userId) {
    return guild.members.cache.get(String(userId)) || guild.members.fetch(String(userId)).catch(() => null);
}

function ensureBotPermission(guild, action) {
    const permission = requiredPermission(action);
    if (permission && !guild.members.me?.permissions.has(permission)) {
        throw new ModerationError(`Flummi is missing the Discord permission required for ${action}.`, 'MISSING_BOT_PERMISSION');
    }
}

async function ensureTargetAllowed({ guild, actorId, targetId, action }) {
    if (!targetId) return null;
    if (String(actorId) === String(targetId)) throw new ModerationError('You cannot moderate yourself.', 'SELF_TARGET');
    if (String(guild.ownerId) === String(targetId)) throw new ModerationError('The server owner cannot be moderated.', 'OWNER_TARGET');
    const target = await fetchMember(guild, targetId);
    if (!target) {
        if (['ban', 'tempban', 'unban'].includes(action)) return null;
        throw new ModerationError('That member is no longer in the server.', 'MEMBER_NOT_FOUND');
    }
    const botMember = guild.members.me;
    if (botMember && target.roles.highest.position >= botMember.roles.highest.position) {
        throw new ModerationError('Move the Flummi role above this member before moderating them.', 'BOT_ROLE_TOO_LOW');
    }
    const actor = actorId ? await fetchMember(guild, actorId) : null;
    if (actor && String(actor.id) !== String(guild.ownerId) && target.roles.highest.position >= actor.roles.highest.position) {
        throw new ModerationError('You cannot moderate a member with an equal or higher Discord role.', 'ACTOR_ROLE_TOO_LOW');
    }
    return target;
}

function renderTemplate(value, context) {
    return String(value || '')
        .replaceAll('{user}', context.userMention || context.username || 'member')
        .replaceAll('{username}', context.username || 'member')
        .replaceAll('{server}', context.serverName || 'the server')
        .replaceAll('{reason}', context.reason || 'No reason provided');
}

async function notifyMember(target, { action, reason, durationMs, guildName }) {
    if (!target?.send) return false;
    const duration = Number.isFinite(durationMs) && durationMs > 0 ? ` Duration: ${durationLabel(durationMs)}.` : '';
    return target.send(`You received **${action}** in **${guildName}**. Reason: ${reason}.${duration}`)
        .then(() => true)
        .catch(() => false);
}

async function publishCase(guild, moderationCase) {
    const settings = readSettings(guild.id);
    const channelId = settings.management?.cases?.logChannelId || settings.management?.automod?.logChannelId;
    if (!channelId) return false;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return false;
    const embed = new EmbedBuilder()
        .setColor(moderationCase.source === 'automod' ? 0xffbf5b : 0x75cfff)
        .setTitle(`${moderationCase.action.toUpperCase()} · ${moderationCase.id}`)
        .addFields(
            { name: 'Target', value: moderationCase.targetId ? `<@${moderationCase.targetId}> (${moderationCase.targetId})` : 'Channel action', inline: false },
            { name: 'Moderator', value: moderationCase.moderatorId ? `<@${moderationCase.moderatorId}>` : 'Flummi AutoMod', inline: true },
            { name: 'Reason', value: moderationCase.reason || 'No reason provided', inline: false }
        )
        .setTimestamp(new Date(moderationCase.createdAt));
    if (moderationCase.durationMs) embed.addFields({ name: 'Duration', value: durationLabel(moderationCase.durationMs), inline: true });
    if (moderationCase.evidence) embed.addFields({ name: 'Evidence', value: moderationCase.evidence.slice(0, 1000), inline: false });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    return true;
}

async function executeModerationAction({ guild, action, actorId, actorLabel, targetId, reason, durationMs = null, channel = null, count = null, seconds = null, evidence = null, source = 'manual', metadata = {} }) {
    const settings = readSettings(guild.id);
    if (settings.management?.modules?.moderation !== true && source === 'manual') {
        throw new ModerationError('The Moderation module is disabled for this server.', 'MODULE_DISABLED');
    }
    ensureBotPermission(guild, action);
    const safeReason = String(reason || '').trim() || 'No reason provided';
    if (source === 'manual' && settings.management?.moderation?.requireReason && !String(reason || '').trim()) {
        throw new ModerationError('A reason is required for moderation actions.', 'REASON_REQUIRED');
    }
    const target = await ensureTargetAllowed({ guild, actorId, targetId, action });
    const notify = source === 'manual' && settings.management?.moderation?.notifyMember === true;
    let resultMetadata = { ...metadata };
    let expiresAt = Number.isFinite(durationMs) && durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;
    let targetLabel = target?.user?.tag || targetId || null;

    if (notify && target && ['warn', 'timeout', 'kick', 'ban', 'tempban', 'softban'].includes(action)) {
        resultMetadata.memberNotified = await notifyMember(target, { action, reason: safeReason, durationMs, guildName: guild.name });
    }

    if (action === 'timeout') {
        const timeoutMs = Math.min(durationMs || settings.management.moderation.defaultTimeoutMinutes * 60000, 28 * 86400000);
        await target.timeout(timeoutMs, safeReason);
        durationMs = timeoutMs;
        expiresAt = new Date(Date.now() + timeoutMs).toISOString();
    } else if (action === 'untimeout') {
        await target.timeout(null, safeReason);
        expiresAt = null;
    } else if (action === 'kick') {
        await target.kick(safeReason);
    } else if (action === 'ban' || action === 'tempban') {
        await guild.members.ban(String(targetId), { reason: safeReason, deleteMessageSeconds: Math.max(0, Math.min(604800, Number(metadata.deleteMessageSeconds) || 0)) });
    } else if (action === 'unban') {
        const user = await guild.members.unban(String(targetId), safeReason);
        targetLabel = user?.tag || targetId;
        expiresAt = null;
    } else if (action === 'softban') {
        await guild.members.ban(String(targetId), { reason: safeReason, deleteMessageSeconds: Math.max(0, Math.min(604800, Number(metadata.deleteMessageSeconds) || 86400)) });
        await guild.members.unban(String(targetId), `Softban completed: ${safeReason}`);
        expiresAt = null;
    } else if (action === 'purge') {
        if (!channel?.bulkDelete) throw new ModerationError('Choose a text channel for purge.', 'INVALID_CHANNEL');
        const deleted = await channel.bulkDelete(Math.max(1, Math.min(100, Number(count) || 20)), true);
        resultMetadata.deletedMessages = deleted.size;
    }

    const moderationCase = moderationStore.addCase(guild.id, {
        action,
        targetId,
        targetLabel,
        moderatorId: actorId,
        moderatorLabel: actorLabel,
        reason: safeReason,
        evidence,
        channelId: channel?.id || null,
        durationMs,
        expiresAt,
        source,
        metadata: resultMetadata,
        status: ['untimeout', 'unban', 'softban', 'purge', 'note'].includes(action) ? 'completed' : 'active'
    });
    moderationStore.addEvent(guild.id, { type: 'moderation-action', userId: targetId, actorId, channelId: channel?.id, summary: `${action}: ${safeReason}`, metadata: { caseId: moderationCase.id, source } });
    await publishCase(guild, moderationCase);
    return moderationCase;
}

async function processExpiredCases(client) {
    for (const guild of client.guilds.cache.values()) {
        for (const entry of moderationStore.getDueCases(guild.id)) {
            try {
                if (entry.action === 'tempban' || entry.action === 'ban') {
                    await guild.members.unban(entry.targetId, `Timed moderation expired (${entry.id})`);
                } else if (entry.action === 'timeout') {
                    const member = await fetchMember(guild, entry.targetId);
                    if (member?.isCommunicationDisabled?.()) await member.timeout(null, `Timed moderation expired (${entry.id})`);
                }
                moderationStore.updateCase(guild.id, entry.id, { status: 'expired' }, { id: client.user?.id, label: 'Flummi scheduler' });
            } catch (error) {
                if (error?.code === 10026 || error?.code === 10007) {
                    moderationStore.updateCase(guild.id, entry.id, { status: 'expired' }, { id: client.user?.id, label: 'Flummi scheduler' });
                } else {
                    console.warn(`Failed to expire moderation case ${entry.id}: ${error.message}`);
                }
            }
        }
    }
}

module.exports = {
    ModerationError,
    parseDuration,
    durationLabel,
    renderTemplate,
    publishCase,
    executeModerationAction,
    processExpiredCases
};
