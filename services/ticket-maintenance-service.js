const community = require('../stores/community-management-store');
const { readSettings, isModuleGloballyDisabled } = require('../stores/settings-store');
const { createTicketTranscript, persistTranscripts, pruneTranscripts } = require('./ticket-transcript-service');

function recordTicketActivity(message) {
    if (!message.guildId) return false;
    const ticket = community.readState(message.guildId).tickets.find(entry => entry.channelId === message.channelId && entry.status !== 'closed');
    if (!ticket) return false;
    community.updateTicket(message.guildId, ticket.id, { lastActivityAt: new Date().toISOString() });
    return true;
}

async function archiveInactiveTicket(guild, ticket, config, now) {
    const channel = guild.channels.cache.get(ticket.channelId) || await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const updated = community.updateTicket(guild.id, ticket.id, { status: 'closed', closedBy: guild.client.user.id, closedAt: now.toISOString(), closeReason: `Automatically closed after ${config.autoCloseInactiveDays} inactive day(s)` });
    const files = await createTicketTranscript(channel, updated, config.transcriptFormats);
    persistTranscripts(guild.id, ticket.id, files);
    const log = config.logChannelId ? (guild.channels.cache.get(config.logChannelId) || await guild.channels.fetch(config.logChannelId).catch(() => null)) : null;
    await log?.send({ content: `Ticket **${ticket.id}** automatically closed for inactivity.`, files: files.map(file => ({ attachment: file.buffer, name: file.name })) }).catch(() => {});
    await channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false }).catch(() => {});
    await channel.setName(`closed-${channel.name.replace(/^ticket-/, '')}`.slice(0, 100)).catch(() => {});
    if (config.deleteClosedChannels) setTimeout(() => channel.delete(`Ticket ${ticket.id} retention policy`).catch(() => {}), config.deleteDelayMinutes * 60000).unref?.();
}

async function processTicketMaintenance(client, now = new Date()) {
    for (const guild of client.guilds.cache.values()) {
        const management = readSettings(guild.id).management;
        const config = management.tickets;
        pruneTranscripts(guild.id, config.retentionDays, now.getTime());
        if (!management.modules.tickets || isModuleGloballyDisabled('tickets') || !config.autoCloseInactiveDays) continue;
        const cutoff = now.getTime() - config.autoCloseInactiveDays * 86400000;
        for (const ticket of community.readState(guild.id).tickets.filter(entry => entry.status !== 'closed')) {
            const activeAt = Date.parse(ticket.lastActivityAt || ticket.updatedAt || ticket.createdAt || '') || now.getTime();
            if (activeAt < cutoff) await archiveInactiveTicket(guild, ticket, config, now);
        }
    }
}

module.exports = { archiveInactiveTicket, processTicketMaintenance, recordTicketActivity };
