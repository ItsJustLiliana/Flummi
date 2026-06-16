const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { readAuditLog } = require('../stores/trigger-store');

module.exports = {
    devOnly: true,

    data: new SlashCommandBuilder()
        .setName('triggeraudit')
        .setDescription('Show recent trigger changes')
        .addIntegerOption(option =>
            option
                .setName('limit')
                .setDescription('How many entries to show')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)
        ),

    async execute(interaction) {
        const limit = interaction.options.getInteger('limit') || 5;
        const audit = readAuditLog(interaction.guildId).slice(0, limit);

        const embed = new EmbedBuilder()
            .setTitle('Trigger Audit Log')
            .setColor(0xFF1744)
            .setDescription(audit.length
                ? audit.map(entry => {
                    const action = entry.action.toUpperCase();
                    const trigger = entry.trigger || 'unknown';
                    const actor = entry.byTag || entry.byId || 'unknown';
                    const at = entry.at || 'unknown';
                    return `• ${action} ${trigger} by ${actor} at ${at}`;
                }).join('\n')
                : 'No trigger changes recorded yet.');

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
};
