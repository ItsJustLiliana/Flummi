const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'messageUpdate',
    execute(oldMessage, newMessage) {
        if (!newMessage.guildId || newMessage.author?.bot || oldMessage.content === newMessage.content) return;
        logConfiguredEvent(newMessage.guildId, 'message', {
            type: 'message-update', channelId: newMessage.channelId, userId: newMessage.author?.id,
            summary: 'Message edited; old and new content were not retained.',
            metadata: { messageId: newMessage.id, contentStored: false }
        });
    }
};
