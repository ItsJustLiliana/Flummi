const { SlashCommandBuilder, MessageFlags, GuildVerificationLevel } = require('discord.js');
const { moduleConfig } = require('../services/community-management-service');
const store = require('../stores/community-management-store');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder().setName('security').setDescription('Manage join protection')
        .addSubcommand(command => command.setName('status').setDescription('Show the current join protection settings'))
        .addSubcommand(command => command.setName('lockdown').setDescription('Raise Discord verification during a raid'))
        .addSubcommand(command => command.setName('unlock').setDescription('Return Discord verification to medium')),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'joinSecurity');
        if (!config) return interaction.reply({ content: 'Join Security is not enabled in this server.', flags: MessageFlags.Ephemeral });
        const action = interaction.options.getSubcommand();
        if (action === 'status') return interaction.reply({ content: `Join Security is on. Accounts younger than **${config.minimumAccountAgeDays} day(s)** are flagged; burst threshold is **${config.joinBurstLimit} joins / ${config.joinBurstWindowSeconds}s**; action is **${config.action}**.`, flags: MessageFlags.Ephemeral });
        if (action === 'lockdown') {
            store.setSecurityState(interaction.guildId, { previousVerificationLevel: interaction.guild.verificationLevel, lockedDownAt: new Date().toISOString() });
            await interaction.guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, `Join Security lockdown by ${interaction.user.tag}`);
            return interaction.reply({ content: '🔒 Lockdown enabled. Discord verification is now at the highest level.', flags: MessageFlags.Ephemeral });
        }
        const previous = store.readState(interaction.guildId).security.previousVerificationLevel;
        const restoreLevel = Number.isInteger(previous) ? previous : GuildVerificationLevel.Medium;
        await interaction.guild.setVerificationLevel(restoreLevel, `Join Security unlock by ${interaction.user.tag}`);
        store.setSecurityState(interaction.guildId, { previousVerificationLevel: null, lockedDownAt: null });
        return interaction.reply({ content: '🔓 Lockdown ended. The previous Discord verification level was restored.', flags: MessageFlags.Ephemeral });
    }
};
