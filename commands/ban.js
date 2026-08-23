const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runMemberAction } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option => option.setName('member').setDescription('Member to ban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why this member is being banned').setMaxLength(500)),
    execute: interaction => runMemberAction(interaction, 'ban')
};
