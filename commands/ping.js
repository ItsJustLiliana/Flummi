const { SlashCommandBuilder } = require('discord.js');
const { readSettings } = require('../stores/settings-store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong'),

    async execute(interaction) {
        const settings = readSettings(interaction.guildId);

        if (!settings.botEnabled) {
            return interaction.reply('The bot is disabled right now, but Pong!');
        }

        await interaction.reply('Pong!');
    }
};