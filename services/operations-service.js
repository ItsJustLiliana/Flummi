const { AuditLogEvent, ChannelType, GuildVerificationLevel, PermissionFlagsBits } = require('discord.js');
const dns = require('dns').promises;
const net = require('net');
const { readSettings, isModuleGloballyDisabled } = require('../stores/settings-store');
const operationsStore = require('../stores/operations-store');
const communityStore = require('../stores/community-management-store');

const recentAdministrativeActions = new Map();
const lastAutomaticBackup = new Map();
const lastDoctorDigest = new Map();

function decodeXml(value) {
    return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function newestFeedItem(xml) {
    const block = String(xml).match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/i)?.[0];
    if (!block) return null;
    const title = decodeXml(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'New creator update').replace(/<[^>]+>/g, '');
    const href = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1]
        || decodeXml(block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1])
        || decodeXml(block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]);
    return /^https?:\/\//i.test(href || '') ? { title: title.slice(0, 300), url: href } : null;
}

function isPrivateAddress(address) {
    if (net.isIP(address) === 4) {
        const parts = address.split('.').map(Number);
        return parts[0] === 10 || parts[0] === 127 || parts[0] === 0
            || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 192 && parts[1] === 168)
            || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
            || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
            || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
            || (parts[0] === 192 && (parts[1] === 0 || parts[1] === 2))
            || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
            || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224;
    }
    const normalized = String(address).toLowerCase();
    if (normalized.startsWith('::ffff:')) return isPrivateAddress(normalized.slice(7));
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb');
}

async function assertPublicFeedUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only public HTTPS feed URLs are allowed.');
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) throw new Error('Feed URL resolves to a private or reserved network.');
    return url;
}

async function fetchPublicFeed(value, signal) {
    let url = await assertPublicFeedUrl(value);
    for (let redirects = 0; redirects <= 3; redirects++) {
        const response = await fetch(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Flummi/1.0 feed reader' } });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        if (!location) throw new Error('Feed redirect had no destination.');
        url = await assertPublicFeedUrl(new URL(location, url).toString());
    }
    throw new Error('Feed redirected too many times.');
}

const auditTypes = {
    'channel-create': AuditLogEvent.ChannelCreate,
    'channel-delete': AuditLogEvent.ChannelDelete,
    'channel-update': AuditLogEvent.ChannelUpdate,
    'role-create': AuditLogEvent.RoleCreate,
    'role-delete': AuditLogEvent.RoleDelete,
    'role-update': AuditLogEvent.RoleUpdate,
    'member-ban': AuditLogEvent.MemberBanAdd,
    'member-unban': AuditLogEvent.MemberBanRemove
};

function moduleConfig(guildId, key) {
    if (isModuleGloballyDisabled(key)) return null;
    const management = readSettings(guildId).management;
    return management.modules[key] ? management[key] : null;
}

function snapshotGuild(guild, reason = 'manual') {
    const config = readSettings(guild.id).management.backups;
    return operationsStore.addSnapshot(guild.id, {
        reason,
        guild: { name: guild.name, verificationLevel: guild.verificationLevel },
        roles: [...guild.roles.cache.values()].filter(role => !role.managed).map(role => ({
            id: role.id, name: role.name, color: role.color, position: role.position,
            permissions: role.permissions.bitfield.toString(), mentionable: role.mentionable, hoist: role.hoist
        })),
        channels: [...guild.channels.cache.values()].map(channel => ({
            id: channel.id, name: channel.name, type: channel.type, parentId: channel.parentId,
            position: channel.rawPosition,
            permissionOverwrites: [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
                id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString()
            }))
        }))
    }, config.keepCount);
}

function previewSnapshot(guild, snapshotId) {
    const snapshot = operationsStore.readState(guild.id).snapshots.find(entry => entry.id === snapshotId);
    if (!snapshot) return null;
    const missingRoles = (snapshot.roles || []).filter(role => role.id !== guild.id && !guild.roles.cache.has(role.id));
    const missingChannels = (snapshot.channels || []).filter(channel => !guild.channels.cache.has(channel.id));
    return { snapshot, missingRoles, missingChannels };
}

