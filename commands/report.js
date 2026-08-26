const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const reports = require('../stores/abuse-report-store');
const notifications = require('../stores/notification-store');
const { getDeveloperUserIds, isConfiguredDeveloper } = require('../stores/access-store');

const statuses = ['received', 'acknowledged', 'investigating', 'resolved', 'dismissed'];
module.exports = {
    public: true,
    data: new SlashCommandBuilder().setName('report').setDescription('Report abuse, safety, privacy, or policy issues involving Flummi')
        .addSubcommand(command => command.setName('submit').setDescription('Privately submit a report to the Flummi maintainers')
            .addStringOption(option => option.setName('category').setDescription('Issue category').setRequired(true).addChoices(
                { name: 'Safety', value: 'safety' }, { name: 'Harassment or abuse', value: 'abuse' },
                { name: 'Privacy or data', value: 'privacy' }, { name: 'Bot behavior', value: 'bot-behavior' },
                { name: 'Discord policy', value: 'discord-policy' }, { name: 'Other', value: 'other' }
            ))
            .addStringOption(option => option.setName('details').setDescription('Describe what happened').setRequired(true).setMaxLength(1800))
            .addStringOption(option => option.setName('message-link').setDescription('Optional Discord message link').setRequired(false)))
        .addSubcommand(command => command.setName('status').setDescription('Check your report follow-up status')
            .addStringOption(option => option.setName('id').setDescription('Report ID').setRequired(true)))
        .addSubcommand(command => command.setName('update').setDescription('Developer: update a report and notify its reporter')
            .addStringOption(option => option.setName('id').setDescription('Report ID').setRequired(true))
            .addStringOption(option => option.setName('status').setDescription('Review status').setRequired(true).addChoices(...statuses.map(status => ({ name: status, value: status }))))
            .addStringOption(option => option.setName('response').setDescription('Optional follow-up message').setMaxLength(1000))),
    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        if (action === 'submit') {
            const messageLink = interaction.options.getString('message-link') || '';
            if (messageLink && !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+$/i.test(messageLink)) return interaction.reply({ content: 'That is not a valid Discord message link.', flags: MessageFlags.Ephemeral });
            const report = reports.addReport({ reporterId: interaction.user.id, reporterTag: interaction.user.tag, guildId: interaction.guildId, category: interaction.options.getString('category', true), details: interaction.options.getString('details', true), messageLink });
            for (const developerId of getDeveloperUserIds()) {
                notifications.addNotification(developerId, { type: 'abuse-report', title: `New ${report.category} report`, message: `Review report ${report.id}.`, guildId: report.guildId, referenceId: report.id });
            }
            return interaction.reply({ content: `Your private report was received as **${report.id}**.\n\nFollow-up: maintainers triage safety and privacy reports first, then mark reports acknowledged, investigating, resolved, or dismissed. Use \`/report status id:${report.id}\` to check. For immediate danger, contact local emergency services; for Discord-wide violations, also use Discord's built-in report tools.`, flags: MessageFlags.Ephemeral });
        }
        const id = interaction.options.getString('id', true);
        const report = reports.getReport(id);
        if (!report) return interaction.reply({ content: 'Report not found.', flags: MessageFlags.Ephemeral });
        if (action === 'status') {
            if (report.reporterId !== interaction.user.id && !isConfiguredDeveloper(interaction.user.id)) return interaction.reply({ content: 'You cannot view another user’s report.', flags: MessageFlags.Ephemeral });
            return interaction.reply({ content: `**${report.id}**\nCategory: ${report.category}\nStatus: **${report.status}**\nLatest response: ${report.response || 'No maintainer response yet.'}`, flags: MessageFlags.Ephemeral });
        }
        if (!isConfiguredDeveloper(interaction.user.id)) return interaction.reply({ content: 'Only a configured Flummi developer can update abuse reports.', flags: MessageFlags.Ephemeral });
        const status = interaction.options.getString('status', true);
        const response = interaction.options.getString('response') || '';
        const updated = reports.updateReport(id, { status, response, reviewedBy: interaction.user.id });
        notifications.addNotification(updated.reporterId, { type: 'abuse-report', title: `Report ${id}: ${status}`, message: response || `Your report is now ${status}.`, guildId: updated.guildId, referenceId: id });
        return interaction.reply({ content: `Report **${id}** updated to **${status}** and its reporter was notified.`, flags: MessageFlags.Ephemeral });
    }
};
