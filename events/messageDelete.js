const { recordModerationEvent } = require('../stores/analytics-store');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'messageDelete',
    execute(message) {
        if (message.guildId && !message.author?.bot) {
            recordModerationEvent(message.guildId, { action: 'message-delete', channelId: message.channelId || null, userId: message.author?.id || null });
            logConfiguredEvent(message.guildId, 'message', { type: 'message-delete', channelId: message.channelId, userId: message.author?.id, summary: 'Message deleted; content was not retained.', metadata: { messageId: message.id, contentStored: false } });
        }
    }
};
