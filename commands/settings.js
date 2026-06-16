const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { readSettings, writeSettings } = require('../stores/settings-store');
const { isDeveloper } = require('../stores/access-store');

module.exports = {
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('View or edit bot settings')
        .addBooleanOption(option =>
            option.setName('bot-enabled').setDescription('Enable or disable the bot').setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('triggers-enabled').setDescription('[Dev] Enable or disable the trigger response system entirely').setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('cooldown-enabled').setDescription('[Dev] Enable or disable trigger action cooldown').setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('cooldown-time').setDescription('[Dev] Cooldown seconds between trigger actions').setMinValue(0).setMaxValue(3600).setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('exact-match').setDescription('[Dev] Require full message to exactly match a trigger phrase').setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('max-trigger-length').setDescription('[Dev] Max characters allowed in a trigger phrase').setMinValue(1).setMaxValue(500).setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const settings = readSettings(guildId);
        const dev = isDeveloper(interaction.user.id);

        const botEnabled = interaction.options.getBoolean('bot-enabled');
        const triggersEnabled = interaction.options.getBoolean('triggers-enabled');
        const cooldownEnabled = interaction.options.getBoolean('cooldown-enabled');
        const cooldownTime = interaction.options.getInteger('cooldown-time');
        const exactMatch = interaction.options.getBoolean('exact-match');
        const maxTriggerLength = interaction.options.getInteger('max-trigger-length');

        const anyOption = [botEnabled, triggersEnabled, cooldownEnabled, cooldownTime, exactMatch, maxTriggerLength]
            .some(v => v !== null);

        if (!anyOption) {
            const lines = [
                `**bot-enabled**: ${settings.botEnabled}`
            ];

            if (dev) {
                lines.push(
                    `**triggers-enabled**: ${settings.triggersEnabled}`,
                    `**cooldown-enabled**: ${settings.triggerActionCooldownEnabled}`,
                    `**cooldown-time**: ${settings.triggerActionCooldownSeconds}s`,
                    `**exact-match**: ${settings.exactTriggerMatch}`,
                    `**max-trigger-length**: ${settings.maxTriggerLength}`
                );
            }

            return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
        }

        const devOptions = [triggersEnabled, cooldownEnabled, cooldownTime, exactMatch, maxTriggerLength];
        if (!dev && devOptions.some(v => v !== null)) {
            return interaction.reply({
                content: 'You do not have permission to change developer settings.',
                flags: MessageFlags.Ephemeral
            });
        }

        const next = { ...settings };
        const changed = [];

        if (botEnabled !== null) { next.botEnabled = botEnabled; changed.push(`bot-enabled → ${botEnabled}`); }
        if (triggersEnabled !== null) { next.triggersEnabled = triggersEnabled; changed.push(`triggers-enabled → ${triggersEnabled}`); }
        if (cooldownEnabled !== null) { next.triggerActionCooldownEnabled = cooldownEnabled; changed.push(`cooldown-enabled → ${cooldownEnabled}`); }
        if (cooldownTime !== null) { next.triggerActionCooldownSeconds = cooldownTime; changed.push(`cooldown-time → ${cooldownTime}s`); }
        if (exactMatch !== null) { next.exactTriggerMatch = exactMatch; changed.push(`exact-match → ${exactMatch}`); }
        if (maxTriggerLength !== null) { next.maxTriggerLength = maxTriggerLength; changed.push(`max-trigger-length → ${maxTriggerLength}`); }

        writeSettings(next, guildId);

        await interaction.reply({
            content: `Updated:\n${changed.map(c => `• ${c}`).join('\n')}`,
            flags: MessageFlags.Ephemeral
        });
    }
};

