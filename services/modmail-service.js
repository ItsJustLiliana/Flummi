const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder } = require('discord.js');
const operations = require('../stores/operations-store');
const notifications = require('../stores/notification-store');
const { readSettings } = require('../stores/settings-store');

const pendingIntakes = new Map();
const CONSENT_TTL_MS = 10 * 60 * 1000;

function filesFrom(message) { return [...(message.attachments?.values?.() || [])].map(file => ({ attachment: file.url, name: file.name || 'attachment' })).slice(0, 10); }
function configuredGuilds(client) {
    return [...client.guilds.cache.values()].filter(guild => {
        const settings = readSettings(guild.id).management;
        return settings.modules.reports && settings.reports.modmailEnabled && (!settings.reports.modmailGuildId || settings.reports.modmailGuildId === guild.id);
    });
}

async function openModmail(message, guild, { consentAt = null } = {}) {
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
        permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, ...(supportRoleId ? [{ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] : [])],
        reason: `Modmail opened by ${message.author.tag}`
    });
    const record = operations.addModmail(guild.id, { userId: message.author.id, userTag: message.author.tag, channelId: channel.id, claimedBy: null, blocked: false, category: 'general', consentAt, messages: [] });
    await channel.send(`📬 **New modmail ${record.id}** from **${message.author.tag}** (\`${message.author.id}\`).\nStaff messages in this channel are relayed by default. Use \`/modmail note\` for private notes and \`/modmail close\` when done.`);
    return record;
}

