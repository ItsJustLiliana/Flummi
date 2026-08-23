const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a member')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member to warn').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why this member is being warned').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'warn')
};
