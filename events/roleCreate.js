const { logConfiguredEvent } = require('../services/event-log-service');
module.exports = { name: 'roleCreate', execute(role) { logConfiguredEvent(role.guild.id, 'member', { type: 'role-create', summary: `Role created: ${role.name}`, metadata: { roleId: role.id } }); } };
