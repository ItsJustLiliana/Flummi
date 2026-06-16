const { MessageFlags } = require('discord.js');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const { getTriggers, findTriggerIndex } = require('../stores/trigger-store');

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const pendingRemovals = new Map();

module.exports = {
    managerOnly: true,
    pendingRemovals,

    data: new SlashCommandBuilder()
        .setName('removetrigger')
        .setDescription('Remove an existing trigger by phrase')
        .addStringOption(option =>
            option
                .setName('phrase')
                .setDescription('Exact trigger phrase to remove')
                .setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const phrase = interaction.options.getString('phrase').trim();
        const triggers = getTriggers(guildId);
        const index = findTriggerIndex(triggers, phrase);

        if (index === -1) {
            return interaction.reply({
                content: `Trigger "${phrase}" was not found.`,
                flags: MessageFlags.Ephemeral
            });
        }

        pendingRemovals.set(`${guildId || 'global'}:${interaction.user.id}`, phrase);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('removetrigger:confirm')
                .setLabel('Yes, remove it')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('removetrigger:cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: `Are you sure you want to remove trigger **"${phrase}"**?`,
            components: [row],
            flags: MessageFlags.Ephemeral
        });
    }
};

