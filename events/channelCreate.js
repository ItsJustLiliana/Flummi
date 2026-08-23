const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'channelCreate', async execute(channel) { if (channel.guildId) { logConfiguredEvent(channel.guildId, 'member', { type: 'channel-create', channelId: channel.id, summary: `Channel created: ${channel.name}` }); await recordAdministrativeAction(channel.guild, 'channel-create', channel); } } };
