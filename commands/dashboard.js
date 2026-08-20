const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const publicDashboardUrl = 'https://flummi.liliananuzohra.com/';

module.exports = {
    public: true,

    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('Open the Flummi dashboard'),

    async execute(interaction) {
        return interaction.reply({
            content: `Flummi dashboard: ${publicDashboardUrl}`,
            flags: MessageFlags.Ephemeral
        });
    }
};
