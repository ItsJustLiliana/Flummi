const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

const defaultAutomodRules = {
    badWords: { enabled: true, action: 'inherit', limit: 1, windowSeconds: 8 },
    serverInvites: { enabled: true, action: 'inherit', limit: 2, windowSeconds: 8 },
    externalLinks: { enabled: false, action: 'inherit', limit: 2, windowSeconds: 8 },
    messageSpam: { enabled: true, action: 'inherit', limit: 6, windowSeconds: 8 },
    duplicateSpam: { enabled: true, action: 'inherit', limit: 3, windowSeconds: 30 },
    mentionSpam: { enabled: true, action: 'inherit', limit: 6, windowSeconds: 8 },
    capsSpam: { enabled: true, action: 'inherit', limit: 80, windowSeconds: 8 },
    emojiSpam: { enabled: true, action: 'inherit', limit: 12, windowSeconds: 8 },
    zalgoSpam: { enabled: false, action: 'inherit', limit: 12, windowSeconds: 8 }
};

const automodPresetLimits = {
    relaxed: { serverInvites: 3, externalLinks: 3, messageSpam: 8, duplicateSpam: 4, mentionSpam: 8, capsSpam: 90, emojiSpam: 16, zalgoSpam: 18 },
    balanced: { serverInvites: 2, externalLinks: 2, messageSpam: 6, duplicateSpam: 3, mentionSpam: 6, capsSpam: 80, emojiSpam: 12, zalgoSpam: 12 },
    strict: { serverInvites: 1, externalLinks: 1, messageSpam: 5, duplicateSpam: 2, mentionSpam: 4, capsSpam: 70, emojiSpam: 8, zalgoSpam: 8 }
};

