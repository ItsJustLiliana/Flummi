const fs = require('fs');
const path = require('path');
const { defaultSettings } = require('../stores/settings-store');

const dataDir = path.join(__dirname, '..', 'data');

function ensureJsonFile(filePath, fallbackValue) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(fallbackValue, null, 4));
    }
}

function ensureGuildStorage(guildId) {
    if (!guildId) {
        return;
    }

    const base = path.join(dataDir, 'guilds', String(guildId));

    ensureJsonFile(path.join(base, 'settings.json'), defaultSettings);
    ensureJsonFile(path.join(base, 'triggers.json'), []);
    ensureJsonFile(path.join(base, 'triggerStats.json'), {});
    ensureJsonFile(path.join(base, 'analytics', 'rollups', 'message-stats.json'), {
        messages: {
            total: 0,
            byChannel: {},
            byUser: {}
        }
    });
    ensureJsonFile(path.join(base, 'triggerAudit.json'), []);
    ensureJsonFile(path.join(base, 'pingRequests.json'), []);
    ensureJsonFile(path.join(base, 'userPermissions.json'), {});
    ensureJsonFile(path.join(base, 'analytics', 'rollups', 'voice-state.json'), {
        activeSessions: {},
        history: [],
        users: {}
    });
}

function ensureGlobalStorage() {
    fs.mkdirSync(path.join(dataDir, 'global', 'users'), { recursive: true });

    try {
        const { migrateLegacyUsers } = require('../stores/user-conversation-store');
        migrateLegacyUsers();
    } catch (error) {
        console.warn(`Failed to migrate legacy global users: ${error.message}`);
    }

    try {
        const { migrateLegacyProfiles } = require('../stores/profile-store');
        migrateLegacyProfiles();
    } catch (error) {
        console.warn(`Failed to migrate legacy global profiles: ${error.message}`);
    }
}

module.exports = {
    ensureGlobalStorage,
    ensureGuildStorage
};
