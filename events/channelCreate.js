const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'channelCreate', execute(channel) { if (channel.guildId) logConfiguredEvent(channel.guildId, 'member', { type: 'channel-create', channelId: channel.id, summary: `Channel created: ${channel.name}` }); } };
