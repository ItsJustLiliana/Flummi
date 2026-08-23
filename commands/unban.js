const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runUnban } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user by Discord user ID')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => option.setName('user-id').setDescription('Discord user ID to unban').setRequired(true))
        .addStringOption(option => option.setName('reason').setDescription('Why this user is being unbanned').setMaxLength(500)),
    execute: runUnban
};
