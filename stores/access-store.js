const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const dataDir = path.join(__dirname, '..', 'data');

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
        managers: path.join(base, 'managers.json'),
        userPermissions: path.join(base, 'userPermissions.json')
    };
}

function getDeveloperUserIds() {
    return Array.from(new Set([
        ...(Array.isArray(config.developerUserIds) ? config.developerUserIds : []),
        ...(config.developerUserId ? [config.developerUserId] : [])
    ].map(String)));
}

function getManagerUserIds(guildId) {
    const guildPaths = resolveGuildPaths(guildId);
    const fileManagers = guildPaths
        ? readJson(guildPaths.managers, [])
        : [];

    return Array.from(new Set([
        ...(Array.isArray(config.managerUserIds) ? config.managerUserIds : []),
        ...(Array.isArray(fileManagers) ? fileManagers : [])
    ].map(String)));
}

function isDeveloper(userId) {
    return getDeveloperUserIds().includes(String(userId));
}

function isManager(userId, guildId) {
    return isDeveloper(userId) || getManagerUserIds(guildId).includes(String(userId));
}

function getUserRole(userId, guildId) {
    if (isDeveloper(userId)) {
        return 'developer';
    }

    if (isManager(userId, guildId)) {
        return 'manager';
    }

    return 'user';
}

function normalizeRole(role, fallbackRole = 'user') {
    const normalized = String(role || '').trim().toLowerCase();

    if (['user', 'manager', 'developer'].includes(normalized)) {
        return normalized;
    }

    return fallbackRole;
}

function normalizeCommandPath(commandPath) {
    const normalized = String(commandPath || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/^\//, '');

    if (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+){0,2}$/.test(normalized)) {
        return '';
    }

    return normalized;
}

function roleMeetsRequirement(userRole, requiredRole) {
    const ranks = {
        user: 0,
        manager: 1,
        developer: 2
    };

    return ranks[normalizeRole(userRole)] >= ranks[normalizeRole(requiredRole)];
}

function getUserCommandOverrides(userId, guildId) {
    if (isDeveloper(userId)) {
        return {};
    }

    const record = getPermissionRecord(guildId);
    const entry = record[userId] || {};
    const overrides = entry.commandOverrides && typeof entry.commandOverrides === 'object' && !Array.isArray(entry.commandOverrides)
        ? entry.commandOverrides
        : {};

    return Object.fromEntries(
        Object.entries(overrides)
            .map(([pathKey, value]) => [normalizeCommandPath(pathKey), value])
            .filter(([pathKey, value]) => pathKey && typeof value === 'boolean')
    );
}

function getCommandOverrideForPath(userId, guildId, commandName, subcommandName) {
    if (isDeveloper(userId)) {
        return null;
    }

    const overrides = getUserCommandOverrides(userId, guildId);
    const commandKey = normalizeCommandPath(commandName);
    const subcommandKey = subcommandName ? normalizeCommandPath(`${commandName}.${subcommandName}`) : '';

    if (subcommandKey && Object.prototype.hasOwnProperty.call(overrides, subcommandKey)) {
        return {
            path: subcommandKey,
            allowed: overrides[subcommandKey]
        };
    }

    if (commandKey && Object.prototype.hasOwnProperty.call(overrides, commandKey)) {
        return {
            path: commandKey,
            allowed: overrides[commandKey]
        };
    }

    return null;
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

    if (commandDefinition?.devOnly) {
        return 'developer';
    }

    if (commandDefinition?.managerOnly) {
        return 'manager';
    }

    return 'user';
}

