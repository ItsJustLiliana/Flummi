const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    appendConversationTurn,
    getUserFilePath,
    getUserHistory,
    migrateLegacyUsers,
    usersDir
} = require('../stores/user-conversation-store');
const { getGlobalUserDir } = require('../utils/global-user-storage');

const dataDir = path.join(__dirname, '..', 'data');
const legacyUsersDir = path.join(dataDir, 'users');

function cleanupUser(userId) {
    fs.rmSync(getGlobalUserDir(userId), { recursive: true, force: true });
    fs.rmSync(path.join(usersDir, `${userId}.json`), { force: true });
    fs.rmSync(path.join(legacyUsersDir, `${userId}.json`), { force: true });

    try {
        if (fs.existsSync(legacyUsersDir) && fs.readdirSync(legacyUsersDir).length === 0) {
            fs.rmdirSync(legacyUsersDir);
        }
    } catch {
        // Best effort test cleanup.
    }
}

test('user conversation store writes memory under data/global/users/<userId>/aiMemory.json', () => {
    const userId = `900${process.pid}`;
    cleanupUser(userId);

    try {
        appendConversationTurn(userId, 'hoi', 'hoi terug', 2);

        assert.equal(getUserFilePath(userId), path.join(usersDir, userId, 'aiMemory.json'));
        assert.equal(fs.existsSync(path.join(dataDir, 'global', 'users', userId, 'aiMemory.json')), true);
        assert.equal(getUserHistory(userId).length, 2);
    } finally {
        cleanupUser(userId);
    }
});

test('user conversation store migrates old data/users memory on first access', () => {
    const userId = `901${process.pid}`;
    cleanupUser(userId);

    try {
        fs.mkdirSync(legacyUsersDir, { recursive: true });
        fs.writeFileSync(path.join(legacyUsersDir, `${userId}.json`), JSON.stringify({
            history: [{ role: 'user', content: 'oude memory' }],
            updatedAt: '2026-06-17 12:00:00'
        }, null, 2));

        const history = getUserHistory(userId);

        assert.equal(history.length, 1);
        assert.equal(history[0].content, 'oude memory');
        assert.equal(fs.existsSync(getUserFilePath(userId)), true);
        assert.equal(fs.existsSync(path.join(legacyUsersDir, `${userId}.json`)), false);
    } finally {
        cleanupUser(userId);
    }
});

test('user conversation store migrates old data/global/users flat files on first access', () => {
    const userId = `903${process.pid}`;
    cleanupUser(userId);

    try {
        fs.mkdirSync(usersDir, { recursive: true });
        fs.writeFileSync(path.join(usersDir, `${userId}.json`), JSON.stringify({
            history: [{ role: 'user', content: 'flat global memory' }],
            updatedAt: '2026-06-17 12:00:00'
        }, null, 2));

        const history = getUserHistory(userId);

        assert.equal(history.length, 1);
        assert.equal(history[0].content, 'flat global memory');
        assert.equal(fs.existsSync(getUserFilePath(userId)), true);
        assert.equal(fs.existsSync(path.join(usersDir, `${userId}.json`)), false);
    } finally {
        cleanupUser(userId);
    }
});

test('user conversation store can migrate all legacy users and remove legacy folder', () => {
    const userId = `902${process.pid}`;
    cleanupUser(userId);

    try {
        fs.mkdirSync(legacyUsersDir, { recursive: true });
        fs.writeFileSync(path.join(legacyUsersDir, `${userId}.json`), JSON.stringify({
            history: [{ role: 'user', content: 'bulk legacy' }],
            updatedAt: '2026-06-17 12:00:00'
        }, null, 2));

        migrateLegacyUsers();

        assert.equal(fs.existsSync(getUserFilePath(userId)), true);
        assert.equal(fs.existsSync(path.join(legacyUsersDir, `${userId}.json`)), false);
        assert.equal(fs.existsSync(legacyUsersDir), false);
    } finally {
        cleanupUser(userId);
    }
});
