const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const defaultSettings = {
    botEnabled: true,
    triggersEnabled: true,
    triggerActionCooldownEnabled: true,
    triggerActionCooldownSeconds: 10,
    maxTriggerLength: 200,
    exactTriggerMatch: false
};

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
                ? safeSource.triggerActionCooldownSeconds
                : Number.isFinite(safeSource.commandCooldownSeconds)
                    ? safeSource.commandCooldownSeconds
                    : 10,
        maxTriggerLength:
            Number.isFinite(safeSource.maxTriggerLength) && safeSource.maxTriggerLength > 0
                ? Math.floor(safeSource.maxTriggerLength)
                : defaultSettings.maxTriggerLength,
        exactTriggerMatch:
            typeof safeSource.exactTriggerMatch === 'boolean'
                ? safeSource.exactTriggerMatch
                : defaultSettings.exactTriggerMatch,
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
            Number.isFinite(settings.triggerActionCooldownSeconds)
                ? settings.triggerActionCooldownSeconds
                : defaultSettings.triggerActionCooldownSeconds,
        maxTriggerLength:
            Number.isFinite(settings.maxTriggerLength) && settings.maxTriggerLength > 0
                ? Math.floor(settings.maxTriggerLength)
                : defaultSettings.maxTriggerLength,
        exactTriggerMatch:
            typeof settings.exactTriggerMatch === 'boolean'
                ? settings.exactTriggerMatch
                : defaultSettings.exactTriggerMatch,
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
