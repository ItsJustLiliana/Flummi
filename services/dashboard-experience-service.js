const operationsStore = require('../stores/operations-store');
const communityStore = require('../stores/community-management-store');

const moduleDependencies = Object.freeze({
    staffOperations: ['cases'],
    copilot: ['tickets', 'reports'],
    workflows: ['automation'],
    communityHealth: ['serverDoctor']
});

const moduleRequiredFields = Object.freeze({
    automod: [['automod.logChannelId', 'Choose an AutoMod log channel.']],
    cases: [['cases.logChannelId', 'Choose a moderation log channel.']],
    roles: [['roles.onboardingChannelId', 'Choose a role-menu channel.']],
    tickets: [['tickets.categoryId', 'Choose a ticket category.'], ['tickets.supportRoleId', 'Choose a support role.']],
    suggestions: [['suggestions.channelId', 'Choose a suggestions channel.']],
    starboard: [['starboard.channelId', 'Choose a Starboard channel.']],
    forms: [['forms.reviewChannelId', 'Choose a form-review channel.']]
});

function readPath(source, field) {
    return String(field).split('.').reduce((value, key) => value?.[key], source);
}

function labelModule(key) {
    return String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase());
}

function validateManagement(guild, management = {}) {
    const errors = [];
    const warnings = [];
    const modules = management.modules || {};
    const channels = guild?.channels?.cache || new Map();
    const roles = guild?.roles?.cache || new Map();
    const seen = new Set();

    function inspect(value, path = '') {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            const field = path ? `${path}.${key}` : key;
            if (typeof child === 'string' && child && /ChannelId$|CategoryId$/i.test(key) && !channels.has(child)) {
                const signature = `channel:${field}`;
                if (!seen.has(signature)) warnings.push({ code: 'missing-channel', field, message: `${field} points to a channel that is no longer available.` });
                seen.add(signature);
            }
            if (typeof child === 'string' && child && /RoleId$/i.test(key) && !roles.has(child)) {
                const signature = `role:${field}`;
                if (!seen.has(signature)) warnings.push({ code: 'missing-role', field, message: `${field} points to a role that is no longer available.` });
                seen.add(signature);
            }
            if (Array.isArray(child) && /ChannelIds$/i.test(key)) {
                const missing = child.filter(id => id && !channels.has(id));
                if (missing.length) warnings.push({ code: 'missing-channel', field, count: missing.length, message: `${field} contains ${missing.length} channel${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'is' : 'are'} no longer available.` });
            }
            if (Array.isArray(child) && /RoleIds$/i.test(key)) {
                const missing = child.filter(id => id && !roles.has(id));
                if (missing.length) warnings.push({ code: 'missing-role', field, count: missing.length, message: `${field} contains ${missing.length} role${missing.length === 1 ? '' : 's'} that ${missing.length === 1 ? 'is' : 'are'} no longer available.` });
            }
            inspect(child, field);
        }
    }
    inspect(management);

    for (const [moduleKey, required] of Object.entries(moduleRequiredFields)) {
        if (!modules[moduleKey]) continue;
        for (const [field, message] of required) if (!readPath(management, field)) warnings.push({ code: 'required-setting', module: moduleKey, field, message });
    }
    for (const [moduleKey, dependencies] of Object.entries(moduleDependencies)) {
        if (!modules[moduleKey]) continue;
        const missing = dependencies.filter(key => !modules[key]);
        if (missing.length) warnings.push({ code: 'module-dependency', module: moduleKey, dependencies: missing, message: `${labelModule(moduleKey)} works best with ${missing.map(labelModule).join(' and ')} enabled.` });
    }
    if (management.automod?.mode === 'enforce' && !Object.values(management.automod?.rules || {}).some(rule => rule?.enabled)) warnings.push({ code: 'empty-automod', module: 'automod', message: 'AutoMod is in enforce mode, but no individual filters are enabled.' });
    if (modules.workflows && !(management.workflows?.rules || []).some(rule => rule?.enabled)) warnings.push({ code: 'empty-workflows', module: 'workflows', message: 'Workflow Studio is enabled, but no workflow rules are active.' });
    return { ok: errors.length === 0, errors, warnings, dependencies: moduleDependencies };
}

function buildAttentionCenter(guildId, doctor, management = {}) {
    const operations = operationsStore.readState(guildId);
    const community = communityStore.readState(guildId);
    const items = [];
    const add = (type, severity, title, count, tab, detail) => { if (count) items.push({ type, severity, title, count, tab, detail }); };
    add('reports', 'high', 'Open reports', operations.reports.filter(row => !['resolved', 'dismissed'].includes(row.status)).length, 'management-reports', 'Review member reports and assign an owner.');
    add('tickets', 'medium', 'Waiting tickets', community.tickets.filter(row => !['closed', 'resolved'].includes(row.status)).length, 'management-staff-operations', 'Reply to or close outstanding support requests.');
    add('incidents', 'high', 'Active incidents', operations.incidents.filter(row => row.status !== 'resolved').length, 'management-incident-center', 'Investigate active security incidents.');
    add('delivery', 'high', 'Failed deliveries', [...operations.reminders, ...operations.feeds, ...operations.temporaryRoles].filter(row => row.status === 'failed' || row.lastError).length, 'management-engagement', 'Check failed reminders, feeds, or temporary-role actions.');
    add('doctor', 'high', 'Critical server checks', (doctor?.checks || []).filter(row => row.severity === 'critical').length, 'management-server-doctor', 'Resolve permission or resource problems.');
    const missingDependencies = Object.entries(moduleDependencies).flatMap(([module, dependencies]) => management.modules?.[module] ? dependencies.filter(key => !management.modules?.[key]).map(dependency => ({ module, dependency })) : []);
    add('dependencies', 'medium', 'Incomplete module connections', missingDependencies.length, 'management', 'Review enabled modules that depend on another module.');
    return items.sort((left, right) => ({ high: 0, medium: 1, low: 2 })[left.severity] - ({ high: 0, medium: 1, low: 2 })[right.severity]);
}

module.exports = { buildAttentionCenter, labelModule, moduleDependencies, validateManagement };
