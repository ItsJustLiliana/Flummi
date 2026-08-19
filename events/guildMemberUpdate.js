const { recordModerationEvent } = require('../stores/analytics-store');

module.exports = {
    name: 'guildMemberUpdate',
    execute(oldMember, newMember) {
        if (newMember.user?.bot) return;
        const before = new Set(oldMember.roles.cache.keys()), after = new Set(newMember.roles.cache.keys());
        const added = [...after].filter(id => !before.has(id)), removed = [...before].filter(id => !after.has(id));
        if (added.length || removed.length) recordModerationEvent(newMember.guild.id, { action: 'role-change', userId: newMember.id, added: added.length, removed: removed.length });
    }
};
