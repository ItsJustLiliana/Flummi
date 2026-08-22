const { recordModerationEvent } = require('../stores/analytics-store');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'guildMemberUpdate',
    execute(oldMember, newMember) {
        if (newMember.user?.bot) return;
        const before = new Set(oldMember.roles.cache.keys()), after = new Set(newMember.roles.cache.keys());
        const added = [...after].filter(id => !before.has(id)), removed = [...before].filter(id => !after.has(id));
        if (added.length || removed.length) {
            recordModerationEvent(newMember.guild.id, { action: 'role-change', userId: newMember.id, added: added.length, removed: removed.length });
            logConfiguredEvent(newMember.guild.id, 'member', { type: 'member-role-change', userId: newMember.id, summary: `Roles changed: +${added.length} -${removed.length}`, metadata: { added, removed } });
        }
        if (oldMember.nickname !== newMember.nickname) logConfiguredEvent(newMember.guild.id, 'member', { type: 'member-nickname-change', userId: newMember.id, summary: `Nickname changed from ${oldMember.nickname || newMember.user.username} to ${newMember.nickname || newMember.user.username}` });
        const oldTimeout = oldMember.communicationDisabledUntilTimestamp || null;
        const newTimeout = newMember.communicationDisabledUntilTimestamp || null;
        if (oldTimeout !== newTimeout) logConfiguredEvent(newMember.guild.id, 'member', { type: 'member-timeout-change', userId: newMember.id, summary: newTimeout ? `Timed out until ${new Date(newTimeout).toISOString()}` : 'Timeout removed' });
    }
};
