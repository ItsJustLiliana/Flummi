const { recordModerationEvent } = require('../stores/analytics-store');

module.exports = {
    name: 'messageDelete',
    execute(message) {
        if (message.guildId && !message.author?.bot) recordModerationEvent(message.guildId, { action: 'message-delete', channelId: message.channelId || null, userId: message.author?.id || null });
    }
};
