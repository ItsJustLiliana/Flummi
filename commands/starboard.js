const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { moduleConfig } = require('../services/community-management-service');
const store = require('../stores/community-management-store');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder().setName('starboard').setDescription('View Starboard configuration and activity').addSubcommand(command => command.setName('status').setDescription('Show Starboard setup and post count')),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'starboard');
        if (!config) return interaction.reply({ content: 'Starboard is not enabled in this server.', flags: MessageFlags.Ephemeral });
        const count = Object.keys(store.readState(interaction.guildId).starboard).length;
        const destination = config.channelId ? `<#${config.channelId}>` : '**no channel selected**';
        return interaction.reply({ content: `${config.emoji} Messages reach ${destination} at **${config.threshold}** reactions. **${count}** message(s) have been featured.`, flags: MessageFlags.Ephemeral });
    }
};