function consentText(guild) {
    return `**Before Flummi forwards this DM**\nDestination: **${guild.name}** staff.\nData used: your Discord identity, this message, and any attachments. Flummi stores a copy in that server's private operational data so staff can reply and follow up. Nothing is sent until you confirm. You can later request deletion with \`/data delete\`.`;
}
function consentButtons(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`modmail-consent:confirm:${userId}`).setLabel('Confirm and send').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`modmail-consent:cancel:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
}
async function promptForConsent(message, guilds) {
    pendingIntakes.set(message.author.id, { message, guildIds: guilds.map(guild => guild.id), selectedGuildId: guilds.length === 1 ? guilds[0].id : null, expiresAt: Date.now() + CONSENT_TTL_MS });
    if (guilds.length === 1) return message.reply({ content: consentText(guilds[0]), components: [consentButtons(message.author.id)] });
    const select = new StringSelectMenuBuilder().setCustomId(`modmail-consent-guild:${message.author.id}`).setPlaceholder('Choose the staff destination')
        .addOptions(guilds.slice(0, 25).map(guild => ({ label: guild.name.slice(0, 100), value: guild.id, description: `Send this DM to ${guild.name}`.slice(0, 100) })));
    return message.reply({ content: '**Choose where this DM should go.** Nothing has been forwarded or stored by server staff yet.', components: [new ActionRowBuilder().addComponents(select)] });
}
async function relayDirectMessage(message, guild, record) {
    const channel = guild.channels.cache.get(record.channelId) || await guild.channels.fetch(record.channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    const attachments = filesFrom(message);
    await channel.send({ content: `**${message.author.tag}:** ${message.content || '*attachment*'}`, files: attachments, allowedMentions: { parse: [] } });
    const messages = [...(record.messages || []), { direction: 'in', authorId: message.author.id, content: message.content, attachments: attachments.map(file => file.attachment), at: new Date().toISOString() }].slice(-1000);
    operations.updateModmail(guild.id, record.id, { messages, lastMessageAt: new Date().toISOString() });
    await message.react('✅').catch(() => {});
    return true;
}

async function handleDirectMessage(message, client) {
    if (message.guildId || message.author.bot) return false;
    const guilds = configuredGuilds(client);
    if (!guilds.length) return false;
    const consented = guilds.map(guild => ({ guild, record: operations.readState(guild.id).modmail.find(entry => entry.userId === message.author.id && entry.status === 'open' && entry.consentAt) })).find(item => item.record);
    if (consented) return relayDirectMessage(message, consented.guild, consented.record);
    await promptForConsent(message, guilds);
    return true;
}

async function handleModmailConsentInteraction(interaction) {
    const isGuildChoice = interaction.isStringSelectMenu?.() && interaction.customId.startsWith('modmail-consent-guild:');
    const isDecision = interaction.isButton?.() && interaction.customId.startsWith('modmail-consent:');
    if (!isGuildChoice && !isDecision) return false;
    const expectedUserId = interaction.customId.split(':').at(-1);
    if (expectedUserId !== interaction.user.id) { await interaction.reply({ content: 'This modmail confirmation belongs to another user.', flags: MessageFlags.Ephemeral }); return true; }
    const pending = pendingIntakes.get(interaction.user.id);
    if (!pending || pending.expiresAt <= Date.now()) { pendingIntakes.delete(interaction.user.id); await interaction.update({ content: 'This modmail confirmation expired. Send your DM again to restart.', components: [] }); return true; }
    if (isGuildChoice) {
        const guildId = interaction.values[0];
        if (!pending.guildIds.includes(guildId)) return true;
        pending.selectedGuildId = guildId;
        const guild = interaction.client.guilds.cache.get(guildId);
        if (!guild) {
            pendingIntakes.delete(interaction.user.id);
            await interaction.update({ content: 'That destination is no longer available. Nothing was forwarded.', components: [] });
            return true;
        }
        await interaction.update({ content: consentText(guild), components: [consentButtons(interaction.user.id)] });
        return true;
    }
    const action = interaction.customId.split(':')[1];
    if (action === 'cancel') { pendingIntakes.delete(interaction.user.id); await interaction.update({ content: 'Modmail cancelled. Your DM was not forwarded to server staff.', components: [] }); return true; }
    const guild = interaction.client.guilds.cache.get(pending.selectedGuildId);
    if (!guild) { pendingIntakes.delete(interaction.user.id); await interaction.update({ content: 'That destination is no longer available. Nothing was forwarded.', components: [] }); return true; }
    let record = await openModmail(pending.message, guild, { consentAt: new Date().toISOString() });
    if (record.blocked) { pendingIntakes.delete(interaction.user.id); await interaction.update({ content: 'You cannot open modmail with this server right now.', components: [] }); return true; }
    if (!record.consentAt) record = operations.updateModmail(guild.id, record.id, { consentAt: new Date().toISOString() });
    const sent = await relayDirectMessage(pending.message, guild, record);
    pendingIntakes.delete(interaction.user.id);
    await interaction.update({ content: sent ? `Your DM was sent to **${guild.name}** staff as **${record.id}**.` : 'The destination channel is unavailable. Nothing was forwarded.', components: [] });
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
    const delivered = await user.send({ content: `${prefix} ${message.content || '*attachment*'}`, files: attachments })
        .then(() => true)
        .catch(() => false);
    if (!delivered) {
        await message.reply({ content: 'I could not deliver that reply because the member’s DMs are closed or unavailable.', allowedMentions: { repliedUser: false } }).catch(() => {});
        return true;
    }
    const messages = [...(record.messages || []), { direction: 'out', authorId: message.author.id, anonymous, content: message.content, attachments: attachments.map(file => file.attachment), at: new Date().toISOString() }].slice(-1000);
    operations.updateModmail(message.guildId, record.id, { messages, lastMessageAt: new Date().toISOString(), firstResponseAt: record.firstResponseAt || new Date().toISOString() });
    return true;
}
function notifyModmail(userId, guildId, record, title, message) { return notifications.addNotification(userId, { type: 'modmail', title, message, guildId, channelId: record.channelId, referenceId: record.id }); }

module.exports = { configuredGuilds, handleDirectMessage, handleModmailConsentInteraction, handleStaffMessage, notifyModmail, openModmail, pendingIntakes };
