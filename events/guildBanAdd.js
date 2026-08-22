const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'guildBanAdd', execute(ban) { logConfiguredEvent(ban.guild.id, 'member', { type: 'member-ban', userId: ban.user.id, summary: `${ban.user.tag} was banned` }); } };
