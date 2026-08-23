const { readSettings } = require('../stores/settings-store');
const { sendConfiguredLog } = require('../services/community-management-service');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'guildScheduledEventCreate',
    async execute(event) {
        const management = readSettings(event.guild.id).management;
        const workflow = management.modules.workflows ? management.workflows : null;
        if (!workflow?.eventLaunch) return;
        logConfiguredEvent(event.guild.id, 'member', { type: 'workflow-run', summary: `${workflow.dryRun ? 'Dry run for' : 'Announced'} scheduled event: ${event.name}`, metadata: { workflow: 'event-launch', eventId: event.id } });
        if (workflow.dryRun) return;
        const channelId = management.integrations.announcementChannelId || management.automation.welcomeChannelId;
        await sendConfiguredLog(event.guild, channelId, `📅 **${event.name}** was scheduled.${event.url ? `\n${event.url}` : ''}`);
    }
};