const defaultSettings = {
    botEnabled: true,
    triggersEnabled: true,
    triggerActionCooldownEnabled: true,
    triggerActionCooldownSeconds: 10,
    maxTriggerLength: 200,
    exactTriggerMatch: false,
    features: {},
    management: {
        modules: {
            moderation: false,
            automod: false,
            cases: false,
            roles: false,
            automation: false
        },
        moderation: {
            requireReason: true,
            notifyMember: true,
            defaultTimeoutMinutes: 10
        },
        automod: {
            preset: 'balanced',
            mode: 'test',
            escalationEnabled: true,
            logChannelId: '',
            blockedTerms: [],
            ignoredChannelIds: [],
            ignoredRoleIds: [],
            action: 'delete',
            timeoutMinutes: 10,
            allowedDomains: [],
            allowedInviteCodes: [],
            rules: defaultAutomodRules
        },
        cases: {
            logChannelId: '',
            retentionDays: 365,
            logMessageChanges: true,
            logMemberChanges: true
        },
        roles: {
            autoroleId: '',
            autoroleDelayMinutes: 0,
            persistRoles: false,
            interactiveRoles: true,
            selfAssignableRoleIds: [],
            onboardingChannelId: '',
            onboardingTitle: 'Choose your roles',
            onboardingMessage: 'Use the menu below to choose the roles that fit you.'
        },
        automation: {
            welcomeEnabled: false,
            scheduledMessagesEnabled: false,
            autoPurgeEnabled: false,
            welcomeChannelId: '',
            welcomeMessage: 'Welcome {user} to **{server}**!',
            goodbyeEnabled: false,
            goodbyeChannelId: '',
            goodbyeMessage: '**{username}** left the server.',
            schedules: [],
            purgeRules: []
        }
    }
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

function booleanOr(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function snowflakeOrEmpty(value) {
    const normalized = String(value || '').trim();
    return /^\d{16,22}$/.test(normalized) ? normalized : '';
}

function snowflakeArray(value, maximum = 100) {
    return [...new Set((Array.isArray(value) ? value : []).map(item => snowflakeOrEmpty(item)).filter(Boolean))].slice(0, maximum);
}

function textOr(value, fallback, maximum = 1000) {
    return typeof value === 'string' ? value.slice(0, maximum) : fallback;
}

function normalizeSchedules(value) {
    return (Array.isArray(value) ? value : []).slice(0, 25).map((entry, index) => ({
        id: /^[a-z0-9-]{3,80}$/i.test(String(entry?.id || '')) ? String(entry.id) : `schedule-${index + 1}`,
        enabled: booleanOr(entry?.enabled, true),
        channelId: snowflakeOrEmpty(entry?.channelId),
        message: textOr(entry?.message, '', 1800).trim(),
        intervalMinutes: boundedInteger(Number(entry?.intervalMinutes), 5, 43200, 1440),
        lastRunAt: entry?.lastRunAt || null
    })).filter(entry => entry.channelId && entry.message);
}

function normalizePurgeRules(value) {
    return (Array.isArray(value) ? value : []).slice(0, 25).map((entry, index) => ({
        id: /^[a-z0-9-]{3,80}$/i.test(String(entry?.id || '')) ? String(entry.id) : `purge-${index + 1}`,
        enabled: booleanOr(entry?.enabled, true),
        channelId: snowflakeOrEmpty(entry?.channelId),
        keepMessages: boundedInteger(Number(entry?.keepMessages), 0, 100, 20),
        intervalMinutes: boundedInteger(Number(entry?.intervalMinutes), 10, 43200, 1440),
        lastRunAt: entry?.lastRunAt || null
    })).filter(entry => entry.channelId);
}

function normalizeAutomodRules(value, preset = 'balanced') {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.fromEntries(Object.entries(defaultAutomodRules).map(([key, fallback]) => {
        const rule = source[key] && typeof source[key] === 'object' ? source[key] : {};
        const presetLimit = automodPresetLimits[preset]?.[key] || fallback.limit;
        return [key, {
            enabled: booleanOr(rule.enabled, fallback.enabled),
            action: ['inherit', 'delete', 'warn', 'timeout'].includes(rule.action) ? rule.action : fallback.action,
            limit: boundedInteger(Number(rule.limit), 1, 100, presetLimit),
            windowSeconds: boundedInteger(Number(rule.windowSeconds), 2, 300, fallback.windowSeconds),
            ignoredChannelIds: snowflakeArray(rule.ignoredChannelIds),
            ignoredRoleIds: snowflakeArray(rule.ignoredRoleIds)
        }];
    }));
}

function normalizeManagement(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const modules = source.modules && typeof source.modules === 'object' ? source.modules : {};
    const moderation = source.moderation && typeof source.moderation === 'object' ? source.moderation : {};
    const automod = source.automod && typeof source.automod === 'object' ? source.automod : {};
    const cases = source.cases && typeof source.cases === 'object' ? source.cases : {};
    const roles = source.roles && typeof source.roles === 'object' ? source.roles : {};
    const automation = source.automation && typeof source.automation === 'object' ? source.automation : {};
    const defaults = defaultSettings.management;

    return {
        modules: Object.fromEntries(Object.keys(defaults.modules).map(key => [key, booleanOr(modules[key], defaults.modules[key])])),
        moderation: {
            requireReason: booleanOr(moderation.requireReason, defaults.moderation.requireReason),
            notifyMember: booleanOr(moderation.notifyMember, defaults.moderation.notifyMember),
            defaultTimeoutMinutes: boundedInteger(Number(moderation.defaultTimeoutMinutes), 1, 40320, defaults.moderation.defaultTimeoutMinutes)
        },
        automod: {
            preset: ['relaxed', 'balanced', 'strict'].includes(automod.preset) ? automod.preset : defaults.automod.preset,
            mode: ['test', 'enforce'].includes(automod.mode) ? automod.mode : defaults.automod.mode,
            escalationEnabled: booleanOr(automod.escalationEnabled, defaults.automod.escalationEnabled),
            logChannelId: snowflakeOrEmpty(automod.logChannelId),
            blockedTerms: [...new Set((Array.isArray(automod.blockedTerms) ? automod.blockedTerms : []).map(term => String(term).trim().toLowerCase()).filter(Boolean))].slice(0, 1000),
            ignoredChannelIds: snowflakeArray(automod.ignoredChannelIds),
            ignoredRoleIds: snowflakeArray(automod.ignoredRoleIds),
            action: ['delete', 'warn', 'timeout'].includes(automod.action) ? automod.action : defaults.automod.action,
            timeoutMinutes: boundedInteger(Number(automod.timeoutMinutes), 1, 40320, defaults.automod.timeoutMinutes),
            allowedDomains: [...new Set((Array.isArray(automod.allowedDomains) ? automod.allowedDomains : []).map(value => String(value).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')).filter(value => /^[a-z0-9.-]+$/.test(value)))].slice(0, 200),
            allowedInviteCodes: [...new Set((Array.isArray(automod.allowedInviteCodes) ? automod.allowedInviteCodes : []).map(value => String(value).trim().toLowerCase()).filter(value => /^[a-z0-9-]+$/i.test(value)))].slice(0, 200),
            rules: normalizeAutomodRules(automod.rules, ['relaxed', 'balanced', 'strict'].includes(automod.preset) ? automod.preset : defaults.automod.preset)
        },
        cases: {
            logChannelId: snowflakeOrEmpty(cases.logChannelId),
            retentionDays: boundedInteger(Number(cases.retentionDays), 1, 3650, defaults.cases.retentionDays),
            logMessageChanges: booleanOr(cases.logMessageChanges, defaults.cases.logMessageChanges),
            logMemberChanges: booleanOr(cases.logMemberChanges, defaults.cases.logMemberChanges)
        },
        roles: {
            autoroleId: snowflakeOrEmpty(roles.autoroleId),
            autoroleDelayMinutes: boundedInteger(Number(roles.autoroleDelayMinutes), 0, 10080, defaults.roles.autoroleDelayMinutes),
            persistRoles: booleanOr(roles.persistRoles, defaults.roles.persistRoles),
            interactiveRoles: booleanOr(roles.interactiveRoles, defaults.roles.interactiveRoles),
            selfAssignableRoleIds: snowflakeArray(roles.selfAssignableRoleIds, 25),
            onboardingChannelId: snowflakeOrEmpty(roles.onboardingChannelId),
            onboardingTitle: textOr(roles.onboardingTitle, defaults.roles.onboardingTitle, 100).trim(),
            onboardingMessage: textOr(roles.onboardingMessage, defaults.roles.onboardingMessage, 1000).trim()
        },
        automation: {
            welcomeEnabled: booleanOr(automation.welcomeEnabled, defaults.automation.welcomeEnabled),
            scheduledMessagesEnabled: booleanOr(automation.scheduledMessagesEnabled, defaults.automation.scheduledMessagesEnabled),
            autoPurgeEnabled: booleanOr(automation.autoPurgeEnabled, defaults.automation.autoPurgeEnabled),
            welcomeChannelId: snowflakeOrEmpty(automation.welcomeChannelId),
            welcomeMessage: textOr(automation.welcomeMessage, defaults.automation.welcomeMessage, 1800),
            goodbyeEnabled: booleanOr(automation.goodbyeEnabled, defaults.automation.goodbyeEnabled),
            goodbyeChannelId: snowflakeOrEmpty(automation.goodbyeChannelId),
            goodbyeMessage: textOr(automation.goodbyeMessage, defaults.automation.goodbyeMessage, 1800),
            schedules: normalizeSchedules(automation.schedules),
            purgeRules: normalizePurgeRules(automation.purgeRules)
        }
    };
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
        management: normalizeManagement(safeSource.management),
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
        management: normalizeManagement(settings.management),
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
