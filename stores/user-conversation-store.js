const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const globalDir = path.join(dataDir, 'global');
const usersDir = path.join(globalDir, 'users');
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

function ensureUsersDir() {
    fs.mkdirSync(usersDir, { recursive: true });
}

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/[^0-9]/g, '');
}

function getUserFilePath(userId) {
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

    if (!userFilePath || !legacyUserFilePath || !fs.existsSync(legacyUserFilePath)) {
        return;
    }

    ensureUsersDir();

    const globalFileExists = fs.existsSync(userFilePath);
    const legacyData = readRawUserData(legacyUserFilePath);
    const globalData = globalFileExists ? readRawUserData(userFilePath) : ensureUserData(null);

    if (shouldPreferLegacyUserData(legacyData, globalData, globalFileExists)) {
        fs.writeFileSync(userFilePath, JSON.stringify(legacyData, null, 2), 'utf8');
    }

    try {
        fs.unlinkSync(legacyUserFilePath);
        cleanupLegacyUsersDirIfEmpty();
    } catch {
        // If cleanup fails, keep using the global file path anyway.
    }
}

function migrateLegacyUsers() {
    if (!fs.existsSync(legacyUsersDir)) {
        return;
    }

    const files = fs.readdirSync(legacyUsersDir)
        .filter(file => /^\d+\.json$/.test(file));

    for (const file of files) {
        migrateLegacyUserFile(path.basename(file, '.json'));
    }

    cleanupLegacyUsersDirIfEmpty();
}

function ensureUserFile(userId) {
    const userFilePath = getUserFilePath(userId);

    if (!userFilePath) {
        return null;
    }

    ensureUsersDir();
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
