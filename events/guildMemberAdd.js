const { recordModerationEvent } = require('../stores/analytics-store');
const { findUsedInvite } = require('../services/invite-tracker');
const { handleMemberJoin } = require('../services/automod-service');
const { handleMemberAdd } = require('../services/role-service');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        if (member.user?.bot) return;
        recordModerationEvent(member.guild.id, { action: 'member-join', userId: member.id });
        const invite = await findUsedInvite(member.guild);
        if (invite) recordModerationEvent(member.guild.id, { action: 'invite-use', userId: member.id, ...invite });
        logConfiguredEvent(member.guild.id, 'member', { type: 'member-join', userId: member.id, summary: `${member.user.tag} joined`, metadata: { accountCreatedAt: member.user.createdAt?.toISOString() } });
        await handleMemberJoin(member).catch(error => console.warn(`AutoMod join check failed: ${error.message}`));
        await handleMemberAdd(member).catch(error => console.warn(`Onboarding failed: ${error.message}`));
    }
};
