const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isAdmin } = require('../stores/access-store');
const store = require('../stores/community-management-store');
const notifications = require('../stores/notification-store');
const { createTicket, moduleConfig } = require('../services/community-management-service');
const { createTicketTranscript, persistTranscripts } = require('../services/ticket-transcript-service');

function buildCommand() {
    return new SlashCommandBuilder().setName('ticket').setDescription('Open and manage support tickets')
        .addSubcommand(c => c.setName('open').setDescription('Open a private support ticket').addStringOption(o => o.setName('topic').setDescription('What do you need help with?').setRequired(true).setMaxLength(500)))
        .addSubcommand(c => c.setName('claim').setDescription('Claim this ticket'))
        .addSubcommand(c => c.setName('assign').setDescription('Assign this ticket').addUserOption(o => o.setName('member').setDescription('Staff member').setRequired(true)))
        .addSubcommand(c => c.setName('priority').setDescription('Set ticket priority').addStringOption(o => o.setName('level').setDescription('Priority').setRequired(true).addChoices({ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }, { name: 'Urgent', value: 'urgent' })))
        .addSubcommand(c => c.setName('tag').setDescription('Add or remove a tag').addStringOption(o => o.setName('name').setDescription('Tag').setRequired(true).setMaxLength(30)).addBooleanOption(o => o.setName('remove').setDescription('Remove this tag')))
        .addSubcommand(c => c.setName('note').setDescription('Add a private staff note').addStringOption(o => o.setName('text').setDescription('Internal note').setRequired(true).setMaxLength(1000)))
        .addSubcommand(c => c.setName('status').setDescription('Set helpdesk status').addStringOption(o => o.setName('state').setDescription('Status').setRequired(true).addChoices({ name: 'Open', value: 'open' }, { name: 'Waiting for user', value: 'waiting-user' }, { name: 'Escalated', value: 'escalated' })))
        .addSubcommand(c => c.setName('transfer').setDescription('Transfer to a support team').addStringOption(o => o.setName('team').setDescription('Configured team ID').setRequired(true)))
        .addSubcommand(c => c.setName('reopen').setDescription('Re-open a closed ticket'))
        .addSubcommand(c => c.setName('close').setDescription('Close and archive this ticket').addStringOption(o => o.setName('reason').setDescription('Closing reason').setMaxLength(500)));
}

async function publishTranscript(interaction, ticket, config) {
    const files = await createTicketTranscript(interaction.channel, ticket, config.transcriptFormats?.length ? config.transcriptFormats : ['html', 'txt', 'json']);
    persistTranscripts(interaction.guildId, ticket.id, files);
    const log = config.logChannelId ? (interaction.guild.channels.cache.get(config.logChannelId) || await interaction.guild.channels.fetch(config.logChannelId).catch(() => null)) : null;
    if (log?.isTextBased()) await log.send({ content: `Ticket **${ticket.id}** closed by <@${ticket.closedBy}>. Reason: ${ticket.closeReason}`, files: files.map(file => ({ attachment: file.buffer, name: file.name })), allowedMentions: { parse: [] } }).catch(() => {});
    if (config.dmTranscript) {
        const owner = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
        await owner?.send({ content: `Your ticket **${ticket.id}** in **${interaction.guild.name}** was closed. Reason: ${ticket.closeReason}`, files: files.map(file => ({ attachment: file.buffer, name: file.name })) }).catch(() => {});
    }
    return files;
}

