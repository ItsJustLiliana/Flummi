const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getAllTriggerStats, getTriggers } = require('../stores/trigger-store');

module.exports = {
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('triggerstats')
        .setDescription('Show trigger usage statistics')
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('How many top triggers to show')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const limit = interaction.options.getInteger('limit') || 10;
        const stats = getAllTriggerStats(guildId);
        const triggers = getTriggers(guildId);

        const rows = triggers
            .map(trigger => ({
                name: trigger.trigger,
                count: Number(stats[trigger.trigger.toLowerCase()]) || 0
            }))
            .sort((left, right) => right.count - left.count)
            .slice(0, limit);

        const embed = new EmbedBuilder()
            .setTitle('Trigger Stats')
            .setColor(0xFF1744)
            .setDescription(rows.length
                ? rows.map((row, index) => `${index + 1}. ${row.name} - ${row.count} use(s)`).join('\n')
                : 'No trigger usage data yet.');

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
};
