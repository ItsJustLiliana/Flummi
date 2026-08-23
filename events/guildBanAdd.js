const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'guildBanAdd', async execute(ban) { logConfiguredEvent(ban.guild.id, 'member', { type: 'member-ban', userId: ban.user.id, summary: `${ban.user.tag} was banned` }); await recordAdministrativeAction(ban.guild, 'member-ban', ban.user); } };
