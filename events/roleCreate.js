const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');
module.exports = { name: 'roleCreate', async execute(role) { logConfiguredEvent(role.guild.id, 'member', { type: 'role-create', summary: `Role created: ${role.name}`, metadata: { roleId: role.id } }); await recordAdministrativeAction(role.guild, 'role-create', role); } };
