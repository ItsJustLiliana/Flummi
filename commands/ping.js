const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { readSettings } = require('../stores/settings-store');
const { isDeveloper } = require('../stores/access-store');
const { recordPingMetrics } = require('../stores/ping-metrics-store');
const { createCommandEmbed } = require('../utils/command-ui');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong'),

    async execute(interaction) {
        const settings = readSettings(interaction.guildId);
        const developer = isDeveloper(interaction.user.id);

        if (!developer) {
            return interaction.reply({ embeds: [createCommandEmbed(interaction, {
                title: 'Pong!',
                description: settings.botEnabled ? 'Flummi is online.' : 'Flummi is reachable, but disabled for this server.',
                tone: settings.botEnabled ? 'success' : 'warning'
            })] });
        }

        const receivedAt = Date.now();
        const commandLatency = Math.max(0, receivedAt - interaction.createdTimestamp);
        const gatewayLatency = Number.isFinite(interaction.client.ws.ping)
            ? Math.max(0, Math.round(interaction.client.ws.ping))
            : null;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const acknowledgementLatency = Date.now() - receivedAt;
        recordPingMetrics({ commandLatency, gatewayLatency, acknowledgementLatency });

        await interaction.editReply({ embeds: [createCommandEmbed(interaction, {
            title: 'Connection Diagnostics',
            description: settings.botEnabled ? 'Flummi is online.' : 'Flummi is reachable, but disabled for this server.',
            tone: settings.botEnabled ? 'success' : 'warning'
        }).addFields(
            { name: 'Discord → Flummi', value: `${commandLatency}ms`, inline: true },
            { name: 'Gateway', value: gatewayLatency === null ? 'Unavailable' : `${gatewayLatency}ms`, inline: true },
            { name: 'Acknowledgement', value: `${acknowledgementLatency}ms`, inline: true }
        )] });
    }
};
