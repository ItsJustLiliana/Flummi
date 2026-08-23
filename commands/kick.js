const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member to kick').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why this member is being kicked').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'kick')
};
