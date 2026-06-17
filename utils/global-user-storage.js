const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const globalDir = path.join(dataDir, 'global');
const globalUsersDir = path.join(globalDir, 'users');

function normalizeUserId(userId) {
    return String(userId || '').trim().replace(/[^0-9]/g, '');
}

function getGlobalUsersDir() {
    return globalUsersDir;
}

function getGlobalUserDir(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
        return null;
    }

    return path.join(globalUsersDir, normalizedUserId);
}

function ensureGlobalUserDir(userId) {
    const userDir = getGlobalUserDir(userId);

    if (!userDir) {
        return null;
    }

    fs.mkdirSync(userDir, { recursive: true });
    return userDir;
}

function getGlobalUserFilePath(userId, fileName) {
    const userDir = getGlobalUserDir(userId);

    if (!userDir) {
        return null;
    }

    return path.join(userDir, fileName);
}

module.exports = {
    ensureGlobalUserDir,
    getGlobalUserDir,
    getGlobalUserFilePath,
    getGlobalUsersDir,
    normalizeUserId
};
