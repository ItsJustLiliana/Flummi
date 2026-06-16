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
            addTriggers: true
        };
    }

    const record = getPermissionRecord(guildId);
    const entry = record[userId] || {};

    return {
        useTriggers: entry.useTriggers !== false,
        addTriggers: entry.addTriggers !== false
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
    if (isManager(userId, guildId)) {
        return true;
    }

    return getUserPermissions(userId, guildId).useTriggers;
}

function canAddTriggers(userId, guildId) {
    if (isManager(userId, guildId)) {
        return true;
    }

    return getUserPermissions(userId, guildId).addTriggers;
}

function canUseTriggerCommands(userId) {
    return isDeveloper(userId) || isTriggerFeatureEnabled();
}

module.exports = {
    getDeveloperUserIds,
    getManagerUserIds,
    isDeveloper,
    isManager,
    isTriggerFeatureEnabled,
    getUserPermissions,
    setUserPermission,
    setManagerRole,
    canUseTriggers,
    canAddTriggers,
    canUseTriggerCommands
};