async function restoreSnapshot(guild, snapshotId) {
    const preview = previewSnapshot(guild, snapshotId);
    if (!preview) throw new Error('Snapshot not found.');
    const roleMap = new Map([[guild.id, guild.id]]);
    for (const role of preview.snapshot.roles || []) {
        if (guild.roles.cache.has(role.id)) { roleMap.set(role.id, role.id); continue; }
        const created = await guild.roles.create({ name: role.name, color: role.color, permissions: BigInt(role.permissions), mentionable: role.mentionable, hoist: role.hoist, reason: `Flummi recovery ${snapshotId}` });
        roleMap.set(role.id, created.id);
    }
    const channelMap = new Map([...guild.channels.cache.keys()].map(id => [id, id]));
    const allowedTypes = new Set([ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia]);
    const missing = preview.missingChannels.filter(channel => allowedTypes.has(channel.type)).sort((left, right) => (left.type === ChannelType.GuildCategory ? -1 : 0) - (right.type === ChannelType.GuildCategory ? -1 : 0));
    for (const channel of missing) {
        const permissionOverwrites = (channel.permissionOverwrites || []).filter(overwrite => overwrite.type === 0 ? roleMap.has(overwrite.id) : guild.members.cache.has(overwrite.id)).map(overwrite => ({
            id: roleMap.get(overwrite.id) || overwrite.id, type: overwrite.type,
            allow: BigInt(overwrite.allow), deny: BigInt(overwrite.deny)
        }));
        const created = await guild.channels.create({ name: channel.name, type: channel.type, parent: channelMap.get(channel.parentId) || undefined, permissionOverwrites, reason: `Flummi recovery ${snapshotId}` });
        channelMap.set(channel.id, created.id);
    }
    return { snapshotId, restoredRoles: [...roleMap.entries()].filter(([oldId, newId]) => oldId !== newId).length, restoredChannels: [...channelMap.entries()].filter(([oldId, newId]) => oldId !== newId).length };
}

function doctorCheck(id, severity, title, detail, fix = null) {
    return { id, severity, title, detail, fix };
}

async function scanServer(guild) {
    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);
    const settings = readSettings(guild.id);
    const management = settings.management;
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const checks = [];

    if (!me) checks.push(doctorCheck('bot-member', 'critical', 'Flummi member unavailable', 'Discord did not return the bot member for this server.'));
    else {
        const expected = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];
        const missing = me.permissions.missing(expected);
        if (missing.length) checks.push(doctorCheck('base-permissions', 'critical', 'Required bot permissions are missing', missing.join(', '), 'Update Flummi’s server role permissions.'));
        const highest = me.roles.highest.position;
        const blockedRoles = [...guild.roles.cache.values()].filter(role => !role.managed && role.id !== guild.id && role.position >= highest && (role.permissions.has(PermissionFlagsBits.Administrator) || role.members?.size));
        if (blockedRoles.length) checks.push(doctorCheck('role-hierarchy', 'warning', 'Role hierarchy limits Flummi', `${blockedRoles.length} role(s) are at or above Flummi’s highest role.`, 'Move Flummi above roles it must manage.'));
    }

    const everyone = guild.roles.everyone;
    const dangerous = [
        ['Administrator', PermissionFlagsBits.Administrator], ['Manage Server', PermissionFlagsBits.ManageGuild],
        ['Manage Roles', PermissionFlagsBits.ManageRoles], ['Manage Channels', PermissionFlagsBits.ManageChannels],
        ['Ban Members', PermissionFlagsBits.BanMembers], ['Kick Members', PermissionFlagsBits.KickMembers],
        ['Mention Everyone', PermissionFlagsBits.MentionEveryone]
    ].filter(([, flag]) => everyone.permissions.has(flag)).map(([name]) => name);
    if (dangerous.length) checks.push(doctorCheck('everyone-permissions', 'critical', '@everyone has dangerous permissions', dangerous.join(', '), 'Remove these permissions from @everyone.'));

    const channelExists = id => !id || guild.channels.cache.has(id);
    const configuredChannels = [
        ['AutoMod log', management.automod.logChannelId], ['Case log', management.cases.logChannelId],
        ['Ticket log', management.tickets.logChannelId], ['Reports inbox', management.reports.channelId],
        ['Incident log', management.incidentCenter.logChannelId], ['Starboard', management.starboard.channelId]
    ];
    for (const [name, channelId] of configuredChannels) {
        if (channelId && !channelExists(channelId)) checks.push(doctorCheck(`channel-${channelId}`, 'warning', `${name} channel no longer exists`, `Configured channel ${channelId} could not be found.`, 'Choose a replacement channel.'));
    }

    for (const [key, enabled] of Object.entries(management.modules)) {
        if (!enabled) continue;
        const value = management[key];
        if (!value || typeof value !== 'object') checks.push(doctorCheck(`module-${key}`, 'warning', `${key} has incomplete settings`, 'The module is enabled without a valid configuration.', 'Open the module and save its settings.'));
    }

    const critical = checks.filter(check => check.severity === 'critical').length;
    const warnings = checks.filter(check => check.severity === 'warning').length;
    return { checkedAt: new Date().toISOString(), score: Math.max(0, 100 - critical * 20 - warnings * 7), critical, warnings, checks };
}

