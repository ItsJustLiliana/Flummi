const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const defaultSettings = {
    botEnabled: true,
    triggersEnabled: true,
    triggerActionCooldownEnabled: true,
    triggerActionCooldownSeconds: 10,
    maxTriggerLength: 200,
    exactTriggerMatch: false,
    features: {}
};

const featureKeys = ['triggersEnabled', 'aiConversationsEnabled', 'aiAttachmentsEnabled', 'aiImageSearchEnabled', 'pingResponsesEnabled', 'pingRequestSaveEnabled', 'shotsEnabled'];

function boundedInteger(value, minimum, maximum, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function normalizeFeatures(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(featureKeys.filter(key => typeof source[key] === 'boolean').map(key => [key, source[key]]));
}

function resolveGuildFolder(guildId) {
    if (!guildId) {
        return null;
    }

    return path.join(dataDir, 'guilds', String(guildId));
}

function resolveGuildSettingsPath(guildId) {
    const folder = resolveGuildFolder(guildId);

    if (!folder) {
        return null;
    }

    return path.join(folder, 'settings.json');
}

function ensureParentDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeSettings(source) {
    const safeSource = source && typeof source === 'object' && !Array.isArray(source) ? source : {};

    return {
        botEnabled:
            typeof safeSource.botEnabled === 'boolean'
                ? safeSource.botEnabled
                : true,
        triggersEnabled:
            typeof safeSource.triggersEnabled === 'boolean'
                ? safeSource.triggersEnabled
                : true,
        triggerActionCooldownEnabled:
            typeof safeSource.triggerActionCooldownEnabled === 'boolean'
                ? safeSource.triggerActionCooldownEnabled
                : typeof safeSource.commandCooldownEnabled === 'boolean'
                    ? safeSource.commandCooldownEnabled
                    : true,
        triggerActionCooldownSeconds:
            Number.isFinite(safeSource.triggerActionCooldownSeconds)
                ? boundedInteger(safeSource.triggerActionCooldownSeconds, 0, 3600, defaultSettings.triggerActionCooldownSeconds)
                : Number.isFinite(safeSource.commandCooldownSeconds)
                    ? boundedInteger(safeSource.commandCooldownSeconds, 0, 3600, defaultSettings.triggerActionCooldownSeconds)
                    : defaultSettings.triggerActionCooldownSeconds,
        maxTriggerLength: boundedInteger(safeSource.maxTriggerLength, 1, 200, defaultSettings.maxTriggerLength),
        exactTriggerMatch:
            typeof safeSource.exactTriggerMatch === 'boolean'
                ? safeSource.exactTriggerMatch
                : defaultSettings.exactTriggerMatch,
        features: normalizeFeatures(safeSource.features),
        maxTriggers:
            Number.isFinite(safeSource.maxTriggers) && safeSource.maxTriggers > 0
                ? Math.floor(safeSource.maxTriggers)
                : safeSource.maxTriggers
    };
}

function readSettings(guildId) {
    const guildPath = resolveGuildSettingsPath(guildId);

    if (!guildPath) {
        return { ...defaultSettings };
    }

    try {
        if (fs.existsSync(guildPath)) {
            const raw = JSON.parse(fs.readFileSync(guildPath, 'utf8'));
            return normalizeSettings(raw);
        }

        return { ...defaultSettings };
    } catch {
        return { ...defaultSettings };
    }
}

function writeSettings(settings, guildId) {
    const nextSettings = {
        botEnabled:
            typeof settings.botEnabled === 'boolean'
                ? settings.botEnabled
                : defaultSettings.botEnabled,
        triggersEnabled:
            typeof settings.triggersEnabled === 'boolean'
                ? settings.triggersEnabled
                : defaultSettings.triggersEnabled,
        triggerActionCooldownEnabled:
            typeof settings.triggerActionCooldownEnabled === 'boolean'
                ? settings.triggerActionCooldownEnabled
                : defaultSettings.triggerActionCooldownEnabled,
        triggerActionCooldownSeconds:
            boundedInteger(settings.triggerActionCooldownSeconds, 0, 3600, defaultSettings.triggerActionCooldownSeconds),
        maxTriggerLength: boundedInteger(settings.maxTriggerLength, 1, 200, defaultSettings.maxTriggerLength),
        exactTriggerMatch:
            typeof settings.exactTriggerMatch === 'boolean'
                ? settings.exactTriggerMatch
                : defaultSettings.exactTriggerMatch,
        features: normalizeFeatures(settings.features),
        maxTriggers:
            Number.isFinite(settings.maxTriggers) && settings.maxTriggers > 0
                ? Math.floor(settings.maxTriggers)
                : settings.maxTriggers
    };

    const targetPath = resolveGuildSettingsPath(guildId);

    if (!targetPath) {
        return nextSettings;
    }

    ensureParentDir(targetPath);
    fs.writeFileSync(targetPath, JSON.stringify(nextSettings, null, 4));
    return nextSettings;
}

function setTriggerActionCooldownSeconds(seconds, guildId) {
    const settings = readSettings(guildId);
    settings.triggerActionCooldownSeconds = seconds;
    return writeSettings(settings, guildId);
}

function setTriggerActionCooldownEnabled(enabled, guildId) {
    const settings = readSettings(guildId);
    settings.triggerActionCooldownEnabled = enabled;
    return writeSettings(settings, guildId);
}

function setBotEnabled(enabled, guildId) {
    const settings = readSettings(guildId);
    settings.botEnabled = enabled;
    return writeSettings(settings, guildId);
}

module.exports = {
    defaultSettings,
    readSettings,
    writeSettings,
    setTriggerActionCooldownSeconds,
    setTriggerActionCooldownEnabled,
    setBotEnabled
};
