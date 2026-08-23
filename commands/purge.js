const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { runPurge } = require('../utils/moderation-command');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName('purge')
        .setDescription('Delete recent messages from this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addIntegerOption(option => option.setName('amount').setDescription('Number of messages to delete').setRequired(true).setMinValue(1).setMaxValue(100))
        .addStringOption(option => option.setName('reason').setDescription('Why these messages are being deleted').setMaxLength(500)),
    execute: runPurge
};
