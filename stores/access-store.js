const fs = require('fs');
const path = require('path');
const { readConfig } = require('../utils/config');
const config = readConfig();

const dataDir = path.join(__dirname, '..', 'data');
const roleSimulationPath = path.join(dataDir, 'runtime', 'developer-role-simulations.json');
const guildOwnerCache = new Map();

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function resolveGuildPaths(guildId) {
    if (!guildId) {
        return null;
    }

    const base = path.join(dataDir, 'guilds', String(guildId));

    return {
        userPermissions: path.join(base, 'userPermissions.json'),
        owner: path.join(base, 'owner.json')
    };
}

function getGuildOwnerUserId(guildId) {
    const guildPaths = resolveGuildPaths(guildId);
    if (!guildPaths) return null;
    const cacheKey = String(guildId);
    if (guildOwnerCache.has(cacheKey)) return guildOwnerCache.get(cacheKey);
    const record = readJson(guildPaths.owner, null);
    const ownerId = typeof record === 'string' ? record : (record?.userId ? String(record.userId) : null);
    guildOwnerCache.set(cacheKey, ownerId);
    return ownerId;
}

function setGuildOwner(guildId, userId) {
    const guildPaths = resolveGuildPaths(guildId);
    if (!guildPaths || !userId) return null;
    const normalizedUserId = String(userId);
    const cacheKey = String(guildId);
    if (getGuildOwnerUserId(guildId) !== normalizedUserId) {
        writeJson(guildPaths.owner, { userId: normalizedUserId, updatedAt: new Date().toISOString() });
    }
    guildOwnerCache.set(cacheKey, normalizedUserId);
    return normalizedUserId;
}

function isGuildOwner(userId, guildId) {
    const ownerId = getGuildOwnerUserId(guildId);
    return Boolean(ownerId && ownerId === String(userId));
}

function getDeveloperUserIds() {
    return Array.from(new Set([
        ...(Array.isArray(config.developerUserIds) ? config.developerUserIds : []),
        ...(config.developerUserId ? [config.developerUserId] : [])
    ].map(String)));
}

function isConfiguredDeveloper(userId) {
    return getDeveloperUserIds().includes(String(userId));
}

function readDeveloperRoleSimulations() {
    const simulations = readJson(roleSimulationPath, {});
    return simulations && typeof simulations === 'object' && !Array.isArray(simulations) ? simulations : {};
}

function getDeveloperRoleSimulation(userId) {
    if (!isConfiguredDeveloper(userId)) return null;
    const simulations = readDeveloperRoleSimulations();
    const simulation = simulations[String(userId)];
    if (!simulation) return null;
    const role = normalizeRole(simulation.role, '');
    if (!['admin', 'member'].includes(role)) return null;
    if (!simulation.expiresAt || new Date(simulation.expiresAt).getTime() <= Date.now()) {
        delete simulations[String(userId)];
        writeJson(roleSimulationPath, simulations);
        return null;
    }
    return { ...simulation, role };
}

function setDeveloperRoleSimulation(userId, role, durationMs = 2 * 60 * 60 * 1000) {
    if (!isConfiguredDeveloper(userId)) throw new Error('Only configured developers can simulate a Discord role.');
    const simulations = readDeveloperRoleSimulations();
    const normalizedRole = String(role || '').toLowerCase();
    if (normalizedRole === 'developer') {
        delete simulations[String(userId)];
        writeJson(roleSimulationPath, simulations);
        return null;
    }
    if (!['admin', 'member'].includes(normalizedRole)) throw new Error('Role must be developer, admin, or member.');
    const simulation = { role: normalizedRole, expiresAt: new Date(Date.now() + durationMs).toISOString() };
    simulations[String(userId)] = simulation;
    writeJson(roleSimulationPath, simulations);
    return simulation;
}

function isDeveloper(userId) {
    return isConfiguredDeveloper(userId) && !getDeveloperRoleSimulation(userId);
}

function hasAdministratorPermission(memberPermissions) {
    if (!memberPermissions) return false;
    if (typeof memberPermissions.has === 'function') {
        try { return memberPermissions.has('Administrator'); } catch { return false; }
    }
    try { return (BigInt(memberPermissions) & 8n) === 8n; } catch { return false; }
}

function isAdmin(userId, guildId, memberPermissions = null) {
    if (isGuildOwner(userId, guildId)) return true;
    const simulation = getDeveloperRoleSimulation(userId);
    if (simulation) return simulation.role === 'admin';
    return isDeveloper(userId) || hasAdministratorPermission(memberPermissions);
}

function getUserRole(userId, guildId, memberPermissions = null) {
    const simulation = getDeveloperRoleSimulation(userId);
    if (simulation) return simulation.role;
    if (isDeveloper(userId)) {
        return 'developer';
    }

    if (isAdmin(userId, guildId, memberPermissions)) {
        return 'admin';
    }

    return 'member';
}

function normalizeRole(role, fallbackRole = 'member') {
    const normalized = String(role || '').trim().toLowerCase();

    if (normalized === 'user') return 'member';
    if (normalized === 'manager' || normalized === 'owner') return 'admin';
    if (['member', 'admin', 'developer'].includes(normalized)) return normalized;

    return fallbackRole;
}

function roleMeetsRequirement(userRole, requiredRole) {
    const ranks = {
        member: 0,
        admin: 1,
        developer: 2
    };

    return ranks[normalizeRole(userRole)] >= ranks[normalizeRole(requiredRole)];
}

function getCommandPath(interaction) {
    const commandName = interaction?.commandName;

    if (!commandName) {
        return '';
    }

    let subcommand = null;

    try {
        const group = interaction.options?.getSubcommandGroup(false);
        subcommand = interaction.options?.getSubcommand(false);

        if (group && subcommand) {
            return `${commandName}.${group}.${subcommand}`;
        }
    } catch {
        subcommand = null;
    }

    return subcommand ? `${commandName}.${subcommand}` : commandName;
}

