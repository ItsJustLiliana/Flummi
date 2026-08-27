const { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getProfile } = require('../stores/profile-store');
const { getUserMemory } = require('../stores/user-conversation-store');
const { getUserVoiceStats } = require('../stores/voice-store');
const { getUserMessageStats } = require('../stores/server-stats-store');
const operations = require('../stores/operations-store');
const notifications = require('../stores/notification-store');
const { previewUserDeletion } = require('../services/privacy-service');
const { addCorrectionRequest, getCorrectionRequest, updateCorrectionRequest } = require('../stores/privacy-request-store');
const { getDeveloperUserIds, isConfiguredDeveloper } = require('../stores/access-store');
const { disclosure: aiDisclosure, hasAiConsent, setAiConsent } = require('../services/ai-consent-service');

function collect(interaction) {
    const state = operations.readState(interaction.guildId);
    return {
        exportedAt: new Date().toISOString(), userId: interaction.user.id, guildId: interaction.guildId,
        profile: getProfile(interaction.user.id), voice: getUserVoiceStats(interaction.guildId, interaction.user.id),
        messages: getUserMessageStats(interaction.guildId, interaction.user.id),
        aiMemory: getUserMemory(interaction.user.id),
        reminders: state.reminders.filter(entry => entry.userId === interaction.user.id),
        preferences: {}, notifications: notifications.readNotifications(interaction.user.id)
    };
}

