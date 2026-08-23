const { recordModerationEvent } = require('../stores/analytics-store');
const { findUsedInvite } = require('../services/invite-tracker');
const { handleMemberAdd } = require('../services/role-service');
const { logConfiguredEvent } = require('../services/event-log-service');
const { handleJoinSecurity, sendConfiguredLog } = require('../services/community-management-service');
const { readSettings } = require('../stores/settings-store');

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
        const management = readSettings(member.guild.id).management;
        const workflow = management.modules.workflows ? management.workflows : null;
        if (workflow?.welcomeReview) {
            const accountAgeDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
            const findings = [];
            if (accountAgeDays < management.joinSecurity.minimumAccountAgeDays) findings.push(`account age ${accountAgeDays}d`);
            if (management.modules.roles && management.roles.autoroleId && !member.roles.cache.has(management.roles.autoroleId) && management.roles.autoroleDelayMinutes === 0) findings.push('expected autorole missing');
            logConfiguredEvent(member.guild.id, 'member', { type: 'workflow-run', userId: member.id, summary: `${workflow.dryRun ? 'Dry run: ' : ''}onboarding review for ${member.user.tag}${findings.length ? ` — ${findings.join(', ')}` : ' — passed'}`, metadata: { workflow: 'welcome-review', findings } });
            if (!workflow.dryRun && findings.length) await sendConfiguredLog(member.guild, management.serverDoctor.logChannelId || management.cases.logChannelId, `🩺 Onboarding review for **${member.user.tag}**: ${findings.join(', ')}.`);
        }
    }
};