function getRequiredCommandRole(commandName, subcommandName, commandDefinition, subcommandGroupName = null) {
    if (commandDefinition?.public) {
        return 'member';
    }

    const permissions = config.commandPermissions || {};
    const commandKey = String(commandName || '');
    const groupKey = subcommandGroupName ? `${commandKey}.${subcommandGroupName}` : null;
    const subcommandKey = subcommandName
        ? subcommandGroupName
            ? `${commandKey}.${subcommandGroupName}.${subcommandName}`
            : `${commandKey}.${subcommandName}`
        : null;

    if (subcommandKey && permissions[subcommandKey]) {
        return normalizeRole(permissions[subcommandKey]);
    }

    if (groupKey && permissions[groupKey]) {
        return normalizeRole(permissions[groupKey]);
    }

    if (permissions[commandKey]) {
        return normalizeRole(permissions[commandKey]);
    }

    const subcommandPath = subcommandName
        ? subcommandGroupName ? `${subcommandGroupName}.${subcommandName}` : subcommandName
        : null;
    if (subcommandPath && commandDefinition?.adminSubcommands?.includes(subcommandPath)) {
        return 'admin';
    }

    if (commandDefinition?.devOnly) {
        return 'developer';
    }

    if (commandDefinition?.adminOnly) {
        return 'admin';
    }

    return 'member';
}

function setCommandPermissions(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    config.commandPermissions = Object.fromEntries(Object.entries(source).map(([commandPath, role]) => [commandPath, normalizeRole(role)]));
    return { ...config.commandPermissions };
}

function canUseCommandPath({ userId, guildId, commandName, subcommandName, commandDefinition, subcommandGroupName = null, memberPermissions = null }) {
    const requiredRole = getRequiredCommandRole(commandName, subcommandName, commandDefinition, subcommandGroupName);
    const userRole = getUserRole(userId, guildId, memberPermissions);

    return {
        allowed: roleMeetsRequirement(userRole, requiredRole),
        requiredRole,
        userRole,
        override: null
    };
}

function isTriggerFeatureEnabled() {
    const featureConfig = config.features || {};

    return featureConfig.triggersEnabled !== false;
}

function getPermissionRecord(guildId) {
    const guildPaths = resolveGuildPaths(guildId);
    const record = guildPaths
        ? readJson(guildPaths.userPermissions, {})
        : {};
    return record && typeof record === 'object' && !Array.isArray(record)
        ? record
        : {};
}

function getUserPermissions(userId, guildId) {
    if (isDeveloper(userId)) {
        return {
            useTriggers: true,
            addTriggers: true,
            useAiChat: true,
            useBotMentions: true,
            savePingRequests: true
        };
    }

    const record = getPermissionRecord(guildId);
    const entry = record[userId] || {};
    return {
        useTriggers: entry.useTriggers !== false,
        addTriggers: entry.addTriggers !== false,
        useAiChat: entry.useAiChat !== false,
        useBotMentions: entry.useBotMentions !== false,
        savePingRequests: entry.savePingRequests !== false
    };
}

function setUserPermission(userId, permissionKey, value, guildId) {
    if (isDeveloper(userId)) {
        return;
    }

    const guildPaths = resolveGuildPaths(guildId);

    if (!guildPaths) {
        return;
    }

    const record = getPermissionRecord(guildId);
    const existing = record[userId] || {};

    record[userId] = {
        ...existing,
        [permissionKey]: value
    };

    writeJson(guildPaths.userPermissions, record);
}

function canUseTriggers(userId, guildId) {
    if (isDeveloper(userId)) {
        return true;
    }

    return getUserPermissions(userId, guildId).useTriggers;
}

function canAddTriggers(userId, guildId, memberPermissions = null) {
    if (isDeveloper(userId)) {
        return true;
    }

    if (!isAdmin(userId, guildId, memberPermissions)) return false;
    return getUserPermissions(userId, guildId).addTriggers;
}

function canUseAiChat(userId, guildId) {
    return getUserPermissions(userId, guildId).useAiChat;
}

function canUseBotMentions(userId, guildId) {
    return getUserPermissions(userId, guildId).useBotMentions;
}

function canSavePingRequests(userId, guildId) {
    return getUserPermissions(userId, guildId).savePingRequests;
}

function canUseTriggerCommands(userId) {
    return isDeveloper(userId) || isTriggerFeatureEnabled();
}

// Clears all stored feature permissions, returning the member to defaults.
function resetUserPermissions(userId, guildId) {
    const guildPaths = resolveGuildPaths(guildId);

    if (guildPaths) {
        const record = getPermissionRecord(guildId);
        delete record[userId];
        writeJson(guildPaths.userPermissions, record);
    }
}

module.exports = {
    getGuildOwnerUserId,
    setGuildOwner,
    isGuildOwner,
    setCommandPermissions,
    getDeveloperUserIds,
    getUserRole,
    getCommandPath,
    getRequiredCommandRole,
    normalizeRole,
    roleMeetsRequirement,
    isConfiguredDeveloper,
    isDeveloper,
    isAdmin,
    hasAdministratorPermission,
    canUseCommandPath,
    isTriggerFeatureEnabled,
    getUserPermissions,
    setUserPermission,
    canUseTriggers,
    canAddTriggers,
    canUseAiChat,
    canUseBotMentions,
    canSavePingRequests,
    canUseTriggerCommands,
    resetUserPermissions,
    getDeveloperRoleSimulation,
    setDeveloperRoleSimulation
};