module.exports = {
    public: true,
    data: new SlashCommandBuilder().setName('data').setDescription('View or export your stored Flummi data')
        .addSubcommand(command => command.setName('view').setDescription('Show a private summary of your data'))
        .addSubcommand(command => command.setName('export').setDescription('Download your data as JSON'))
        .addSubcommand(command => command.setName('delete').setDescription('Permanently delete your Flummi data from stores and backups'))
        .addSubcommand(command => command.setName('correct').setDescription('Request correction of inaccurate stored data')
            .addStringOption(option => option.setName('category').setDescription('Data category').setRequired(true).addChoices(
                { name: 'Profile', value: 'profile' }, { name: 'Analytics', value: 'analytics' },
                { name: 'Voice', value: 'voice' }, { name: 'Moderation', value: 'moderation' },
                { name: 'Tickets or modmail', value: 'support' }, { name: 'Other', value: 'other' }
            ))
            .addStringOption(option => option.setName('details').setDescription('What is inaccurate and what should it say?').setRequired(true).setMaxLength(1500)))
        .addSubcommand(command => command.setName('correction-status').setDescription('Check the status of your correction request')
            .addStringOption(option => option.setName('id').setDescription('Correction request ID').setRequired(true)))
        .addSubcommand(command => command.setName('correction-update').setDescription('Developer: resolve a correction request')
            .addStringOption(option => option.setName('id').setDescription('Correction request ID').setRequired(true))
            .addStringOption(option => option.setName('status').setDescription('Review status').setRequired(true).addChoices(
                { name: 'Acknowledged', value: 'acknowledged' }, { name: 'Investigating', value: 'investigating' },
                { name: 'Corrected', value: 'corrected' }, { name: 'Rejected', value: 'rejected' }
            ))
            .addStringOption(option => option.setName('response').setDescription('Explanation for the requester').setRequired(true).setMaxLength(1000)))
        .addSubcommand(command => command.setName('ai-consent').setDescription('View, grant, or withdraw consent for external AI processing')
            .addStringOption(option => option.setName('action').setDescription('Consent action').setRequired(true).addChoices(
                { name: 'View status', value: 'status' }, { name: 'Enable AI', value: 'allow' }, { name: 'Withdraw consent', value: 'withdraw' }
            ))),
    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        if (action === 'ai-consent') {
            const choice = interaction.options.getString('action', true);
            if (choice === 'status') return interaction.reply({ content: `${aiDisclosure}\n\nCurrent status: **${hasAiConsent(interaction.user.id) ? 'enabled' : 'disabled'}**.`, flags: MessageFlags.Ephemeral });
            setAiConsent(interaction.user.id, choice === 'allow');
            return interaction.reply({ content: choice === 'allow' ? `${aiDisclosure}\n\nAI processing is now **enabled**.` : 'AI processing is now **disabled**. No future prompts will be sent externally. Use `/resetmemory` or `/data delete` if you also want stored local history removed.', flags: MessageFlags.Ephemeral });
        }
        if (action === 'correct') {
            const request = addCorrectionRequest({
                userId: interaction.user.id, guildId: interaction.guildId,
                category: interaction.options.getString('category', true),
                details: interaction.options.getString('details', true)
            });
            for (const developerId of getDeveloperUserIds()) {
                notifications.addNotification(developerId, { type: 'privacy-correction', title: `Correction request ${request.id}`, message: `Category: ${request.category}`, guildId: request.guildId, referenceId: request.id });
            }
            return interaction.reply({ content: `Correction request **${request.id}** was received. It will be reviewed by the Flummi maintainers; privacy or safety issues are prioritized. You can reference this ID in follow-up.`, flags: MessageFlags.Ephemeral });
        }
        if (action === 'correction-status' || action === 'correction-update') {
            const id = interaction.options.getString('id', true);
            const request = getCorrectionRequest(id);
            if (!request) return interaction.reply({ content: 'Correction request not found.', flags: MessageFlags.Ephemeral });
            if (action === 'correction-status') {
                if (request.userId !== interaction.user.id && !isConfiguredDeveloper(interaction.user.id)) return interaction.reply({ content: 'You cannot view another user\'s correction request.', flags: MessageFlags.Ephemeral });
                return interaction.reply({ content: `**${request.id}**\nCategory: ${request.category}\nStatus: **${request.status}**\nResponse: ${request.response || 'No maintainer response yet.'}`, flags: MessageFlags.Ephemeral });
            }
            if (!isConfiguredDeveloper(interaction.user.id)) return interaction.reply({ content: 'Only a configured Flummi developer can resolve correction requests.', flags: MessageFlags.Ephemeral });
            const updated = updateCorrectionRequest(id, { status: interaction.options.getString('status', true), response: interaction.options.getString('response', true), reviewedBy: interaction.user.id });
            notifications.addNotification(updated.userId, { type: 'privacy-correction', title: `Correction request ${id}: ${updated.status}`, message: updated.response, guildId: updated.guildId, referenceId: id });
            return interaction.reply({ content: `Correction request **${id}** updated to **${updated.status}** and its requester was notified.`, flags: MessageFlags.Ephemeral });
        }
        if (action === 'delete') {
            const preview = previewUserDeletion(interaction.user.id);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`privacy-delete:confirm:${interaction.user.id}`).setLabel('Permanently delete').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`privacy-delete:cancel:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            );
            return interaction.reply({
                content: `**Permanent deletion request**\nThis removes your profile, AI memory, notifications and every reference Flummi can find in server stores, transcripts, logs and stored backups. Moderation and support records containing your ID are removed or de-identified. This cannot be undone.\n\nPreview: ${preview.removedFiles} dedicated file(s) removed and ${preview.rewrittenFiles} shared file(s) rewritten.`,
                components: [row], flags: MessageFlags.Ephemeral
            });
        }
        const data = collect(interaction);
        if (action === 'export') {
            return interaction.reply({ content: 'Your private Flummi data export:', files: [new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), { name: `flummi-data-${interaction.user.id}.json` })], flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({ content: `**Your stored Flummi data**\nProfile: ${data.profile.bio ? 'configured' : 'empty'}\nMessages: ${data.messages.count}\nVoice: ${Math.round((data.voice.totalMs || 0) / 60000)} minutes\nAI memory turns: ${data.aiMemory.history.length}\nReminders: ${data.reminders.length}\nNotifications: ${data.notifications.length}\n\nUse \`/data export\` for the full JSON export.`, flags: MessageFlags.Ephemeral });
    },
    collect
};
