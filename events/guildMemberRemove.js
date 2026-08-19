const { recordModerationEvent } = require('../stores/analytics-store');

module.exports = {
    name: 'guildMemberRemove',
    execute(member) {
        if (!member.user?.bot) recordModerationEvent(member.guild.id, { action: 'member-leave', userId: member.id });
    }
};
