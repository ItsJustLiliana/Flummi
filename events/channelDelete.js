const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'channelDelete', async execute(channel) { if (channel.guildId) { logConfiguredEvent(channel.guildId, 'member', { type: 'channel-delete', channelId: channel.id, summary: `Channel deleted: ${channel.name}` }); await recordAdministrativeAction(channel.guild, 'channel-delete', channel); } } };
