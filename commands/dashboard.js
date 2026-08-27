const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed, createLinkRow } = require('../utils/command-ui');
const { dashboardUrl } = require('../utils/public-links');

module.exports = {
    public: true,

    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Flummi dashboard'),

    async execute(interaction) {
        return interaction.reply({
            embeds: [createCommandEmbed(interaction, { title: 'Flummi Dashboard', description: 'Open the dashboard to manage your servers, view analytics, and access support.' })],
            components: [createLinkRow([{ label: 'Open dashboard', url: dashboardUrl() }])],
            flags: MessageFlags.Ephemeral
        });
    }
};
