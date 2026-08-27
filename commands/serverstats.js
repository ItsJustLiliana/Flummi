const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getAllTriggerStats, getTriggers } = require('../stores/trigger-store');
const { getServerStatsSummary } = require('../stores/server-stats-store');
const { COLORS } = require('../utils/command-ui');

function formatRows(rows, formatter) {
    if (!rows.length) {
        return 'No data yet.';
    }

    return rows.map((row, index) => `${index + 1}. ${formatter(row)}`).join('\n');
}

module.exports = {
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('serverstats')
        .setDescription('Show server activity statistics')
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('How many top entries to show')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const limit = interaction.options.getInteger('limit') || 5;
        const summary = getServerStatsSummary(guildId, limit);
        const triggerStats = getAllTriggerStats(guildId);
        const triggerRows = getTriggers(guildId)
            .filter(trigger => typeof trigger.trigger === 'string' && trigger.trigger.trim())
            .map(trigger => ({
                name: trigger.trigger,
                count: Number(triggerStats[trigger.trigger.toLowerCase()]) || 0
            }))
            .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
            .slice(0, limit);

        const embed = new EmbedBuilder()
            .setTitle('Server Stats')
            .setColor(COLORS.staff)
            .addFields(
                { name: 'Messages Tracked', value: String(summary.totalMessages), inline: true },
                {
                    name: 'Most Active Channels',
                    value: formatRows(summary.channels, row => `<#${row.id}> - ${row.count} message(s)`),
                    inline: false
                },
                {
                    name: 'Most Active Members',
                    value: formatRows(summary.users, row => `<@${row.id}> - ${row.count} message(s)`),
                    inline: false
                },
                {
                    name: 'Top Triggers',
                    value: formatRows(triggerRows, row => `${row.name} - ${row.count} use(s)`),
                    inline: false
                }
            );

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
};