async function sendLog(guild, channelId, content) {
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
}

async function recordAdministrativeAction(guild, type, target) {
    const config = moduleConfig(guild.id, 'incidentCenter');
    if (!config) return null;
    const auditType = auditTypes[type];
    let actorId = 'unknown';
    if (auditType) {
        const logs = await guild.fetchAuditLogs({ type: auditType, limit: 5 }).catch(() => null);
        const entry = logs?.entries.find(item => String(item.targetId || item.target?.id || '') === String(target?.id || '') && Date.now() - item.createdTimestamp < 15000);
        if (entry?.executorId) actorId = entry.executorId;
    }
    if (actorId === guild.client.user.id) return null;
    const key = `${guild.id}:${actorId}`;
    const cutoff = Date.now() - config.windowSeconds * 1000;
    const actions = (recentAdministrativeActions.get(key) || []).filter(item => item.at >= cutoff);
    actions.push({ at: Date.now(), type, targetId: target?.id || null, targetName: target?.name || target?.user?.tag || null });
    recentAdministrativeActions.set(key, actions);
    if (actions.length < config.actionThreshold) return null;
    const alreadyRecorded = operationsStore.readState(guild.id).incidents.some(entry => entry.status === 'open' && entry.actorId === actorId && Date.now() - new Date(entry.createdAt).getTime() < config.windowSeconds * 1000);
    if (alreadyRecorded) return null;
    if (config.snapshotEnabled) snapshotGuild(guild, `before incident response for ${actorId}`);
    const incident = operationsStore.addIncident(guild.id, { actorId, actions, severity: 'critical', summary: `${actions.length} administrative actions in ${config.windowSeconds} seconds` });
    if (config.autoLockdown && guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        communityStore.setSecurityState(guild.id, { previousVerificationLevel: guild.verificationLevel, lockedDownAt: new Date().toISOString(), incidentId: incident.id });
        await guild.setVerificationLevel(GuildVerificationLevel.High, `Flummi incident ${incident.id}`).catch(() => {});
        incident.lockdownApplied = true;
        operationsStore.updateIncident(guild.id, incident.id, { lockdownApplied: true });
    }
    await sendLog(guild, config.logChannelId, `🚨 **Flummi Incident Center** opened ${incident.id}: ${incident.summary}. Actor: ${actorId}.${incident.lockdownApplied ? ' Verification was raised to High.' : ''}`);
    return incident;
}

