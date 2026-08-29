const { readSettings } = require('../stores/settings-store');
const moderation = require('../stores/moderation-store');
const notifications = require('../stores/notification-store');

function valueAt(context, path) { return String(path || '').split('.').reduce((value, key) => value?.[key], context); }
function conditionMatches(condition, context) {
    const actual = valueAt(context, condition.field);
    const expected = condition.value;
    if (condition.operator === 'exists') return actual !== undefined && actual !== null;
    if (condition.operator === 'not-equals') return String(actual) !== String(expected);
    if (condition.operator === 'greater-than') return Number(actual) > Number(expected);
    if (condition.operator === 'less-than') return Number(actual) < Number(expected);
    if (condition.operator === 'includes') return Array.isArray(actual) ? actual.map(String).includes(String(expected)) : String(actual || '').includes(String(expected));
    return String(actual) === String(expected);
}

async function executeAction(guild, action, context, dryRun) {
    if (dryRun) return { type: action.type, dryRun: true };
    const userId = String(action.userId || context.userId || context.member?.id || context.ticket?.ownerId || '');
    if (action.type === 'add-role' && userId && action.roleId) { const member = context.member || await guild.members.fetch(userId); await member.roles.add(String(action.roleId), 'Flummi workflow'); }
    else if (action.type === 'timeout' && userId) { const member = context.member || await guild.members.fetch(userId); await member.timeout(Math.max(1, Number(action.durationMinutes) || 60) * 60000, action.reason || 'Flummi workflow'); }
    else if (action.type === 'staff-alert' && action.channelId) { const channel = guild.channels.cache.get(String(action.channelId)) || await guild.channels.fetch(String(action.channelId)); if (channel?.isTextBased()) await channel.send({ content: String(action.message || `Workflow alert for <@${userId}>`).slice(0, 2000), allowedMentions: { parse: [] } }); }
    else if (action.type === 'send-message' && action.channelId) { const channel = guild.channels.cache.get(String(action.channelId)) || await guild.channels.fetch(String(action.channelId)); if (channel?.isTextBased()) await channel.send({ content: String(action.message || '').slice(0, 2000), allowedMentions: { parse: [] } }); }
    else if (action.type === 'notification' && userId) notifications.addNotification(userId, { type: action.notificationType || 'workflow', title: action.title || 'Workflow update', message: action.message || '', guildId: guild.id, referenceId: context.ticket?.id });
    else if (action.type === 'create-case' && userId) moderation.addCase(guild.id, { action: 'note', targetId: userId, moderatorId: guild.client.user.id, moderatorLabel: 'Flummi workflow', reason: action.reason || 'Workflow-created staff case', source: 'workflow', status: 'completed' });
    return { type: action.type, dryRun: false };
}

async function runWorkflows(guild, event, context = {}) {
    const management = readSettings(guild.id).management;
    if (!management.modules.workflows) return [];
    const results = [];
    for (const rule of management.workflows.rules.filter(rule => rule.enabled && rule.event === event)) {
        if (!rule.conditions.every(condition => conditionMatches(condition, context))) continue;
        const actions = [];
        for (const action of rule.actions) actions.push(await executeAction(guild, action, context, management.workflows.dryRun));
        moderation.addEvent(guild.id, { type: 'workflow-run', userId: context.userId, channelId: context.channelId, summary: `${management.workflows.dryRun ? 'Dry run: ' : ''}${rule.name}`, metadata: { workflowId: rule.id, event, actions } });
        results.push({ ruleId: rule.id, actions });
    }
    return results;
}

function simulateWorkflows(management, event, context = {}) {
    const rules = Array.isArray(management?.workflows?.rules) ? management.workflows.rules : [];
    return rules.filter(rule => rule.enabled && rule.event === event).map(rule => {
        const conditions = (rule.conditions || []).map(condition => ({ ...condition, actual: valueAt(context, condition.field), matched: conditionMatches(condition, context) }));
        const matched = conditions.every(condition => condition.matched);
        return {
            id: rule.id,
            name: rule.name,
            matched,
            conditions,
            actions: (rule.actions || []).map(action => ({ type: action.type, wouldRun: matched, summary: matched ? `Would run ${action.type}` : `Skipped ${action.type}` }))
        };
    });
}

module.exports = { conditionMatches, executeAction, runWorkflows, simulateWorkflows, valueAt };
