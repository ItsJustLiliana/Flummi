const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { readSettings, isModuleGloballyDisabled } = require('../stores/settings-store');
const communityStore = require('../stores/community-management-store');

const recentJoins = new Map();
const stickyMessages = new Map();

function moduleConfig(guildId, key) {
    if (isModuleGloballyDisabled(key)) return null;
    const management = readSettings(guildId).management;
    return management.modules[key] ? management[key] : null;
}

async function sendConfiguredLog(guild, channelId, content) {
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
}

async function handleJoinSecurity(member) {
    const config = moduleConfig(member.guild.id, 'joinSecurity');
    if (!config) return;
    const now = Date.now();
    const key = member.guild.id;
    const windowStart = now - config.joinBurstWindowSeconds * 1000;
    const joins = (recentJoins.get(key) || []).filter(timestamp => timestamp >= windowStart);
    joins.push(now);
    recentJoins.set(key, joins);
    const accountAgeDays = (now - member.user.createdTimestamp) / 86400000;
    const reasons = [];
    if (accountAgeDays < config.minimumAccountAgeDays) reasons.push(`account is ${Math.floor(accountAgeDays)} day(s) old`);
    if (joins.length >= config.joinBurstLimit) reasons.push(`${joins.length} joins in ${config.joinBurstWindowSeconds}s`);
    if (!reasons.length) return;

    if (config.action === 'quarantine' && config.quarantineRoleId) {
        await member.roles.add(config.quarantineRoleId, 'Join Security protection').catch(() => {});
    } else if (config.action === 'kick' && member.kickable) {
        await member.kick(`Join Security: ${reasons.join(', ')}`).catch(() => {});
    }
    await sendConfiguredLog(member.guild, config.logChannelId, `⚠️ Join Security flagged **${member.user.tag}**: ${reasons.join(', ')}. Action: ${config.action}.`);
}

async function handleStarReaction(reaction, user) {
    if (user.bot || !reaction.message.guild) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const message = reaction.message;
    const config = moduleConfig(message.guild.id, 'starboard');
    if (!config?.channelId || reaction.emoji.toString() !== config.emoji) return;
    if (!config.allowSelfStars && message.author?.id === user.id) {
        await reaction.users.remove(user.id).catch(() => {});
        return;
    }
    if (reaction.count < config.threshold) return;
    const target = message.guild.channels.cache.get(config.channelId) || await message.guild.channels.fetch(config.channelId).catch(() => null);
    if (!target?.isTextBased() || message.channelId === target.id) return;
    const state = communityStore.readState(message.guild.id);
    const existingId = state.starboard[message.id];
    const embed = new EmbedBuilder()
        .setAuthor({ name: message.author?.tag || 'Unknown member', iconURL: message.author?.displayAvatarURL?.() })
        .setDescription(message.content || '*Attachment or embed*')
        .addFields({ name: 'Source', value: `[Open message](${message.url})` })
        .setTimestamp(message.createdAt)
        .setColor(0xf5c542);
    const image = message.attachments.first()?.url;
    if (image) embed.setImage(image);
    const payload = { content: `${config.emoji} **${reaction.count}** <#${message.channelId}>`, embeds: [embed] };
    if (existingId) {
        const existing = await target.messages.fetch(existingId).catch(() => null);
        if (existing) return existing.edit(payload);
    }
    const posted = await target.send(payload);
    communityStore.setStarboardMessage(message.guild.id, message.id, posted.id);
}

async function handleStickyMessage(message) {
    if (!message.guild || message.author.bot) return;
    const config = moduleConfig(message.guild.id, 'channels');
    if (!config?.stickyMessage || config.stickyChannelId !== message.channelId) return;
    const previousId = stickyMessages.get(message.channelId);
    if (previousId) {
        const previous = await message.channel.messages.fetch(previousId).catch(() => null);
        await previous?.delete().catch(() => {});
    }
    const posted = await message.channel.send({ content: `📌 ${config.stickyMessage}`, allowedMentions: { parse: [] } });
    stickyMessages.set(message.channelId, posted.id);
}

async function createTicket(interaction, topic) {
    const config = moduleConfig(interaction.guildId, 'tickets');
    if (!config) throw new Error('Tickets are not enabled in this server.');
    const state = communityStore.readState(interaction.guildId);
    const open = state.tickets.filter(ticket => ticket.ownerId === interaction.user.id && ticket.status !== 'closed');
    if (open.length >= config.maxOpenPerMember) throw new Error(`You already have ${open.length} open ticket(s).`);
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'member';
    const channel = await interaction.guild.channels.create({
        name: `ticket-${safeName}`,
        parent: config.categoryId || undefined,
        permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ...(config.supportRoleId ? [{ id: config.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
        ],
        reason: `Ticket opened by ${interaction.user.tag}`
    });
    const ticket = communityStore.addTicket(interaction.guildId, { ownerId: interaction.user.id, channelId: channel.id, topic, claimedBy: null });
    await channel.send({ content: `<@${interaction.user.id}>${config.supportRoleId ? ` <@&${config.supportRoleId}>` : ''}\n${config.welcomeMessage}\n\n**Topic:** ${topic}`, allowedMentions: { users: [interaction.user.id], roles: config.supportRoleId ? [config.supportRoleId] : [] } });
    return ticket;
}

module.exports = { moduleConfig, sendConfiguredLog, handleJoinSecurity, handleStarReaction, handleStickyMessage, createTicket };
