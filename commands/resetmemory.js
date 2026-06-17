const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isDeveloper } = require('../stores/access-store');
const { clearUserHistory } = require('../stores/user-conversation-store');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetmemory')
        .setDescription('Reset AI memory of yourself')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('[Dev] User whose AI memory should be reset')
                .setRequired(false)
        ),

    async execute(interaction) {
        const dev = isDeveloper(interaction.user.id);
        const targetUser = interaction.options.getUser('user') || interaction.user;

        if (targetUser.id !== interaction.user.id && !dev) {
            return interaction.reply({
                content: 'You can only reset your own memory.',
                flags: MessageFlags.Ephemeral
            });
        }

        clearUserHistory(targetUser.id);

        const content = targetUser.id === interaction.user.id
            ? 'Memory gewist. Ik weet officieel nergens meer van.'
            : `Memory gewist voor ${targetUser.tag}.`;

        return interaction.reply({
            content,
            flags: MessageFlags.Ephemeral
        });
    }
};
