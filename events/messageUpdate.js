const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'messageUpdate',
    execute(oldMessage, newMessage) {
        if (!newMessage.guildId || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
        logConfiguredEvent(newMessage.guildId, 'message', {
            type: 'message-update', channelId: newMessage.channelId, userId: newMessage.author?.id,
            summary: `${String(oldMessage.content || '[unavailable]').slice(0, 240)} → ${String(newMessage.content || '[unavailable]').slice(0, 240)}`,
            metadata: { messageId: newMessage.id }
        });
    }
};