module.exports = {
    adminSubcommands: ['claim', 'assign', 'priority', 'tag', 'note', 'status', 'transfer', 'reopen'],
    data: buildCommand(),
    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        try {
            if (action === 'open') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const created = await createTicket(interaction, interaction.options.getString('topic', true));
                return interaction.editReply(`Ticket created: <#${created.channelId}>`);
            }
            const ticket = store.readState(interaction.guildId).tickets.find(entry => entry.channelId === interaction.channelId);
            if (!ticket) throw new Error('This channel is not a ticket.');
            const admin = isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions);
            if (action === 'reopen') {
                if (!admin || ticket.status !== 'closed') throw new Error('Only an admin can re-open a closed ticket.');
                store.updateTicket(interaction.guildId, ticket.id, { status: 'open', reopenedAt: new Date().toISOString(), reopenedBy: interaction.user.id, closedAt: null, closedBy: null });
                await interaction.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: true }).catch(() => {});
                await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, 'ticket-').slice(0, 100)).catch(() => {});
                notifications.addNotification(ticket.ownerId, { type: 'ticket', title: 'Ticket re-opened', message: `${ticket.id} was re-opened.`, guildId: interaction.guildId, channelId: interaction.channelId });
                return interaction.reply(`Ticket **${ticket.id}** re-opened.`);
            }
            if (ticket.status === 'closed') throw new Error('This ticket is closed.');
            if (['claim', 'assign', 'priority', 'tag', 'note', 'status', 'transfer'].includes(action) && !admin) throw new Error('Only server admins can manage helpdesk state.');
            if (action === 'claim') {
                const at = new Date().toISOString();
                store.updateTicket(interaction.guildId, ticket.id, { claimedBy: interaction.user.id, claimedAt: at, assignedTo: interaction.user.id, firstResponseAt: ticket.firstResponseAt || at });
                return interaction.reply(`Ticket claimed by <@${interaction.user.id}>.`);
            }
            if (action === 'assign') {
                const member = interaction.options.getUser('member', true);
                store.updateTicket(interaction.guildId, ticket.id, { assignedTo: member.id, assignedAt: new Date().toISOString(), assignedBy: interaction.user.id });
                notifications.addNotification(member.id, { type: 'ticket', title: 'Ticket assigned', message: `You were assigned to ${ticket.id}.`, guildId: interaction.guildId, channelId: interaction.channelId });
                return interaction.reply(`Ticket assigned to <@${member.id}>.`);
            }
            if (action === 'priority') {
                const priority = interaction.options.getString('level', true);
                store.updateTicket(interaction.guildId, ticket.id, { priority });
                return interaction.reply(`Priority set to **${priority}**.`);
            }
            if (action === 'tag') {
                const tag = interaction.options.getString('name', true).trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, '').slice(0, 30);
                const tags = new Set(ticket.tags || []);
                interaction.options.getBoolean('remove') ? tags.delete(tag) : tags.add(tag);
                store.updateTicket(interaction.guildId, ticket.id, { tags: [...tags].slice(0, 20) });
                return interaction.reply(`Tags: **${[...tags].join(', ') || 'none'}**.`);
            }
            if (action === 'note') {
                const notes = [...(ticket.internalNotes || []), { authorId: interaction.user.id, text: interaction.options.getString('text', true), createdAt: new Date().toISOString() }].slice(-100);
                store.updateTicket(interaction.guildId, ticket.id, { internalNotes: notes });
                return interaction.reply({ content: 'Internal note saved for staff.', flags: MessageFlags.Ephemeral });
            }
            if (action === 'status') {
                const status = interaction.options.getString('state', true);
                store.updateTicket(interaction.guildId, ticket.id, { status });
                notifications.addNotification(ticket.ownerId, { type: 'ticket', title: 'Ticket status changed', message: `${ticket.id} is now ${status}.`, guildId: interaction.guildId, channelId: interaction.channelId });
                return interaction.reply(`Ticket status: **${status}**.`);
            }
            if (action === 'transfer') {
                const config = moduleConfig(interaction.guildId, 'tickets');
                const team = config.supportTeams.find(entry => entry.id === interaction.options.getString('team', true));
                if (!team) throw new Error('Unknown support-team ID. Configure it in the dashboard first.');
                store.updateTicket(interaction.guildId, ticket.id, { teamId: team.id, transferredAt: new Date().toISOString(), transferredBy: interaction.user.id });
                if (team.categoryId) await interaction.channel.setParent(team.categoryId, { lockPermissions: false }).catch(() => {});
                if (team.roleId) await interaction.channel.permissionOverwrites.edit(team.roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
                return interaction.reply(`Ticket transferred to **${team.name}**.`);
            }
            if (!admin && ticket.ownerId !== interaction.user.id) throw new Error('Only the ticket owner or a server admin can close this ticket.');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const closedAt = new Date().toISOString();
            const updated = store.updateTicket(interaction.guildId, ticket.id, { status: 'closed', closedBy: interaction.user.id, closedAt, firstResponseAt: ticket.firstResponseAt || (admin ? closedAt : null), closeReason: interaction.options.getString('reason') || 'Closed without a reason' });
            const config = moduleConfig(interaction.guildId, 'tickets');
            await publishTranscript(interaction, updated, config);
            await require('../services/workflow-service').runWorkflows(interaction.guild, 'ticket.closed', { userId: ticket.ownerId, channelId: interaction.channelId, ticket: updated }).catch(error => console.warn(`Ticket workflow failed: ${error.message}`));
            notifications.addNotification(ticket.ownerId, { type: 'ticket', title: 'Ticket closed', message: `${ticket.id}: ${updated.closeReason}`, guildId: interaction.guildId });
            await interaction.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false }).catch(() => {});
            await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^ticket-/, '')}`.slice(0, 100)).catch(() => {});
            const workflow = moduleConfig(interaction.guildId, 'workflows');
            if (workflow?.ticketFollowUp && !workflow.dryRun) {
                const rating = await interaction.channel.send({ content: `<@${ticket.ownerId}> rate this support experience from 1️⃣ to 5️⃣.`, allowedMentions: { users: [ticket.ownerId] } }).catch(() => null);
                if (rating) {
                    store.updateTicket(interaction.guildId, ticket.id, { ratingMessageId: rating.id });
                    for (const emoji of ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣']) await rating.react(emoji).catch(() => {});
                }
            }
            await interaction.editReply(`Ticket closed and transcript archived. **Reason:** ${updated.closeReason}`);
            if (config.deleteClosedChannels) setTimeout(() => interaction.channel.delete(`Ticket ${ticket.id} archived`).catch(() => {}), config.deleteDelayMinutes * 60000).unref?.();
        } catch (error) {
            return interaction.deferred ? interaction.editReply(error.message) : interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral });
        }
    },
    publishTranscript
};
