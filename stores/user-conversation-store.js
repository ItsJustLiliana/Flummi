const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const usersDir = path.join(dataDir, 'users');

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

function ensureUserFile(userId) {
    const userFilePath = getUserFilePath(userId);

    if (!userFilePath) {
        return null;
    }

    ensureUsersDir();

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
    getUserHistory,
    appendConversationTurn,
    clearUserHistory
};
