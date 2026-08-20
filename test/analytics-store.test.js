const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMessageMediaUsage, summarizeMediaField, trendDetails } = require('../stores/analytics-store');

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
