const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLeaderboard } = require('../commands/leaderboard');

test('leaderboard command groups every ranking under one command', () => {
    const command = require('../commands/leaderboard').data.toJSON();
    assert.deepEqual(command.options.map(option => option.name), ['messages', 'voice', 'media']);
});

test('leaderboard builder supplies an empty state for either category', () => {
    const messages = buildLeaderboard({ guildId: 'test-empty-leaderboard', category: 'messages', limit: 10 });
    const voice = buildLeaderboard({ guildId: 'test-empty-leaderboard', category: 'voice', limit: 10 });

    assert.equal(messages.title, 'Message Leaderboard');
    assert.equal(messages.empty, 'No messages tracked yet.');
    assert.equal(voice.title, 'Voice Time Leaderboard');
    assert.equal(voice.empty, 'No voice activity tracked yet.');
});

test('media rankings live under the leaderboard command', () => {
    const media = require('../commands/leaderboard').data.toJSON().options.find(option => option.name === 'media');
    assert.ok(media);
    assert.deepEqual(media.options.find(option => option.name === 'type').choices.map(choice => choice.value), ['soundboard', 'emojis', 'stickers']);
});
