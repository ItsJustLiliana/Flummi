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
    ensureJsonFile(path.join(base, 'triggerAudit.json'), []);
    ensureJsonFile(path.join(base, 'pingRequests.json'), []);
    ensureJsonFile(path.join(base, 'managers.json'), []);
    ensureJsonFile(path.join(base, 'userPermissions.json'), {});
}

module.exports = {
    ensureGuildStorage
};
