const presets = Object.freeze({
    community: {
        label: 'Community server',
        description: 'Onboarding, suggestions, Starboard, events and community health.',
        management: { modules: { roles: true, automation: true, suggestions: true, starboard: true, communityHealth: true, engagement: true }, roles: { interactiveRoles: true }, automation: { welcomeEnabled: true }, engagement: { polls: true, giveaways: true, levels: true } }
    },
    moderation: {
        label: 'Moderation-first',
        description: 'Balanced AutoMod, cases, join security, reports and incident response.',
        management: { modules: { moderation: true, automod: true, cases: true, joinSecurity: true, reports: true, incidentCenter: true }, automod: { preset: 'balanced', mode: 'test', escalationEnabled: true }, moderation: { requireReason: true, notifyMember: true } }
    },
    support: {
        label: 'Support desk',
        description: 'Tickets, forms, modmail, staff operations and audited workflows.',
        management: { modules: { tickets: true, forms: true, reports: true, workflows: true, staffOperations: true }, reports: { modmailEnabled: true }, workflows: { dryRun: true, ticketFollowUp: true } }
    },
    gaming: {
        label: 'Gaming community',
        description: 'Roles, welcome flows, events, polls, giveaways and voice utilities.',
        management: { modules: { roles: true, automation: true, engagement: true, communityHealth: true }, roles: { persistRoles: true, interactiveRoles: true }, automation: { welcomeEnabled: true }, engagement: { giveaways: true, polls: true, temporaryRoles: true, voiceLinkedRoles: true } }
    }
});

function merge(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    const output = { ...(target && typeof target === 'object' ? target : {}) };
    for (const [key, value] of Object.entries(source)) output[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(output[key], value) : value;
    return output;
}

function withoutDiscordResources(value) {
    if (Array.isArray(value)) return value.map(withoutDiscordResources).filter(item => item !== undefined);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (/Ids?$/.test(key) || ['supportTeams', 'schedules', 'purgeRules'].includes(key)) continue;
        output[key] = withoutDiscordResources(child);
    }
    return output;
}

function applyTemplate(currentManagement, templateManagement) {
    return merge(currentManagement, withoutDiscordResources(templateManagement));
}

module.exports = { applyTemplate, presets, withoutDiscordResources };
