const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'guildBanRemove', execute(ban) { logConfiguredEvent(ban.guild.id, 'member', { type: 'member-unban', userId: ban.user.id, summary: `${ban.user.tag} was unbanned` }); } };
