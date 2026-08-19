const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaderboard } = require('../commands/leaderboard');

test('leaderboard command declares both compact category choices', () => {
    const command = require('../commands/leaderboard').data.toJSON();
    const category = command.options.find(option => option.name === 'category');

    assert.deepEqual(category.choices.map(choice => choice.value), ['messages', 'voice']);
});

test('leaderboard builder supplies an empty state for either category', () => {
    const messages = buildLeaderboard({ guildId: 'test-empty-leaderboard', category: 'messages', limit: 10 });
    const voice = buildLeaderboard({ guildId: 'test-empty-leaderboard', category: 'voice', limit: 10 });

    assert.equal(messages.title, 'Message Leaderboard');
    assert.equal(messages.empty, 'No messages tracked yet.');
    assert.equal(voice.title, 'Voice Time Leaderboard');
    assert.equal(voice.empty, 'No voice activity tracked yet.');
});
