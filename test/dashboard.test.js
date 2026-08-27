const test = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../commands/dashboard');

test('dashboard is public and returns the canonical HTTPS panel URL', async () => {
    let reply;
    await dashboard.execute({
        reply(payload) {
            reply = payload;
            return payload;
        }
    });

    assert.equal(dashboard.public, true);
    assert.equal(dashboard.devOnly, undefined);
    assert.equal(dashboard.data.name, 'dashboard');
    assert.equal(reply.embeds.length, 1);
    assert.equal(reply.components.length, 1);
    assert.equal(reply.components[0].components[0].data.url, 'https://flummi.liliananuzohra.com/');
});
