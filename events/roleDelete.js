const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'roleDelete', async execute(role) { logConfiguredEvent(role.guild.id, 'member', { type: 'role-delete', summary: `Role deleted: ${role.name}`, metadata: { roleId: role.id } }); await recordAdministrativeAction(role.guild, 'role-delete', role); } };
