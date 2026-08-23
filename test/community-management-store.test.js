const test = require('node:test');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const store = require('../stores/community-management-store');

test('community workflows use separate records and keep Starboard mappings', () => {
    const guildId = `test-community-${process.pid}`;
    const folder = path.join(__dirname, '..', 'data', 'guilds', guildId);
    fs.rmSync(folder, { recursive: true, force: true });
    try {
        const ticket = store.addTicket(guildId, { ownerId: 'member-1', channelId: 'channel-1' });
        const suggestion = store.addSuggestion(guildId, { authorId: 'member-1', idea: 'A distinct idea' });
        const submission = store.addSubmission(guildId, { authorId: 'member-2', type: 'appeal', answers: [] });
        store.updateTicket(guildId, ticket.id, { status: 'closed' });
        store.setStarboardMessage(guildId, 'source-1', 'featured-1');

        const state = store.readState(guildId);
        assert.equal(state.tickets[0].status, 'closed');
        assert.equal(state.suggestions[0].id, suggestion.id);
        assert.equal(state.submissions[0].id, submission.id);
        assert.equal(state.starboard['source-1'], 'featured-1');
    } finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
