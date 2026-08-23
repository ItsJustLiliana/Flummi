const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove a member timeout')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member whose timeout should be removed').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why the timeout is being removed').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'untimeout')
};
