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

    if (typeof safe.updatedAt !== 'string' && safe.updatedAt !== null) {
        safe.updatedAt = null;
    }

    return safe;
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

function getUserConversationSummary(userId) {
    const userData = readUserData(userId);

    return {
        historyMessages: userData.history.length,
        turns: Math.floor(userData.history.length / 2),
        updatedAt: userData.updatedAt
    };
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
        userData.history = userData.history.slice(-maxMessages);
    }

    userData.updatedAt = now;
    writeUserData(userId, userData);
}

function clearUserHistory(userId) {
    writeUserData(userId, {
        history: [],
        updatedAt: formatTimestamp()
    });
}

module.exports = {
    formatTimestamp,
    getUserFilePath,
    migrateLegacyUsers,
    usersDir,
    getUserHistory,
    getUserConversationSummary,
    appendConversationTurn,
    clearUserHistory
};
