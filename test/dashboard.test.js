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
    assert.equal(reply.content, 'Flummi dashboard: https://flummi.liliananuzohra.com/');
});