async function processOperations(client) {
    for (const guild of client.guilds.cache.values()) {
        const management = readSettings(guild.id).management;
        if (management.modules.serverDoctor && management.serverDoctor.weeklyDigest && management.serverDoctor.logChannelId) {
            const last = lastDoctorDigest.get(guild.id) || 0;
            if (Date.now() - last >= 7 * 86400000) {
                const result = await scanServer(guild);
                await sendLog(guild, management.serverDoctor.logChannelId, `🩺 **Weekly Server Doctor:** health ${result.score}/100 · ${result.critical} critical · ${result.warnings} warnings.${result.checks[0] ? ` Top issue: ${result.checks[0].title}.` : ''}`);
                lastDoctorDigest.set(guild.id, Date.now());
            }
        }
        if (management.modules.engagement && management.engagement.reminders) {
            for (const reminder of operationsStore.dueReminders(guild.id)) {
                const channel = guild.channels.cache.get(reminder.channelId) || await guild.channels.fetch(reminder.channelId).catch(() => null);
                if (channel?.isTextBased()) await channel.send({ content: `<@${reminder.userId}> reminder: ${reminder.message}`, allowedMentions: { users: [reminder.userId] } }).catch(() => {});
                operationsStore.updateReminder(guild.id, reminder.id, { status: 'sent', sentAt: new Date().toISOString() });
            }
        }
        if (management.modules.engagement && management.engagement.giveaways) {
            const giveaways = operationsStore.readState(guild.id).giveaways.filter(entry => entry.status === 'open' && new Date(entry.endsAt).getTime() <= Date.now());
            for (const giveaway of giveaways) {
                const channel = guild.channels.cache.get(giveaway.channelId) || await guild.channels.fetch(giveaway.channelId).catch(() => null);
                const message = channel?.isTextBased() ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
                const reaction = message?.reactions.cache.find(item => item.emoji.name === '🎉');
                const users = reaction ? [...(await reaction.users.fetch().catch(() => new Map())).values()].filter(user => !user.bot) : [];
                const winner = users.length ? users[Math.floor(Math.random() * users.length)] : null;
                if (message) await message.reply({ content: winner ? `🎉 <@${winner.id}> won **${giveaway.prize}**!` : `The giveaway for **${giveaway.prize}** ended without entries.`, allowedMentions: winner ? { users: [winner.id] } : { parse: [] } }).catch(() => {});
                operationsStore.updateGiveaway(guild.id, giveaway.id, { status: 'closed', winnerId: winner?.id || null, endedAt: new Date().toISOString() });
            }
        }
        if (management.modules.engagement && management.engagement.temporaryRoles) {
            const temporaryRoles = operationsStore.readState(guild.id).temporaryRoles.filter(entry => entry.status === 'open' && new Date(entry.removeAt).getTime() <= Date.now());
            for (const assignment of temporaryRoles) {
                const member = guild.members.cache.get(assignment.userId) || await guild.members.fetch(assignment.userId).catch(() => null);
                if (member) await member.roles.remove(assignment.roleId, 'Temporary role expired').catch(() => {});
                operationsStore.updateTemporaryRole(guild.id, assignment.id, { status: 'expired', removedAt: new Date().toISOString() });
            }
        }
        if (management.modules.engagement && management.engagement.feeds) {
            const feeds = operationsStore.readState(guild.id).feeds.filter(entry => entry.status === 'open' && (!entry.lastCheckedAt || Date.now() - new Date(entry.lastCheckedAt).getTime() >= 15 * 60000));
            for (const feed of feeds) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                try {
                    const response = await fetchPublicFeed(feed.url, controller.signal);
                    const length = Number(response.headers.get('content-length') || 0);
                    if (!response.ok || length > 2 * 1024 * 1024) throw new Error(`Feed returned ${response.status}`);
                    const item = newestFeedItem((await response.text()).slice(0, 2 * 1024 * 1024));
                    if (item && feed.lastItemUrl && item.url !== feed.lastItemUrl) {
                        const channel = guild.channels.cache.get(feed.channelId) || await guild.channels.fetch(feed.channelId).catch(() => null);
                        if (channel?.isTextBased()) await channel.send({ content: `**${feed.name}** published **${item.title}**\n${item.url}`, allowedMentions: { parse: [] } }).catch(() => {});
                    }
                    operationsStore.updateFeed(guild.id, feed.id, { lastItemUrl: item?.url || feed.lastItemUrl, lastCheckedAt: new Date().toISOString(), lastError: null });
                } catch (error) {
                    operationsStore.updateFeed(guild.id, feed.id, { lastCheckedAt: new Date().toISOString(), lastError: error.message });
                } finally { clearTimeout(timeout); }
            }
        }
        if (management.modules.backups && management.backups.automaticEnabled) {
            const last = lastAutomaticBackup.get(guild.id) || 0;
            if (Date.now() - last >= management.backups.intervalHours * 3600000) {
                snapshotGuild(guild, 'automatic');
                lastAutomaticBackup.set(guild.id, Date.now());
            }
        }
    }
}

async function handleVoiceRole(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const config = moduleConfig(guild.id, 'engagement');
    if (!config?.voiceLinkedRoles || oldState.member?.user?.bot || newState.member?.user?.bot) return;
    const links = operationsStore.readState(guild.id).voiceRoleLinks;
    const member = newState.member || oldState.member;
    for (const link of links) {
        if (newState.channelId === link.channelId) await member.roles.add(link.roleId, 'Joined linked voice channel').catch(() => {});
        else if (oldState.channelId === link.channelId) await member.roles.remove(link.roleId, 'Left linked voice channel').catch(() => {});
    }
}

module.exports = { moduleConfig, scanServer, snapshotGuild, previewSnapshot, restoreSnapshot, recordAdministrativeAction, processOperations, handleVoiceRole, newestFeedItem, isPrivateAddress };
