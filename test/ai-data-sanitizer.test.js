const test = require('node:test');
const assert = require('node:assert/strict');
const { redactDiscordIdentifiers, sanitizeAiMessages } = require('../services/ai-data-sanitizer');

test('AI text redacts raw Discord IDs and mention syntax', () => {
    assert.equal(
        redactDiscordIdentifiers('user 123456789012345678 in <#234567890123456789> ping <@345678901234567890>'),
        'user [discord-id] in [discord-reference] ping [discord-reference]'
    );
});

test('AI message sanitization preserves image URLs while redacting text parts', () => {
    const url = 'https://cdn.discordapp.com/attachments/123456789012345678/234567890123456789/image.png';
    const messages = sanitizeAiMessages([{ role: 'user', content: [
        { type: 'text', text: 'channel 123456789012345678' },
        { type: 'image_url', image_url: { url } }
    ] }]);
    assert.equal(messages[0].content[0].text, 'channel [discord-id]');
    assert.equal(messages[0].content[1].image_url.url, url);
});
