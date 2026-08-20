const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    endVoiceSession,
    getChannelVoiceMembers,
    getVoiceAnalytics,
    getVoiceActivityHeatmap,
    getVoiceHistory,
    getUserVoiceStats,
    getVoiceStatsSummary,
    startVoiceSession,
    updateVoiceSession
} = require('../stores/voice-store');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('voice store tracks join/leave durations and leaderboard', () => {
    const guildId = `test-voice-stats-${process.pid}`;
    cleanupGuild(guildId);

    try {
        const joinedAt = new Date('2026-01-01T00:00:00.000Z');
        const leftAt = new Date('2026-01-01T00:05:00.000Z');

        startVoiceSession({
            guildId,
            userId: '100',
            channelId: '10',
            channelName: 'general-vc',
            at: joinedAt,
            state: {
                channelType: 'voice',
                selfMute: false,
                streaming: false,
                video: false
            }
        });
        startVoiceSession({
            guildId,
            userId: '200',
            channelId: '10',
            channelName: 'general-vc',
            at: new Date('2026-01-01T00:01:00.000Z')
        });
        const seenAt = new Date('2026-01-01T00:02:00.000Z');
        updateVoiceSession({
            guildId,
            userId: '100',
            at: seenAt,
            state: { selfMute: true, streaming: true, video: true }
        });
        endVoiceSession({ guildId, userId: '100', at: leftAt });
        endVoiceSession({ guildId, userId: '200', at: new Date('2026-01-01T00:06:00.000Z') });
        startVoiceSession({
            guildId,
            userId: '300',
            channelId: '10',
            channelName: 'general-vc',
            at: new Date('2026-01-01T01:00:00.000Z')
        });
        endVoiceSession({
            guildId,
            userId: '300',
            at: new Date('2026-01-01T01:05:00.000Z')
        });

        const stats = getUserVoiceStats(guildId, '100');

        assert.equal(stats.totalMs, 5 * 60 * 1000);
        assert.equal(stats.lastChannelId, '10');
        assert.equal(stats.currentChannelId, null);
        assert.equal(stats.lastLeftAt, leftAt.toISOString());
        assert.equal(stats.lastJoinedAt, joinedAt.toISOString());
        assert.equal(stats.lastSeenAt, leftAt.toISOString());
        assert.deepEqual(stats.byChannel.map(row => [row.id, row.name, row.ms]), [['10', 'general-vc', 5 * 60 * 1000]]);
        assert.deepEqual(getVoiceHistory(guildId, '100')[0].withUserIds, ['200']);
        assert.equal(getVoiceHistory(guildId, '100')[0].withUserIds.includes('100'), false);
        assert.match(getVoiceHistory(guildId, '100')[0].sessionId, /^[0-9a-f-]{36}$/);
        assert.equal(getVoiceHistory(guildId, '100')[0].startReason, 'join');
        assert.equal(getVoiceHistory(guildId, '100')[0].endReason, 'leave');
        assert.equal(getVoiceHistory(guildId, '100')[0].endState.streaming, true);
        assert.deepEqual(getVoiceHistory(guildId, '300')[0].withUserIds, []);
        assert.equal(getVoiceHistory(guildId, '100', 'different-channel').length, 0);
        assert.deepEqual(
            getChannelVoiceMembers(guildId, '10').map(member => [member.userId, member.lastJoinedAt, member.inVoice]),
            [
                ['300', '2026-01-01T01:00:00.000Z', false],
                ['200', '2026-01-01T00:01:00.000Z', false],
                ['100', '2026-01-01T00:00:00.000Z', false]
            ]
        );

        const leaderboard = getVoiceStatsSummary(guildId, 5);
        assert.deepEqual(leaderboard.map(row => [row.id, row.totalMs, row.inVoice]), [
            ['100', 5 * 60 * 1000, false],
            ['200', 5 * 60 * 1000, false],
            ['300', 5 * 60 * 1000, false]
        ]);

        const allTime = getVoiceAnalytics(guildId);
        assert.equal(allTime.activeOverTime[0].date, '2026-01-01');
        const firstHour = getVoiceActivityHeatmap(guildId, '2026-01-01T00:00:00.000Z', '2026-01-01T00:59:59.999Z', '10');
        assert.equal(firstHour[4][0], 2);
        assert.equal(firstHour.flat().reduce((total, count) => total + count, 0), 2);
    } finally {
        cleanupGuild(guildId);
    }
});

test('voice analytics include active sessions and clip them to the selected range', () => {
    const guildId = `test-live-voice-range-${process.pid}`;
    cleanupGuild(guildId);
    try {
        const now = Date.now();
        startVoiceSession({ guildId, userId: 'live', channelId: '10', channelName: 'general-vc', at: new Date(now - 10 * 60000) });
        const inRange = getVoiceAnalytics(guildId, new Date(now - 5 * 60000).toISOString(), new Date(now).toISOString());
        const allTime = getVoiceAnalytics(guildId);
        assert.ok(inRange.totalMs >= 4.9 * 60000 && inRange.totalMs <= 5.1 * 60000);
        assert.ok(allTime.totalMs >= 9.9 * 60000 && allTime.totalMs <= 10.1 * 60000);
    } finally {
        cleanupGuild(guildId);
    }
});
