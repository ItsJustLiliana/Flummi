const { recordModerationEvent } = require('../stores/analytics-store');
const { findUsedInvite } = require('../services/invite-tracker');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        if (member.user?.bot) return;
        recordModerationEvent(member.guild.id, { action: 'member-join', userId: member.id });
        const invite = await findUsedInvite(member.guild);
        if (invite) recordModerationEvent(member.guild.id, { action: 'invite-use', userId: member.id, ...invite });
    }
};
