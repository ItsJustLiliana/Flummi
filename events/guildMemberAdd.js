const { recordModerationEvent } = require('../stores/analytics-store');
const { findUsedInvite } = require('../services/invite-tracker');
const { handleMemberAdd } = require('../services/role-service');
const { logConfiguredEvent } = require('../services/event-log-service');
const { handleJoinSecurity } = require('../services/community-management-service');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        if (member.user?.bot) return;
        recordModerationEvent(member.guild.id, { action: 'member-join', userId: member.id });
        const invite = await findUsedInvite(member.guild);
        if (invite) recordModerationEvent(member.guild.id, { action: 'invite-use', userId: member.id, ...invite });
        logConfiguredEvent(member.guild.id, 'member', { type: 'member-join', userId: member.id, summary: `${member.user.tag} joined`, metadata: { accountCreatedAt: member.user.createdAt?.toISOString() } });
        await handleJoinSecurity(member).catch(error => console.warn(`Join Security check failed: ${error.message}`));
        await handleMemberAdd(member).catch(error => console.warn(`Onboarding failed: ${error.message}`));
    }
};
