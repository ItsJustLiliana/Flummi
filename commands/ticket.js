const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { isAdmin } = require('../stores/access-store');
const store = require('../stores/community-management-store');
const { createTicket, moduleConfig, sendConfiguredLog } = require('../services/community-management-service');

module.exports = {
    adminSubcommands: ['claim'],
    data: new SlashCommandBuilder().setName('ticket').setDescription('Open and manage support tickets')
        .addSubcommand(command => command.setName('open').setDescription('Open a private support ticket').addStringOption(option => option.setName('topic').setDescription('What do you need help with?').setRequired(true).setMaxLength(500)))
        .addSubcommand(command => command.setName('claim').setDescription('Claim the ticket in this channel'))
        .addSubcommand(command => command.setName('close').setDescription('Close the ticket in this channel').addStringOption(option => option.setName('reason').setDescription('Why this ticket is being closed').setMaxLength(500))),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        try {
            if (subcommand === 'open') {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const ticket = await createTicket(interaction, interaction.options.getString('topic'));
                return interaction.editReply(`Ticket created: <#${ticket.channelId}>`);
            }
            const state = store.readState(interaction.guildId);
            const ticket = state.tickets.find(entry => entry.channelId === interaction.channelId && entry.status === 'open');
            if (!ticket) throw new Error('This channel is not an open ticket.');
            const admin = isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions);
            if (subcommand === 'claim') {
                if (!admin) throw new Error('Only server admins can claim tickets.');
                store.updateTicket(interaction.guildId, ticket.id, { claimedBy: interaction.user.id });
                return interaction.reply(`Ticket claimed by <@${interaction.user.id}>.`);
            }
            if (!admin && ticket.ownerId !== interaction.user.id) throw new Error('Only the ticket owner or a server admin can close this ticket.');
            const reason = interaction.options.getString('reason') || 'Closed without a reason';
            store.updateTicket(interaction.guildId, ticket.id, { status: 'closed', closedBy: interaction.user.id, closeReason: reason });
            await interaction.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false }).catch(() => {});
            await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^ticket-/, '')}`.slice(0, 100)).catch(() => {});
            const config = moduleConfig(interaction.guildId, 'tickets');
            await sendConfiguredLog(interaction.guild, config?.logChannelId, `Ticket **${ticket.id}** closed by <@${interaction.user.id}>: ${reason}`);
            return interaction.reply(`Ticket closed. **Reason:** ${reason}`);
        } catch (error) {
            const payload = { content: error.message, flags: MessageFlags.Ephemeral };
            return interaction.deferred ? interaction.editReply(payload.content) : interaction.reply(payload);
        }
    }
};
