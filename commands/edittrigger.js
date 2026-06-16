const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { updateTrigger, appendAuditEntry, findTriggerIndex, getTriggers } = require('../stores/trigger-store');

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = {
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('edittrigger')
        .setDescription('Edit an existing trigger')
        .addStringOption(option =>
            option
                .setName('phrase')
                .setDescription('Trigger phrase to edit')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('response')
                .setDescription('New text response')
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName('image')
                .setDescription('New image to send')
                .setRequired(false)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const phrase = interaction.options.getString('phrase').trim();
        const response = interaction.options.getString('response');
        const image = interaction.options.getAttachment('image');
        const triggers = getTriggers(guildId);
        const index = findTriggerIndex(triggers, phrase);

        if (index === -1) {
            return interaction.reply({
                content: `Trigger \"${phrase}\" was not found.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (response === null && !image) {
            return interaction.reply({
                content: 'Provide a new response, a new image, or both.',
                flags: MessageFlags.Ephemeral
            });
        }

        const nextUpdates = {};

        if (response !== null) {
            nextUpdates.response = response;
        }

        if (image) {
            nextUpdates.image = image.url;
        }

        const result = updateTrigger(phrase, nextUpdates, guildId);

        if (!result.ok) {
            return interaction.reply({
                content: 'Failed to update trigger.',
                flags: MessageFlags.Ephemeral
            });
        }

        appendAuditEntry({
            action: 'edit',
            trigger: result.trigger.trigger,
            byId: interaction.user.id,
            byTag: interaction.user.tag,
            at: formatTimestamp(new Date()),
            changes: nextUpdates
        }, guildId);

        await interaction.reply({
            content: `Updated trigger \"${result.trigger.trigger}\".`,
            flags: MessageFlags.Ephemeral
        });
    }
};
