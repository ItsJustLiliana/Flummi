const fs = require('fs');
const path = require('path');
const { ensureGlobalUserDir, getGlobalUserFilePath } = require('../utils/global-user-storage');

const defaults = Object.freeze({
    defaultTab: 'overview',
    pinnedTabs: [],
    compactMode: false,
    reducedMotion: false,
    highContrast: false,
    largeText: false,
    notificationDelivery: {
        general: 'dashboard',
        moderation: 'dashboard',
        support: 'both',
        privacy: 'both',
        workflow: 'dashboard'
    },
    updatedAt: null
});

const notificationKinds = ['general', 'moderation', 'support', 'privacy', 'workflow'];
const notificationChannels = new Set(['dashboard', 'dm', 'both', 'off']);

function normalize(userId, value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        userId: String(userId),
        defaultTab: String(source.defaultTab || defaults.defaultTab).slice(0, 60),
        pinnedTabs: [...new Set((Array.isArray(source.pinnedTabs) ? source.pinnedTabs : []).map(String))].slice(0, 8),
        compactMode: source.compactMode === true,
        reducedMotion: source.reducedMotion === true,
        highContrast: source.highContrast === true,
        largeText: source.largeText === true,
        notificationDelivery: Object.fromEntries(notificationKinds.map(kind => {
            const value = source.notificationDelivery?.[kind];
            return [kind, notificationChannels.has(value) ? value : defaults.notificationDelivery[kind]];
        })),
        updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null
    };
}

function readPreferences(userId) {
    try {
        return normalize(userId, JSON.parse(fs.readFileSync(getGlobalUserFilePath(userId, 'panel-preferences.json'), 'utf8')));
    } catch {
        return normalize(userId, defaults);
    }
}

function updatePreferences(userId, updates = {}) {
    const next = normalize(userId, { ...readPreferences(userId), ...updates, updatedAt: new Date().toISOString() });
    ensureGlobalUserDir(userId);
    fs.writeFileSync(getGlobalUserFilePath(userId, 'panel-preferences.json'), JSON.stringify(next, null, 2));
    return next;
}

module.exports = { defaults, normalize, readPreferences, updatePreferences };
