const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getTriggerStats, readAuditLog, getTriggers } = require('../stores/trigger-store');

module.exports = {
    devOnly: true,

    data: new SlashCommandBuilder()
        .setName('triggerinfo')
        .setDescription('Show metadata about a trigger')
        .addStringOption(option =>
            option
                .setName('trigger')
                .setDescription('Trigger phrase to inspect')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const triggerName = interaction.options.getString('trigger').trim();
        const triggers = getTriggers(guildId);

        const match = triggers.find(t =>
            typeof t.trigger === 'string' &&
            t.trigger.toLowerCase() === triggerName.toLowerCase()
        );

        if (!match) {
            return interaction.reply({
                content: `Trigger \"${triggerName}\" was not found.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const addedById = match.addedById || 'unknown';
        const addedByTag = match.addedByTag || 'unknown';
        const addedAt = match.addedAt || 'unknown';
        const uses = getTriggerStats(match.trigger, guildId);
        const audit = readAuditLog(guildId).find(entry =>
            typeof entry.trigger === 'string' &&
            entry.trigger.toLowerCase() === match.trigger.toLowerCase()
        );

        const embed = new EmbedBuilder()
            .setTitle(`Trigger Info: ${match.trigger}`)
            .setColor(0xFF1744)
            .addFields(
                { name: 'Added By', value: `${addedByTag} (${addedById})`, inline: false },
                { name: 'Added At', value: addedAt, inline: true },
                { name: 'Uses', value: String(uses), inline: true }
            );

        if (audit) {
            embed.addFields({
                name: 'Latest Change',
                value: `${audit.action.toUpperCase()} by ${audit.byTag || audit.byId || 'unknown'} at ${audit.at || 'unknown'}`,
                inline: false
            });
        }

        return interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
};
