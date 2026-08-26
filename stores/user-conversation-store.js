const fs = require('fs');
const path = require('path');
const {
    ensureGlobalUserDir,
    getGlobalUserFilePath,
    getGlobalUsersDir,
    normalizeUserId
} = require('../utils/global-user-storage');

const dataDir = path.join(__dirname, '..', 'data');
const usersDir = getGlobalUsersDir();
const legacyUsersDir = path.join(dataDir, 'users');

const DEFAULT_MAX_HISTORY = 24;
const DEFAULT_MAX_SUMMARY_CHARS = 2000;

function formatTimestamp(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(value.getTime())) {
        return '';
    }

    const pad = number => String(number).padStart(2, '0');

    return [
        value.getFullYear(),
        pad(value.getMonth() + 1),
        pad(value.getDate())
    ].join('-') + ' ' + [
        pad(value.getHours()),
        pad(value.getMinutes()),
        pad(value.getSeconds())
    ].join(':');
}

function getUserFilePath(userId) {
    return getGlobalUserFilePath(userId, 'aiMemory.json');
}

function getLegacyGlobalUserFilePath(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
        return null;
    }

    return path.join(usersDir, `${normalizedUserId}.json`);
}

function getLegacyUserFilePath(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
        return null;
    }

    return path.join(legacyUsersDir, `${normalizedUserId}.json`);
}

function readRawUserData(filePath) {
    try {
        return ensureUserData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return ensureUserData(null);
    }
}

function shouldPreferLegacyUserData(legacyData, globalData, globalFileExists) {
    if (!globalFileExists) {
        return true;
    }

    if (legacyData.history.length > globalData.history.length && !globalData.updatedAt) {
        return true;
    }

    if (legacyData.updatedAt && (!globalData.updatedAt || legacyData.updatedAt > globalData.updatedAt)) {
        return true;
    }

    return false;
}

function cleanupLegacyUsersDirIfEmpty() {
    try {
        if (fs.existsSync(legacyUsersDir) && fs.readdirSync(legacyUsersDir).length === 0) {
            fs.rmdirSync(legacyUsersDir);
        }
    } catch {
        // Best effort cleanup only.
    }
}

function migrateLegacyUserFile(userId) {
    const userFilePath = getUserFilePath(userId);
    const legacyUserFilePath = getLegacyUserFilePath(userId);
    const legacyGlobalUserFilePath = getLegacyGlobalUserFilePath(userId);
    const legacySources = [legacyGlobalUserFilePath, legacyUserFilePath].filter(Boolean);

    if (!userFilePath || !legacySources.some(filePath => fs.existsSync(filePath))) {
        return;
    }

    ensureGlobalUserDir(userId);

    let globalFileExists = fs.existsSync(userFilePath);
    let globalData = globalFileExists ? readRawUserData(userFilePath) : ensureUserData(null);

    for (const sourcePath of legacySources) {
        if (!fs.existsSync(sourcePath)) {
            continue;
        }

        const legacyData = readRawUserData(sourcePath);

        if (shouldPreferLegacyUserData(legacyData, globalData, globalFileExists)) {
            fs.writeFileSync(userFilePath, JSON.stringify(legacyData, null, 2), 'utf8');
            globalFileExists = true;
            globalData = legacyData;
        }

        try {
            fs.unlinkSync(sourcePath);
        } catch {
            // If cleanup fails, keep using the nested global file path anyway.
        }
    }

    cleanupLegacyUsersDirIfEmpty();
}

function migrateLegacyUsers() {
    const userIds = new Set();

    if (fs.existsSync(usersDir)) {
        for (const file of fs.readdirSync(usersDir)) {
            if (/^\d+\.json$/.test(file)) {
                userIds.add(path.basename(file, '.json'));
            }
        }
    }

    if (fs.existsSync(legacyUsersDir)) {
        for (const file of fs.readdirSync(legacyUsersDir)) {
            if (/^\d+\.json$/.test(file)) {
                userIds.add(path.basename(file, '.json'));
            }
        }
    }

    for (const userId of userIds) {
        migrateLegacyUserFile(userId);
    }

    cleanupLegacyUsersDirIfEmpty();
}

function ensureUserFile(userId) {
    const userFilePath = getUserFilePath(userId);

    if (!userFilePath) {
        return null;
    }

    ensureGlobalUserDir(userId);
    migrateLegacyUserFile(userId);

    if (!fs.existsSync(userFilePath)) {
        fs.writeFileSync(userFilePath, JSON.stringify({ history: [], updatedAt: null }, null, 2), 'utf8');
    }

    return userFilePath;
}

function ensureUserData(userData) {
    const safe = userData && typeof userData === 'object' ? userData : {};

    if (!Array.isArray(safe.history)) {
        safe.history = [];
    }

    if (typeof safe.summary !== 'string') {
        safe.summary = '';
    }

    // Older versions inferred interests and writing-style profiles. Purge those
    // fields whenever a record is read or written; conversation memory now only
    // contains the user's explicit messages and a compact conversation summary.
    delete safe.profile;
    delete safe.profileSignals;

    if (typeof safe.updatedAt !== 'string' && safe.updatedAt !== null) {
        safe.updatedAt = null;
    }

    return safe;
}

