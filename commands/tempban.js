const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Ban a member for a limited time')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member to temporarily ban').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('For example 3d, 1w, or 2h').setRequired(true).setMaxLength(20))
        .addStringOption(option => option.setName('reason').setDescription('Why this member is being temporarily banned').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'tempban', {
        durationInput: interaction.options.getString('duration', true)
    })
};
