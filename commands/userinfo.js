const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { isDeveloper, isManager, getUserPermissions } = require('../stores/access-store');

module.exports = {
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('View permissions and role for a user')
        .addUserOption(option =>
            option.setName('user').setDescription('User to check').setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const targetUser = interaction.options.getUser('user');
        const dev = isDeveloper(targetUser.id);
        const manager = isManager(targetUser.id, guildId);
        const perms = getUserPermissions(targetUser.id, guildId);

        const role = dev ? 'Developer' : manager ? 'Manager' : 'User';

        const embed = new EmbedBuilder()
            .setTitle(`User Info: ${targetUser.tag}`)
            .setColor(dev ? 0xFF1744 : manager ? 0x1E88E5 : 0xFFFFFF)
            .addFields(
                { name: 'Role', value: role, inline: true },
                { name: 'Using Triggers', value: perms.useTriggers ? 'Enabled' : 'Disabled', inline: true },
                { name: 'Adding Triggers', value: perms.addTriggers ? 'Enabled' : 'Disabled', inline: true }
            );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
