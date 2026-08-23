const { SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed } = require('../utils/command-ui');
const { getServerStatsSummary } = require('../stores/server-stats-store');
const { getVoiceStatsSummary } = require('../stores/voice-store');
const { getGlobalShotLeaderboard, getShotLeaderboard } = require('../stores/shot-store');
const { getMediaUsageSummary, getSoundboardSummary } = require('../stores/analytics-store');

function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function buildLeaderboard({ guildId, category, limit, scope = 'guild', mediaType = 'soundboard', days = 30 }) {
    const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));

    if (category === 'voice') {
        const rows = getVoiceStatsSummary(guildId, safeLimit);
        return { title: 'Voice Time Leaderboard', empty: 'No voice activity tracked yet.', rows: rows.map((row, index) =>
            `**${index + 1}.** <@${row.id}> — ${formatDuration(row.totalMs)}${row.inVoice ? ' · in VC now' : ''}`) };
    }

    if (category === 'shots') {
        const rows = scope === 'global' ? getGlobalShotLeaderboard(safeLimit) : getShotLeaderboard(guildId, safeLimit);
        return { title: scope === 'global' ? 'Global Shot Leaderboard' : 'Shot Leaderboard', empty: 'No shot totals recorded yet.', rows: rows.map((row, index) =>
            `**${index + 1}.** <@${row.userId}> — ${row.total} shot${row.total === 1 ? '' : 's'}${scope === 'global' ? ` · ${row.guildCount} server${row.guildCount === 1 ? '' : 's'}` : ''}`) };
    }

    if (category === 'media') {
        let items;
        let title;
        if (mediaType === 'soundboard') {
            items = getSoundboardSummary(guildId, days).itemDetails;
            title = 'Soundboard Leaderboard';
        } else {
            const summary = getMediaUsageSummary(guildId, days);
            items = mediaType === 'stickers' ? summary.stickers : summary.emojis;
            title = mediaType === 'stickers' ? 'Sticker Leaderboard' : 'Custom Emoji Leaderboard';
        }
        return { title, empty: `No ${mediaType} usage tracked for this period.`, rows: items.slice(0, safeLimit).map((row, index) =>
            `**${index + 1}.** \`${row.id}\` — ${row.count.toLocaleString()} use${row.count === 1 ? '' : 's'}`) };
    }

    const rows = getServerStatsSummary(guildId, safeLimit).users;
    return { title: 'Message Leaderboard', empty: 'No messages tracked yet.', rows: rows.map((row, index) =>
        `**${index + 1}.** <@${row.id}> — ${row.count.toLocaleString()} message${row.count === 1 ? '' : 's'}`) };
}

const limitOption = option => option.setName('limit').setDescription('Number to show (default: 10)')
    .setMinValue(1).setMaxValue(25).setRequired(false);

module.exports = {
    buildLeaderboard,
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show server leaderboards')
        .addSubcommand(subcommand => subcommand.setName('messages').setDescription('Rank members by messages').addIntegerOption(limitOption))
        .addSubcommand(subcommand => subcommand.setName('voice').setDescription('Rank members by voice time').addIntegerOption(limitOption))
        .addSubcommand(subcommand => subcommand.setName('shots').setDescription('Rank members by shot totals')
            .addStringOption(option => option.setName('scope').setDescription('Server or global totals').setRequired(false)
                .addChoices({ name: 'Server', value: 'guild' }, { name: 'Global', value: 'global' }))
            .addIntegerOption(limitOption))
        .addSubcommand(subcommand => subcommand.setName('media').setDescription('Rank soundboard, emoji, or sticker usage')
            .addStringOption(option => option.setName('type').setDescription('Media type').setRequired(true)
                .addChoices({ name: 'Soundboard', value: 'soundboard' }, { name: 'Custom emojis', value: 'emojis' }, { name: 'Stickers', value: 'stickers' }))
            .addIntegerOption(option => option.setName('days').setDescription('Period in days (default: 30)').setMinValue(1).setMaxValue(365).setRequired(false))
            .addIntegerOption(limitOption)),

    async execute(interaction) {
        const limit = interaction.options.getInteger('limit');
        const leaderboard = buildLeaderboard({
            guildId: interaction.guildId,
            category: interaction.options.getSubcommand(),
            limit,
            scope: interaction.options.getString('scope') || 'guild',
            mediaType: interaction.options.getString('type') || 'soundboard',
            days: interaction.options.getInteger('days') || 30
        });
        return interaction.reply({ embeds: [createCommandEmbed(interaction, {
            title: leaderboard.title,
            description: leaderboard.rows.join('\n') || leaderboard.empty,
            tone: 'primary',
            footer: `Top ${Math.max(1, Math.min(25, Number(limit) || 10))} in ${interaction.guild.name}`
        }).setThumbnail(interaction.guild.iconURL({ size: 256 }))] });
    }
};
