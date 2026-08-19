const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { readSettings } = require('../stores/settings-store');
const { isDeveloper } = require('../stores/access-store');
const { recordPingMetrics } = require('../stores/ping-metrics-store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong'),

    async execute(interaction) {
        const settings = readSettings(interaction.guildId);
        const developer = isDeveloper(interaction.user.id);

        if (!developer) {
            return interaction.reply(settings.botEnabled ? 'Pong! 🏓' : 'The bot is disabled right now, but Pong! 🏓');
        }

        const receivedAt = Date.now();
        const commandLatency = Math.max(0, receivedAt - interaction.createdTimestamp);
        const gatewayLatency = Number.isFinite(interaction.client.ws.ping)
            ? Math.max(0, Math.round(interaction.client.ws.ping))
            : null;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const acknowledgementLatency = Date.now() - receivedAt;
        recordPingMetrics({ commandLatency, gatewayLatency, acknowledgementLatency });

        await interaction.editReply([
            settings.botEnabled ? 'Pong! 🏓' : 'The bot is disabled right now, but Pong! 🏓',
            `**Discord → Flummi:** ${commandLatency}ms`,
            `**Gateway:** ${gatewayLatency === null ? 'Unavailable' : `${gatewayLatency}ms`}`,
            `**Discord acknowledgement:** ${acknowledgementLatency}ms`
        ].join('\n'));
    }
};
