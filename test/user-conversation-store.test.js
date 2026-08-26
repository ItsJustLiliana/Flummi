const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    appendConversationTurn,
    clearUserHistory,
    getUserFilePath,
    getUserHistory,
    getUserMemory,
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

test('user conversation store keeps trimmed turns in a compact summary', () => {
    const userId = `904${process.pid}`;
    cleanupUser(userId);

    try {
        appendConversationTurn(userId, 'eerste vraag over keukenrol', 'eerste antwoord', 2);
        appendConversationTurn(userId, 'tweede vraag met https://example.com/foto.png', 'tweede antwoord', 2);
        appendConversationTurn(userId, 'derde vraag', 'derde antwoord', 2);

        const memory = getUserMemory(userId);

        assert.equal(memory.history.length, 4);
        assert.equal(memory.history[0].content, 'tweede vraag met https://example.com/foto.png');
        assert.match(memory.summary, /eerste vraag over keukenrol/);
        assert.match(memory.summary, /eerste antwoord/);
        assert.doesNotMatch(memory.summary, /https:\/\/example\.com/);
    } finally {
        cleanupUser(userId);
    }
});

test('clearUserHistory also clears compact summary', () => {
    const userId = `905${process.pid}`;
    cleanupUser(userId);

    try {
        appendConversationTurn(userId, 'oud 1', 'antwoord 1', 2);
        appendConversationTurn(userId, 'oud 2', 'antwoord 2', 2);
        appendConversationTurn(userId, 'oud 3', 'antwoord 3', 2);

        assert.notEqual(getUserMemory(userId).summary, '');

        clearUserHistory(userId);

        const memory = getUserMemory(userId);

        assert.equal(memory.history.length, 0);
        assert.equal(memory.summary, '');
        assert.equal(memory.profile, '');
    } finally {
        cleanupUser(userId);
    }
});

test('user conversation store does not infer interests or preferences', () => {
    const userId = `906${process.pid}`;
    cleanupUser(userId);

    try {
        appendConversationTurn(userId, 'mijn favoriete game is Brawl Stars', 'ok', 4);
        appendConversationTurn(userId, 'ik hou van korte antwoorden', 'snap ik', 4);
        appendConversationTurn(userId, 'geef mij een foto van El Primo', '[image result: https://example.com/elprimo.png]', 4);

        const memory = getUserMemory(userId);

        assert.equal(memory.profile, '');
        const stored = JSON.parse(fs.readFileSync(getUserFilePath(userId), 'utf8'));
        assert.equal('profile' in stored, false);
        assert.equal('profileSignals' in stored, false);
    } finally {
        cleanupUser(userId);
    }
});

test('user conversation store does not infer repeated topics or chat style', () => {
    const userId = `907${process.pid}`;
    cleanupUser(userId);

    try {
        appendConversationTurn(userId, 'foto van freddy fazbear', 'hier', 8);
        appendConversationTurn(userId, 'nee geef freddy fazbear nog eens', 'ok', 8);
        appendConversationTurn(userId, 'waarom doet dit raar haha?', 'geen idee', 8);
        appendConversationTurn(userId, 'top fix dit lol', 'komt goed', 8);

        const memory = getUserMemory(userId);

        assert.equal(memory.profile, '');
        const stored = JSON.parse(fs.readFileSync(getUserFilePath(userId), 'utf8'));
        assert.equal('profile' in stored, false);
        assert.equal('profileSignals' in stored, false);
    } finally {
        cleanupUser(userId);
    }
});
