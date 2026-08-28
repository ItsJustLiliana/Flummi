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
    updatedAt: null
});

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
