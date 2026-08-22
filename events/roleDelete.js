const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'roleDelete', execute(role) { logConfiguredEvent(role.guild.id, 'member', { type: 'role-delete', summary: `Role deleted: ${role.name}`, metadata: { roleId: role.id } }); } };
