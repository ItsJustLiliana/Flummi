const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'channelDelete', execute(channel) { if (channel.guildId) logConfiguredEvent(channel.guildId, 'member', { type: 'channel-delete', channelId: channel.id, summary: `Channel deleted: ${channel.name}` }); } };
