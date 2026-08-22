const { recordModerationEvent } = require('../stores/analytics-store');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'messageDelete',
    execute(message) {
        if (message.guildId && !message.author?.bot) {
            recordModerationEvent(message.guildId, { action: 'message-delete', channelId: message.channelId || null, userId: message.author?.id || null });
            logConfiguredEvent(message.guildId, 'message', { type: 'message-delete', channelId: message.channelId, userId: message.author?.id, summary: String(message.content || '[content unavailable]').slice(0, 500), metadata: { messageId: message.id } });
        }
    }
};
