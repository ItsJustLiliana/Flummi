const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getServerStatsSummary,
    getUserMessageStats,
    incrementMessageStats,
    readServerStats
} = require('../stores/server-stats-store');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('server stats tracks top channels and users', () => {
    const guildId = `test-server-stats-${process.pid}`;
    cleanupGuild(guildId);

    try {
        incrementMessageStats({
            guildId,
            channelId: '10',
            channelName: 'general',
            userId: '100',
            userTag: 'alice'
        });
        incrementMessageStats({
            guildId,
            channelId: '10',
            channelName: 'general',
            userId: '200',
            userTag: 'bob'
        });
        incrementMessageStats({
            guildId,
            channelId: '20',
            channelName: 'random',
            userId: '100',
            userTag: 'alice'
        });

        const raw = readServerStats(guildId);
        const summary = getServerStatsSummary(guildId, 2);

        assert.equal(raw.messages.total, 3);
        assert.deepEqual(summary.channels.map(row => [row.id, row.count]), [['10', 2], ['20', 1]]);
        assert.deepEqual(summary.users.map(row => [row.id, row.count]), [['100', 2], ['200', 1]]);
        assert.deepEqual(getUserMessageStats(guildId, '100'), {
            count: 2,
            totalMessages: 3,
            percentage: 66.66666666666666
        });
    } finally {
        cleanupGuild(guildId);
    }
});
