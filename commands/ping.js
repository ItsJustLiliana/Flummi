const { SlashCommandBuilder } = require('discord.js');
const { readSettings } = require('../stores/settings-store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong'),

    async execute(interaction) {
        const settings = readSettings(interaction.guildId);
        const commandLatency = Math.max(0, Date.now() - interaction.createdTimestamp);
        const gatewayLatency = Number.isFinite(interaction.client.ws.ping)
            ? Math.max(0, Math.round(interaction.client.ws.ping))
            : null;
        const latency = `Command: **${commandLatency}ms**${gatewayLatency === null ? '' : ` • Gateway: **${gatewayLatency}ms**`}`;

        if (!settings.botEnabled) {
            return interaction.reply(`The bot is disabled right now, but Pong! 🏓\n${latency}`);
        }

        await interaction.reply(`Pong! 🏓\n${latency}`);
    }
};
