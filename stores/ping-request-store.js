const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const maxPingRequestEntries = 300;

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

function getPingRequestPath(guildId) {
    if (!guildId) {
        return null;
    }

    return path.join(dataDir, 'guilds', String(guildId), 'pingRequests.json');
}

function normalizePingRequestEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return null;
    }

    if (Array.isArray(entry.content)) {
        return {
            byId: entry.byId || '',
            byTag: entry.byTag || '',
            at: entry.at || '',
            content: entry.content.map(item => ({
                sendById: item?.sendById || '',
                sendByTag: item?.sendByTag || '',
                at: item?.at || '',
                message: item?.message || '',
                attachments: item?.attachments || ''
            }))
        };
    }

    return {
        byId: entry.byId || '',
        byTag: entry.byTag || '',
        at: entry.at || '',
        content: [
            {
                sendById: '',
                sendByTag: '',
                at: '',
                message: typeof entry.content === 'string' ? entry.content : '',
                attachments: entry.attachments || ''
            }
        ]
    };
}

function readPingRequests(guildId) {
    const filePath = getPingRequestPath(guildId);

    if (!filePath) {
        return [];
    }

    const entries = readJson(filePath, []);

    if (!Array.isArray(entries)) {
        return [];
    }

    return entries
        .map(normalizePingRequestEntry)
        .filter(Boolean);
}

function appendPingRequest(entry, guildId) {
    const filePath = getPingRequestPath(guildId);

    if (!filePath) {
        return [];
    }

    const entries = readPingRequests(guildId);
    const normalizedEntry = normalizePingRequestEntry(entry);

    if (!normalizedEntry) {
        return entries;
    }

    entries.unshift(normalizedEntry);

    if (entries.length > maxPingRequestEntries) {
        entries.length = maxPingRequestEntries;
    }

    writeJson(filePath, entries);
    return entries;
}

module.exports = {
    maxPingRequestEntries,
    readPingRequests,
    appendPingRequest
};