function purgeLegacyProfiles(root = usersDir) {
    if (!fs.existsSync(root)) return 0;
    let purged = 0;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) { purged += purgeLegacyProfiles(target); continue; }
        if (path.extname(entry.name).toLowerCase() !== '.json') continue;
        try {
            const record = JSON.parse(fs.readFileSync(target, 'utf8'));
            if (!record || typeof record !== 'object' || (!Object.hasOwn(record, 'profile') && !Object.hasOwn(record, 'profileSignals'))) continue;
            delete record.profile;
            delete record.profileSignals;
            fs.writeFileSync(target, JSON.stringify(record, null, 2), 'utf8');
            purged += 1;
        } catch {
            // Ignore unrelated or temporarily incomplete JSON files.
        }
    }
    return purged;
}

function readUserData(userId) {
    const userFilePath = ensureUserFile(userId);

    if (!userFilePath) {
        return ensureUserData(null);
    }

    try {
        const raw = fs.readFileSync(userFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        return ensureUserData(parsed);
    } catch {
        return ensureUserData(null);
    }
}

function writeUserData(userId, userData) {
    const userFilePath = ensureUserFile(userId);

    if (!userFilePath) {
        return;
    }

    fs.writeFileSync(userFilePath, JSON.stringify(ensureUserData(userData), null, 2), 'utf8');
}

function getUserHistory(userId) {
    const userData = readUserData(userId);
    return userData.history;
}

function getUserMemory(userId) {
    const userData = readUserData(userId);

    return {
        history: userData.history,
        summary: userData.summary,
        profile: ''
    };
}

function getUserConversationSummary(userId) {
    const userData = readUserData(userId);

    return {
        historyMessages: userData.history.length,
        turns: Math.floor(userData.history.length / 2),
        summaryChars: userData.summary.length,
        profileChars: 0,
        updatedAt: userData.updatedAt
    };
}

function compactMemoryText(text, maxLength = 180) {
    return String(text || '')
        .replace(/\[image result:\s*https?:\/\/[^\]\s]+\]/gi, '[image result]')
        .replace(/\[image:\s*https?:\/\/[^\]\s]+\]/gi, '[image]')
        .replace(/https?:\/\/\S+/gi, '[link]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function summarizeHistoryMessages(messages) {
    const lines = [];

    for (let index = 0; index < messages.length; index += 2) {
        const userMessage = messages[index];
        const assistantMessage = messages[index + 1];

        if (userMessage?.role !== 'user') {
            continue;
        }

        const userText = compactMemoryText(userMessage.content);
        const assistantText = assistantMessage?.role === 'assistant'
            ? compactMemoryText(assistantMessage.content)
            : '';

        if (!userText && !assistantText) {
            continue;
        }

        lines.push(`- User: ${userText || '[leeg]'}${assistantText ? ` | Flummi: ${assistantText}` : ''}`);
    }

    return lines.join('\n');
}

function mergeSummary(existingSummary, removedMessages, maxChars = DEFAULT_MAX_SUMMARY_CHARS) {
    const newSummary = summarizeHistoryMessages(removedMessages);

    if (!newSummary) {
        return String(existingSummary || '').slice(-maxChars);
    }

    const combined = [existingSummary, newSummary]
        .filter(Boolean)
        .join('\n');

    if (combined.length <= maxChars) {
        return combined.trim();
    }

    return combined
        .slice(-maxChars)
        .replace(/^[^\n]*\n/, '')
        .trim();
}

function appendConversationTurn(userId, userMessage, assistantMessage, maxHistory = DEFAULT_MAX_HISTORY) {
    const userData = readUserData(userId);

    const now = formatTimestamp();

    userData.history.push({
        role: 'user',
        content: userMessage,
        at: now
    });

    userData.history.push({
        role: 'assistant',
        content: assistantMessage,
        at: now
    });

    const maxTurns = Math.max(2, Number(maxHistory) || DEFAULT_MAX_HISTORY);
    const maxMessages = maxTurns * 2;

    if (userData.history.length > maxMessages) {
        const removedMessages = userData.history.slice(0, userData.history.length - maxMessages);
        userData.summary = mergeSummary(userData.summary, removedMessages);
        userData.history = userData.history.slice(-maxMessages);
    }

    userData.updatedAt = now;
    writeUserData(userId, userData);
}

function clearUserHistory(userId) {
    writeUserData(userId, {
        summary: '',
        history: [],
        updatedAt: formatTimestamp()
    });
}

purgeLegacyProfiles();

module.exports = {
    formatTimestamp,
    getUserFilePath,
    migrateLegacyUsers,
    purgeLegacyProfiles,
    usersDir,
    getUserHistory,
    getUserMemory,
    getUserConversationSummary,
    appendConversationTurn,
    clearUserHistory
};
