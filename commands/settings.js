const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { readSettings, writeSettings } = require('../stores/settings-store');
const { isDeveloper } = require('../stores/access-store');

module.exports = {
    managerOnly: true,
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('View or edit bot settings')
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View the current bot settings'))
        .addSubcommand(subcommand => subcommand.setName('bot').setDescription('Enable or disable the bot')
            .addBooleanOption(option => option.setName('enabled').setDescription('Whether the bot is enabled').setRequired(true)))
        .addSubcommand(subcommand => subcommand.setName('triggers').setDescription('Change trigger system settings (developer only)')
            .addBooleanOption(option => option.setName('enabled').setDescription('Enable the trigger response system').setRequired(false))
            .addBooleanOption(option => option.setName('cooldown-enabled').setDescription('Enable the trigger action cooldown').setRequired(false))
            .addIntegerOption(option => option.setName('cooldown-time').setDescription('Cooldown in seconds').setMinValue(0).setMaxValue(3600).setRequired(false))
            .addBooleanOption(option => option.setName('exact-match').setDescription('Require full-message trigger matches').setRequired(false))
            .addIntegerOption(option => option.setName('max-length').setDescription('Maximum trigger phrase length').setMinValue(1).setMaxValue(200).setRequired(false))),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const settings = readSettings(guildId);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const lines = [`**Bot enabled:** ${settings.botEnabled}`];
            if (isDeveloper(interaction.user.id)) {
                lines.push(
                    `**Triggers enabled:** ${settings.triggersEnabled}`,
                    `**Cooldown enabled:** ${settings.triggerActionCooldownEnabled}`,
                    `**Cooldown time:** ${settings.triggerActionCooldownSeconds}s`,
                    `**Exact match:** ${settings.exactTriggerMatch}`,
                    `**Maximum trigger length:** ${settings.maxTriggerLength}`
                );
            }
            return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'bot') {
            const enabled = interaction.options.getBoolean('enabled', true);
            writeSettings({ ...settings, botEnabled: enabled }, guildId);
            return interaction.reply({ content: `Bot enabled → ${enabled}`, flags: MessageFlags.Ephemeral });
        }

        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({ content: 'Only developers can change trigger system settings.', flags: MessageFlags.Ephemeral });
        }

        const options = [
            ['enabled', 'triggersEnabled', 'Triggers enabled'],
            ['cooldown-enabled', 'triggerActionCooldownEnabled', 'Cooldown enabled'],
            ['cooldown-time', 'triggerActionCooldownSeconds', 'Cooldown time'],
            ['exact-match', 'exactTriggerMatch', 'Exact match'],
            ['max-length', 'maxTriggerLength', 'Maximum trigger length']
        ];
        const next = { ...settings };
        const changed = [];
        for (const [optionName, key, label] of options) {
            const value = ['cooldown-time', 'max-length'].includes(optionName)
                ? interaction.options.getInteger(optionName)
                : interaction.options.getBoolean(optionName);
            if (value !== null) {
                next[key] = value;
                changed.push(`${label} → ${value}${optionName === 'cooldown-time' ? 's' : ''}`);
            }
        }
        if (!changed.length) {
            return interaction.reply({ content: 'Choose at least one trigger setting to change.', flags: MessageFlags.Ephemeral });
        }
        writeSettings(next, guildId);
        return interaction.reply({ content: `Updated:\n${changed.map(row => `• ${row}`).join('\n')}`, flags: MessageFlags.Ephemeral });
    }
};
