const { recordModerationEvent } = require('../stores/analytics-store');
const { handleMemberRemove } = require('../services/role-service');
const { logConfiguredEvent } = require('../services/event-log-service');

module.exports = {
    name: 'guildMemberRemove',
    async execute(member) {
        if (!member.user?.bot) recordModerationEvent(member.guild.id, { action: 'member-leave', userId: member.id });
        if (!member.user?.bot) logConfiguredEvent(member.guild.id, 'member', { type: 'member-leave', userId: member.id, summary: `${member.user.tag} left` });
        if (!member.user?.bot) await handleMemberRemove(member).catch(error => console.warn(`Leave automation failed: ${error.message}`));
    }
};
