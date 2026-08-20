const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { appendEvent, extractMessageMediaUsage, getAnalyticsSummary, getMediaUsageSummary, getMessageActivityHeatmap, getSoundboardSummary, summarizeMediaField, trendDetails } = require('../stores/analytics-store');

function cleanupGuild(guildId) {
    fs.rmSync(path.join(__dirname, '..', 'data', 'guilds', guildId), { recursive: true, force: true });
}

test('message activity heatmap supports exact ranges and channel and member filters', () => {
    const guildId = `test-message-heatmap-${process.pid}`;
    cleanupGuild(guildId);
    try {
        appendEvent(guildId, 'messages', { at: '2026-08-17T08:15:00.000Z', channelId: 'one', userId: 'alice' });
        appendEvent(guildId, 'messages', { at: '2026-08-17T08:45:00.000Z', channelId: 'two', userId: 'bob' });
        appendEvent(guildId, 'messages', { at: '2026-08-10T08:15:00.000Z', channelId: 'one', userId: 'alice' });

        const allTime = getMessageActivityHeatmap(guildId);
        const selectedWeek = getMessageActivityHeatmap(guildId, '2026-08-17T00:00:00.000Z', '2026-08-23T23:59:59.999Z', 'one', 'alice');
        assert.equal(allTime[1][8], 3);
        assert.equal(selectedWeek[1][8], 1);
        assert.equal(getAnalyticsSummary(guildId, 7).totalMessageCount, 3);
        assert.equal(getAnalyticsSummary(guildId, 'all').messageCount, 3);
    } finally {
        cleanupGuild(guildId);
    }
});

test('media summaries expose all-time totals independently from the selected range', () => {
    const guildId = `test-media-totals-${process.pid}`;
    cleanupGuild(guildId);
    try {
        appendEvent(guildId, 'soundboard', { at: '2026-01-01T10:00:00.000Z', soundId: 'old' });
        appendEvent(guildId, 'soundboard', { soundId: 'new' });
        appendEvent(guildId, 'messages', { at: '2026-01-01T10:00:00.000Z', customEmojiIds: ['1', '1'], stickerIds: ['2'] });
        appendEvent(guildId, 'messages', { customEmojiIds: ['1'], stickerIds: [] });
        const sounds = getSoundboardSummary(guildId, 7);
        const media = getMediaUsageSummary(guildId, 7);
        assert.equal(sounds.totalPlays, 2);
        assert.equal(sounds.plays, 1);
        assert.equal(media.totalEmojiUses, 3);
        assert.equal(media.emojiUses, 1);
        assert.equal(media.totalStickerUses, 1);
        assert.equal(media.stickerUses, 0);
    } finally {
        cleanupGuild(guildId);
    }
});

test('message media usage tracks repeated custom emojis and attached stickers', () => {
    const result = extractMessageMediaUsage({
        content: '<:party:123> hello <a:dance:456> <:party:123>',
        stickers: new Map([['789', { name: 'Wave' }]])
    });

    assert.deepEqual(result.customEmojiIds, ['123', '456', '123']);
    assert.deepEqual(result.stickerIds, ['789']);
});

test('message media usage ignores Unicode emoji and normal text', () => {
    assert.deepEqual(extractMessageMediaUsage({ content: 'hello 👋', stickers: new Map() }), {
        customEmojiIds: [],
        stickerIds: []
    });
});

test('media usage summary includes trends, first and last use, averages, and top members', () => {
    const now = Date.parse('2026-08-20T12:00:00.000Z');
    const rows = [
        { at: '2026-07-25T12:00:00.000Z', userId: 'old', userTag: 'Old user', customEmojiIds: ['123'] },
        { at: '2026-08-18T12:00:00.000Z', userId: 'one', userTag: 'One', customEmojiIds: ['123', '123'] },
        { at: '2026-08-19T12:00:00.000Z', userId: 'two', userTag: 'Two', customEmojiIds: ['123'] }
    ];
    const [summary] = summarizeMediaField(rows, 'customEmojiIds', 7, now);

    assert.equal(summary.count, 3);
    assert.equal(summary.previousCount, 0);
    assert.equal(summary.firstUsed, '2026-07-25T12:00:00.000Z');
    assert.equal(summary.lastUsed, '2026-08-19T12:00:00.000Z');
    assert.equal(summary.averagePerDay, 0.43);
    assert.deepEqual(summary.topMembers.map(member => [member.userId, member.count]), [['one', 2], ['two', 1]]);
    assert.equal(summary.trend.status, 'new');
});

test('trend details compare equal periods and disable comparison for all time', () => {
    assert.deepEqual(trendDetails(15, 10), { status: 'up', percent: 50, previous: 10 });
    assert.deepEqual(trendDetails(4, 8), { status: 'down', percent: -50, previous: 8 });
    assert.deepEqual(trendDetails(12, 0), { status: 'new', percent: null, previous: 0 });
    assert.deepEqual(trendDetails(12, 5, false), { status: 'unavailable', percent: null, previous: null });
});
