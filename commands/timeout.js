const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('Temporarily stop a member from interacting')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member to time out').setRequired(true))
        .addStringOption(option => option.setName('duration').setDescription('For example 30m, 2h, or 1d; optional').setMaxLength(20))
        .addStringOption(option => option.setName('reason').setDescription('Why this member is being timed out').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'timeout', {
        durationInput: interaction.options.getString('duration')
    })
};
