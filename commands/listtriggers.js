const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { getTriggers } = require('../stores/trigger-store');

module.exports = {
    devOnly: true,

    data: new SlashCommandBuilder()
        .setName('triggerlist')
        .setDescription('Shows all triggers')
        .addStringOption(option =>
            option
                .setName('filter')
                .setDescription('Filter by keyword')
                .setRequired(false)
        ),

    async execute(interaction) {
        const triggers = getTriggers(interaction.guildId);

        const filter = interaction.options.getString('filter');

        if (filter) {
            const lower = filter.toLowerCase();
            triggers = triggers.filter(t =>
                typeof t.trigger === 'string' && t.trigger.toLowerCase().includes(lower)
            );
        }

        if (triggers.length === 0) {
            return interaction.reply({
                content: filter ? `No triggers matching "${filter}".` : 'No triggers found.',
                flags: MessageFlags.Ephemeral
            });
        }

        let output = triggers
            .map(t => `- ${t.trigger} → ${t.response || '[image only]'}`)
            .join('\n');

        if (output.length > 1900) {
            output = output.slice(0, 1900) + '\n...and more. Use a filter to narrow results.';
        }

        await interaction.reply({ content: output, flags: MessageFlags.Ephemeral });
    }
};