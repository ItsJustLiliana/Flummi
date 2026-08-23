const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');

module.exports = {
    name: 'roleUpdate',
    async execute(oldRole, newRole) {
        const changed = oldRole.name !== newRole.name
            || oldRole.color !== newRole.color
            || oldRole.permissions.bitfield !== newRole.permissions.bitfield;
        if (!changed) return;
        logConfiguredEvent(newRole.guild.id, 'member', { type: 'role-update', summary: `Role updated: ${oldRole.name} → ${newRole.name}`, metadata: { roleId: newRole.id } });
        await recordAdministrativeAction(newRole.guild, 'role-update', newRole);
    }
};
