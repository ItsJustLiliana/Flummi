const { ChannelType, PermissionFlagsBits } = require('discord.js');
const operations = require('../stores/operations-store');
const notifications = require('../stores/notification-store');
const { readSettings } = require('../stores/settings-store');

function filesFrom(message) {
    return [...(message.attachments?.values?.() || [])].map(file => ({ attachment: file.url, name: file.name || 'attachment' })).slice(0, 10);
}

function configuredGuilds(client) {
    return [...client.guilds.cache.values()].filter(guild => {
        const settings = readSettings(guild.id).management;
        return settings.modules.reports && settings.reports.modmailEnabled && (!settings.reports.modmailGuildId || settings.reports.modmailGuildId === guild.id);
    });
}

async function openModmail(message, guild) {
    const settings = readSettings(guild.id).management;
    const records = operations.readState(guild.id).modmail.filter(entry => entry.userId === message.author.id);
    const blocked = records.find(entry => entry.blocked);
    if (blocked) return blocked;
    const existing = records.find(entry => entry.status === 'open');
    if (existing) return existing;
    const supportRoleId = settings.tickets.supportRoleId;
    const channel = await guild.channels.create({
        name: `modmail-${message.author.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 35)}`,
        type: ChannelType.GuildText, parent: settings.reports.modmailCategoryId || undefined,
        topic: `Flummi modmail for ${message.author.tag} (${message.author.id})`,
        permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            ...(supportRoleId ? [{ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])
        ], reason: `Modmail opened by ${message.author.tag}`
    });
    const record = operations.addModmail(guild.id, { userId: message.author.id, userTag: message.author.tag, channelId: channel.id, claimedBy: null, blocked: false, category: 'general', messages: [] });
    await channel.send(`ðŸ“¬ **New modmail ${record.id}** from **${message.author.tag}** (\`${message.author.id}\`).\nStaff messages in this channel are relayed by default. Use \`/modmail note\` for private notes and \`/modmail close\` when done.`);
    return record;
}

async function handleDirectMessage(message, client) {
    if (message.guildId || message.author.bot) return false;
    const guilds = configuredGuilds(client);
    if (!guilds.length) return false;
    const guild = guilds[0];
    let record = await openModmail(message, guild);
    if (record.blocked) { await message.reply('You cannot open modmail with this server right now.'); return true; }
    const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const attachments = filesFrom(message);
    await channel.send({ content: `**${message.author.tag}:** ${message.content || '*attachment*'}`, files: attachments, allowedMentions: { parse: [] } });
    const messages = [...(record.messages || []), { direction: 'in', authorId: message.author.id, content: message.content, attachments: attachments.map(file => file.attachment), at: new Date().toISOString() }].slice(-1000);
    operations.updateModmail(guild.id, record.id, { messages, lastMessageAt: new Date().toISOString() });
    await message.react('âœ…').catch(() => {});
    return true;
}

async function handleStaffMessage(message) {
    if (!message.guildId || message.author.bot) return false;
    const record = operations.readState(message.guildId).modmail.find(entry => entry.channelId === message.channelId && entry.status === 'open');
    if (!record || message.content.startsWith('//')) return false;
    const user = await message.client.users.fetch(record.userId).catch(() => null);
    if (!user) return false;
    const anonymous = readSettings(message.guildId).management.reports.anonymousStaffReplies;
    const prefix = anonymous ? `**${message.guild.name} staff:**` : `**${message.author.displayName || message.author.username} (${message.guild.name}):**`;
    const attachments = filesFrom(message);
    await user.send({ content: `${prefix} ${message.content || '*attachment*'}`, files: attachments }).catch(() => null);
    const messages = [...(record.messages || []), { direction: 'out', authorId: message.author.id, anonymous, content: message.content, attachments: attachments.map(file => file.attachment), at: new Date().toISOString() }].slice(-1000);
    operations.updateModmail(message.guildId, record.id, { messages, lastMessageAt: new Date().toISOString(), firstResponseAt: record.firstResponseAt || new Date().toISOString() });
    return true;
}

function notifyModmail(userId, guildId, record, title, message) {
    return notifications.addNotification(userId, { type: 'modmail', title, message, guildId, channelId: record.channelId, referenceId: record.id });
}

module.exports = { configuredGuilds, handleDirectMessage, handleStaffMessage, notifyModmail, openModmail };
