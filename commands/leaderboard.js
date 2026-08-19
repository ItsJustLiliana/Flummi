const { SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed } = require('../utils/command-ui');
const { getServerStatsSummary } = require('../stores/server-stats-store');
const { getVoiceStatsSummary } = require('../stores/voice-store');

function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function buildLeaderboard({ guildId, category, limit }) {
    const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));

    if (category === 'voice') {
        const rows = getVoiceStatsSummary(guildId, safeLimit);
        return {
            title: 'Voice Time Leaderboard',
            empty: 'No voice activity tracked yet.',
            rows: rows.map((row, index) =>
                `**${index + 1}.** <@${row.id}> — ${formatDuration(row.totalMs)}${row.inVoice ? ' · in VC now' : ''}`
            )
        };
    }

    const rows = getServerStatsSummary(guildId, safeLimit).users;
    return {
        title: 'Message Leaderboard',
        empty: 'No messages tracked yet.',
        rows: rows.map((row, index) =>
            `**${index + 1}.** <@${row.id}> — ${row.count.toLocaleString()} message${row.count === 1 ? '' : 's'}`
        )
    };
}

module.exports = {
    buildLeaderboard,

    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show this server’s message or voice-time leaderboard')
        .addStringOption(option =>
            option
                .setName('category')
                .setDescription('What to rank')
                .setRequired(true)
                .addChoices(
                    { name: 'Messages', value: 'messages' },
                    { name: 'Voice time', value: 'voice' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('How many members to show (default: 10)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)
        ),

    async execute(interaction) {
        const leaderboard = buildLeaderboard({
            guildId: interaction.guildId,
            category: interaction.options.getString('category'),
            limit: interaction.options.getInteger('limit')
        });

        return interaction.reply({
            embeds: [createCommandEmbed(interaction, {
                title: leaderboard.title,
                description: leaderboard.rows.join('\n') || leaderboard.empty,
                tone: 'primary',
                footer: `Top ${Math.max(1, Math.min(25, Number(interaction.options.getInteger('limit')) || 10))} in ${interaction.guild.name}`
            }).setThumbnail(interaction.guild.iconURL({ size: 256 }))]
        });
    }
};