function canUseCommandPath({ userId, guildId, commandName, subcommandName, commandDefinition, subcommandGroupName = null }) {
    const requiredRole = getRequiredCommandRole(commandName, subcommandName, commandDefinition, subcommandGroupName);
    const userRole = getUserRole(userId, guildId);
    const override = getCommandOverrideForPath(
        userId,
        guildId,
        commandName,
        subcommandGroupName && subcommandName ? `${subcommandGroupName}.${subcommandName}` : subcommandName
    );

    if (override) {
        return {
            allowed: override.allowed,
            requiredRole,
            userRole,
            override
        };
    }

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
            savePingRequests: true,
            commandOverrides: {}
        };
    }

    const record = getPermissionRecord(guildId);
    const entry = record[userId] || {};
    const manager = isManager(userId, guildId);

    return {
        useTriggers: entry.useTriggers !== false,
        addTriggers: manager ? entry.addTriggers !== false : entry.addTriggers !== false,
        useAiChat: entry.useAiChat !== false,
        useBotMentions: entry.useBotMentions !== false,
        savePingRequests: entry.savePingRequests !== false,
        commandOverrides: getUserCommandOverrides(userId, guildId)
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

function setUserCommandPermission(userId, commandPath, value, guildId) {
    if (isDeveloper(userId)) {
        return {};
    }

    const normalizedPath = normalizeCommandPath(commandPath);

    if (!normalizedPath) {
        throw new Error('Invalid command path.');
    }

    const guildPaths = resolveGuildPaths(guildId);

    if (!guildPaths) {
        return {};
    }

    const record = getPermissionRecord(guildId);
    const existing = record[userId] || {};
    const commandOverrides = existing.commandOverrides && typeof existing.commandOverrides === 'object' && !Array.isArray(existing.commandOverrides)
        ? { ...existing.commandOverrides }
        : {};

    if (value === null) {
        delete commandOverrides[normalizedPath];
    } else if (typeof value === 'boolean') {
        commandOverrides[normalizedPath] = value;
    } else {
        throw new Error('Command permission value must be true, false, or null.');
    }

    record[userId] = {
        ...existing,
        commandOverrides
    };

    writeJson(guildPaths.userPermissions, record);
    return getUserCommandOverrides(userId, guildId);
}

function setManagerRole(userId, shouldBeManager, guildId) {
    const guildPaths = resolveGuildPaths(guildId);

    if (!guildPaths) {
        return [];
    }

    const managers = readJson(guildPaths.managers, []);

    const normalized = Array.isArray(managers) ? managers : [];
    const existingIndex = normalized.indexOf(userId);

    if (shouldBeManager && existingIndex === -1) {
        normalized.push(userId);
    }

    if (!shouldBeManager && existingIndex !== -1) {
        normalized.splice(existingIndex, 1);
    }

    writeJson(guildPaths.managers, normalized);
    return normalized;
}

function canUseTriggers(userId, guildId) {
    if (isDeveloper(userId)) {
        return true;
    }

    return getUserPermissions(userId, guildId).useTriggers;
}

function canAddTriggers(userId, guildId) {
    if (isDeveloper(userId)) {
        return true;
    }

    if (isManager(userId, guildId)) {
        return getUserPermissions(userId, guildId).addTriggers;
    }

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

// Clears manager status and all stored feature/command overrides, returning the user to defaults.
function resetUserPermissions(userId, guildId) {
    const guildPaths = resolveGuildPaths(guildId);

    if (guildPaths) {
        const record = getPermissionRecord(guildId);
        delete record[userId];
        writeJson(guildPaths.userPermissions, record);
    }

    setManagerRole(userId, false, guildId);
}

module.exports = {
    getDeveloperUserIds,
    getManagerUserIds,
    getUserRole,
    getCommandPath,
    getRequiredCommandRole,
    getUserCommandOverrides,
    normalizeCommandPath,
    roleMeetsRequirement,
    isDeveloper,
    isManager,
    canUseCommandPath,
    isTriggerFeatureEnabled,
    getUserPermissions,
    setUserPermission,
    setUserCommandPermission,
    setManagerRole,
    canUseTriggers,
    canAddTriggers,
    canUseAiChat,
    canUseBotMentions,
    canSavePingRequests,
    canUseTriggerCommands,
    resetUserPermissions
};
