const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getProfile } = require('../stores/profile-store');
const { getUserMemory } = require('../stores/user-conversation-store');
const { getUserVoiceStats } = require('../stores/voice-store');
const { getShots } = require('../stores/shot-store');
const { getUserMessageStats } = require('../stores/server-stats-store');
const operations = require('../stores/operations-store');
const notifications = require('../stores/notification-store');

function collect(interaction) {
    const state = operations.readState(interaction.guildId);
    return {
        exportedAt: new Date().toISOString(), userId: interaction.user.id, guildId: interaction.guildId,
        profile: getProfile(interaction.user.id), voice: getUserVoiceStats(interaction.guildId, interaction.user.id),
        messages: getUserMessageStats(interaction.guildId, interaction.user.id), shots: getShots(interaction.user.id, interaction.guildId),
        aiMemory: getUserMemory(interaction.user.id),
        reminders: state.reminders.filter(entry => entry.userId === interaction.user.id),
        preferences: {}, notifications: notifications.readNotifications(interaction.user.id)
    };
}

module.exports = {
    public: true,
    data: new SlashCommandBuilder().setName('data').setDescription('View or export your stored Flummi data')
        .addSubcommand(command => command.setName('view').setDescription('Show a private summary of your data'))
        .addSubcommand(command => command.setName('export').setDescription('Download your data as JSON')),
    async execute(interaction) {
        const data = collect(interaction);
        if (interaction.options.getSubcommand() === 'export') {
            return interaction.reply({ content: 'Your private Flummi data export:', files: [new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), { name: `flummi-data-${interaction.user.id}.json` })], flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `**Your stored Flummi data**\nProfile: ${data.profile.bio ? 'configured' : 'empty'}\nMessages: ${data.messages.count}\nVoice: ${Math.round((data.voice.totalMs || 0) / 60000)} minutes\nShots: ${data.shots.total ?? data.shots}\nAI memory turns: ${data.aiMemory.history.length}\nReminders: ${data.reminders.length}\nNotifications: ${data.notifications.length}\n\nUse \`/data export\` for the full JSON export.`, flags: MessageFlags.Ephemeral });
    },
    collect
};
