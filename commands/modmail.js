const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const operations = require('../stores/operations-store');
const { notifyModmail } = require('../services/modmail-service');

module.exports = {
    adminSubcommands: ['claim', 'note', 'close', 'reopen', 'block'],
    data: new SlashCommandBuilder().setName('modmail').setDescription('Manage the current modmail conversation')
        .addSubcommand(c => c.setName('claim').setDescription('Claim this conversation'))
        .addSubcommand(c => c.setName('note').setDescription('Add a staff-only note').addStringOption(o => o.setName('text').setDescription('Note').setRequired(true).setMaxLength(1000)))
        .addSubcommand(c => c.setName('close').setDescription('Close this conversation').addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)))
        .addSubcommand(c => c.setName('reopen').setDescription('Re-open this conversation'))
        .addSubcommand(c => c.setName('block').setDescription('Block or unblock this user').addBooleanOption(o => o.setName('blocked').setDescription('Blocked state').setRequired(true))),
    async execute(interaction) {
        const state = operations.readState(interaction.guildId);
        const record = state.modmail.find(entry => entry.channelId === interaction.channelId);
        if (!record) return interaction.reply({ content: 'This is not a modmail channel.', flags: MessageFlags.Ephemeral });
        const action = interaction.options.getSubcommand();
        if (action === 'claim') operations.updateModmail(interaction.guildId, record.id, { claimedBy: interaction.user.id, claimedAt: new Date().toISOString() });
        if (action === 'note') operations.updateModmail(interaction.guildId, record.id, { notes: [...(record.notes || []), { authorId: interaction.user.id, text: interaction.options.getString('text', true), at: new Date().toISOString() }].slice(-100) });
        if (action === 'close') { const reason = interaction.options.getString('reason') || 'Closed by staff'; operations.updateModmail(interaction.guildId, record.id, { status: 'closed', closedBy: interaction.user.id, closedAt: new Date().toISOString(), closeReason: reason }); notifyModmail(record.userId, interaction.guildId, record, 'Modmail closed', reason); }
        if (action === 'reopen') { operations.updateModmail(interaction.guildId, record.id, { status: 'open', reopenedBy: interaction.user.id, reopenedAt: new Date().toISOString() }); notifyModmail(record.userId, interaction.guildId, record, 'Modmail re-opened', 'You can reply to Flummi by DM again.'); }
        if (action === 'block') operations.updateModmail(interaction.guildId, record.id, { blocked: interaction.options.getBoolean('blocked', true) });
        return interaction.reply({ content: `Modmail ${action} updated.`, flags: action === 'note' ? MessageFlags.Ephemeral : undefined });
    }
};
