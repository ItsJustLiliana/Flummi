const { MessageFlags } = require('discord.js');
const {
    SlashCommandBuilder
} = require('discord.js');
const { canAddTriggers } = require('../stores/access-store');
const { checkCooldown } = require('../utils/cooldowns');
const { readSettings } = require('../stores/settings-store');
const { addTrigger, appendAuditEntry } = require('../stores/trigger-store');

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addtrigger')
        .setDescription('Add a trigger')

        .addStringOption(option =>
            option
                .setName('phrase')
                .setDescription('Trigger phrase')
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName('response')
                .setDescription('Text response')
                .setRequired(false)
        )

        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('Image to send')
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;

        if (!canAddTriggers(interaction.user.id, guildId)) {
            return interaction.reply({
                content: 'You do not have permission to add triggers.',
                flags: MessageFlags.Ephemeral
            });
        }

        const settings = readSettings(guildId);
        if (settings.triggerActionCooldownEnabled) {
            const cooldown = checkCooldown(
                interaction.user.id,
                'trigger-action',
                settings.triggerActionCooldownSeconds
            );

            if (!cooldown.allowed) {
                return interaction.reply({
                    content: `Please wait ${cooldown.remaining} more second(s) before adding another trigger.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        const phrase =
            interaction.options.getString('phrase');

        const response =
            interaction.options.getString('response');

        const image =
            interaction.options.getAttachment('image');

        if (phrase.length > settings.maxTriggerLength) {
            return interaction.reply({
                content: `Trigger phrase cannot exceed ${settings.maxTriggerLength} characters (yours is ${phrase.length}).`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (!response && !image) {
            return interaction.reply({
                content:
                    'You must provide either a response, an image, or both.',
                flags: MessageFlags.Ephemeral
            });
        }

        const result = addTrigger({
            trigger: phrase,
            response: response || null,
            image: image ? image.url : null,
            addedById: interaction.user.id,
            addedByTag: interaction.user.tag,
            addedAt: formatTimestamp(new Date())
        }, guildId);

        if (!result.ok) {
            if (result.reason === 'duplicate') {
                return interaction.reply({
                    content: `Trigger \"${phrase}\" already exists.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (result.reason === 'limit-reached') {
                return interaction.reply({
                    content: 'Trigger limit reached. Delete a trigger before adding another one.',
                    flags: MessageFlags.Ephemeral
                });
            }

            return interaction.reply({
                content: 'Failed to save trigger.',
                flags: MessageFlags.Ephemeral
            });
        }

        appendAuditEntry({
            action: 'add',
            trigger: phrase,
            byId: interaction.user.id,
            byTag: interaction.user.tag,
            at: formatTimestamp(new Date())
        }, guildId);

        await interaction.reply({
            content:
                `Added trigger "${phrase}" successfully.`,
            flags: MessageFlags.Ephemeral
        });
    }
};
