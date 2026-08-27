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
const { historyPathForGuildRoot, writeAnonymousAnalyticsAt } = require('../stores/anonymous-analytics-store');

function cleanupGuild(guildId) {
    const guildPath = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(guildPath, { recursive: true, force: true });
}

test('all-time voice analytics include permanent anonymous daily totals', () => {
    const guildId = `test-voice-history-${process.pid}`;
    const guildRoot = path.join(__dirname, '..', 'data', 'guilds', guildId);
    cleanupGuild(guildId);
    try {
        writeAnonymousAnalyticsAt(historyPathForGuildRoot(guildRoot), {
            messages: { byDay: {} },
            voice: { byDay: { '2020-01-01': {
                occupiedMs: 60000, participantMs: 120000, sessions: 2, heatmap: [2, ...Array(23).fill(0)],
                channels: { ten: { name: 'General voice', occupiedMs: 60000, participantMs: 120000, sessions: 2 } }
            } } }
        });
        const allTime = getVoiceAnalytics(guildId);
        assert.equal(allTime.totalMs, 60000);
        assert.equal(allTime.participantTotalMs, 120000);
        assert.equal(allTime.minutesOverTime.find(row => row.date === '2020-01-01').count, 2);
        assert.equal(allTime.topChannels[0].totalMs, 120000);
        assert.deepEqual(allTime.userTotals, []);
        assert.equal(getVoiceActivityHeatmap(guildId)[3][0], 2);
    } finally {
        cleanupGuild(guildId);
    }
});

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

test('voice range totals merge overlapping members so one day cannot exceed 24 hours', () => {
    const guildId = `test-overlapping-voice-range-${process.pid}`;
    cleanupGuild(guildId);
    try {
        const now = Date.now();
        const startedAt = new Date(now - 10 * 60000);
        startVoiceSession({ guildId, userId: 'one', channelId: '10', channelName: 'general-vc', at: startedAt });
        startVoiceSession({ guildId, userId: 'two', channelId: '10', channelName: 'general-vc', at: startedAt });
        const analytics = getVoiceAnalytics(guildId, new Date(now - 5 * 60000).toISOString(), new Date(now).toISOString());
        assert.ok(analytics.totalMs >= 4.9 * 60000 && analytics.totalMs <= 5.1 * 60000);
        assert.ok(analytics.participantTotalMs >= 9.8 * 60000 && analytics.participantTotalMs <= 10.2 * 60000);
    } finally {
        cleanupGuild(guildId);
    }
});

test('one selected voice day returns hourly session and minute buckets', () => {
    const guildId = `test-hourly-voice-range-${process.pid}`;
    cleanupGuild(guildId);
    try {
        startVoiceSession({ guildId, userId: 'one', channelId: '10', channelName: 'general-vc', at: new Date('2026-08-20T03:45:00.000Z') });
        endVoiceSession({ guildId, userId: 'one', at: new Date('2026-08-20T04:15:00.000Z') });
        const analytics = getVoiceAnalytics(guildId, '2026-08-20T00:00:00.000Z', '2026-08-20T23:59:59.999Z');
        assert.equal(analytics.activeOverTime.length, 24);
        assert.equal(analytics.activeOverTime.find(row => row.date === '2026-08-20T03').count, 1);
        assert.equal(analytics.minutesOverTime.find(row => row.date === '2026-08-20T03').count, 15);
        assert.equal(analytics.minutesOverTime.find(row => row.date === '2026-08-20T04').count, 15);
        assert.ok(analytics.activeOverTime.every(row => row.granularity === 'hour'));
    } finally {
        cleanupGuild(guildId);
    }
});
