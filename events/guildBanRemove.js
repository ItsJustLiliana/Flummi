const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'guildBanRemove', async execute(ban) { logConfiguredEvent(ban.guild.id, 'member', { type: 'member-unban', userId: ban.user.id, summary: `${ban.user.tag} was unbanned` }); await recordAdministrativeAction(ban.guild, 'member-unban', ban.user); } };
