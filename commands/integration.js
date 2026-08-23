const { SlashCommandBuilder, MessageFlags, AutoModerationRuleTriggerType, AutoModerationRuleEventType, AutoModerationActionType, GuildScheduledEventPrivacyLevel, GuildScheduledEventEntityType } = require('discord.js');
const { moduleConfig } = require('../services/community-management-service');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder().setName('integration').setDescription('Manage native Discord integrations')
        .addSubcommand(command => command.setName('status').setDescription('Show enabled native Discord integrations'))
        .addSubcommand(command => command.setName('sync-automod').setDescription('Create or update Flummi’s native Discord AutoMod keyword rule'))
        .addSubcommand(command => command.setName('create-event').setDescription('Create a native Discord scheduled event').addStringOption(option => option.setName('name').setDescription('Event name').setRequired(true).setMaxLength(100)).addStringOption(option => option.setName('location').setDescription('Event location').setRequired(true).setMaxLength(100)).addIntegerOption(option => option.setName('starts-in').setDescription('Minutes from now').setRequired(true).setMinValue(15).setMaxValue(10080)).addStringOption(option => option.setName('description').setDescription('Event description').setMaxLength(1000))),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'integrations');
        if (!config) return interaction.reply({ content: 'Discord Integrations are not enabled in this server.', flags: MessageFlags.Ephemeral });
        const action = interaction.options.getSubcommand();
        if (action === 'status') return interaction.reply({ content: `Native AutoMod sync: **${config.nativeAutomodEnabled ? 'on' : 'off'}**\nScheduled event tools: **${config.scheduledEventsEnabled ? 'on' : 'off'}**`, flags: MessageFlags.Ephemeral });
        if (action === 'sync-automod') {
            if (!config.nativeAutomodEnabled) return interaction.reply({ content: 'Turn on native AutoMod sync in the dashboard first.', flags: MessageFlags.Ephemeral });
            const management = require('../stores/settings-store').readSettings(interaction.guildId).management;
            if (management.modules.automod) return interaction.reply({ content: 'Turn off Flummi AutoMod before enabling the native Discord rule so messages are not processed twice.', flags: MessageFlags.Ephemeral });
            const blockedTerms = management.automod.blockedTerms;
            if (!blockedTerms.length) return interaction.reply({ content: 'Add blocked terms under AutoMod before syncing.', flags: MessageFlags.Ephemeral });
            const existing = (await interaction.guild.autoModerationRules.fetch()).find(rule => rule.name === 'Flummi blocked terms');
            const data = { name: 'Flummi blocked terms', enabled: true, eventType: AutoModerationRuleEventType.MessageSend, triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { keywordFilter: blockedTerms.slice(0, 1000) }, actions: [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'That message was blocked by this server’s safety settings.' } }], reason: `Synced by ${interaction.user.tag}` };
            if (existing) await existing.edit(data); else await interaction.guild.autoModerationRules.create(data);
            return interaction.reply({ content: `Native Discord AutoMod synced with **${blockedTerms.length}** blocked term(s).`, flags: MessageFlags.Ephemeral });
        }
        if (!config.scheduledEventsEnabled) return interaction.reply({ content: 'Turn on scheduled event tools in the dashboard first.', flags: MessageFlags.Ephemeral });
        const start = Date.now() + interaction.options.getInteger('starts-in') * 60000;
        const event = await interaction.guild.scheduledEvents.create({ name: interaction.options.getString('name'), description: interaction.options.getString('description') || undefined, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly, entityType: GuildScheduledEventEntityType.External, entityMetadata: { location: interaction.options.getString('location') }, scheduledStartTime: new Date(start), scheduledEndTime: new Date(start + 3600000), reason: `Created by ${interaction.user.tag}` });
        return interaction.reply({ content: `Created Discord event **${event.name}**.`, flags: MessageFlags.Ephemeral });
    }
};
