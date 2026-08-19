const { ActivityType } = require('discord.js');
const { readConfig } = require('./config');

const activityTypeMap = {
    Playing: ActivityType.Playing,
    Streaming: ActivityType.Streaming,
    Listening: ActivityType.Listening,
    Watching: ActivityType.Watching,
    Competing: ActivityType.Competing
};

function getConfiguredPresence() {
    const config = readConfig();
    const presenceConfig = config.presence || {};
    const rawActivityType =
        typeof presenceConfig.activityType === 'string'
            ? presenceConfig.activityType.trim()
            : '';
    const disableActivityByType =
        rawActivityType.length === 0 ||
        rawActivityType.toLowerCase() === 'none' ||
        rawActivityType.toLowerCase() === 'off';
    const activityEnabled =
        typeof presenceConfig.activityEnabled === 'boolean'
            ? presenceConfig.activityEnabled
            : !disableActivityByType;
    const activityText =
        typeof presenceConfig.activityText === 'string' && presenceConfig.activityText.trim().length > 0
            ? presenceConfig.activityText.trim()
            : '/help | /addtrigger';
    const activityType = activityTypeMap[rawActivityType] || ActivityType.Playing;
    const status =
        ['online', 'idle', 'dnd', 'invisible'].includes(presenceConfig.status)
            ? presenceConfig.status
            : 'online';

    const activities = activityEnabled
        ? [
            {
                name: activityText,
                type: activityType
            }
        ]
        : [];

    return {
        status,
        activities
    };
}

function applyConfiguredPresence(client) {
    if (!client?.user) {
        return;
    }

    client.user.setPresence(getConfiguredPresence());
}

module.exports = {
    applyConfiguredPresence
};
