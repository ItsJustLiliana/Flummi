const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const workerUrl = pathToFileURL(path.join(__dirname, '..', 'deploy', 'cloudflare-worker', 'offline-fallback.mjs'));

test('Cloudflare Worker passes healthy responses and replaces tunnel failures', async () => {
    const worker = (await import(workerUrl.href)).default;
    const originalFetch = global.fetch;

    try {
        global.fetch = async () => new Response('healthy', { status: 200 });
        const healthy = await worker.fetch(new Request('https://flummi.example.com/'));
        assert.equal(healthy.status, 200);
        assert.equal(await healthy.text(), 'healthy');

        global.fetch = async () => new Response('cloudflare tunnel error', { status: 530 });
        const offline = await worker.fetch(new Request('https://flummi.example.com/'));
        assert.equal(offline.status, 503);
        assert.match(await offline.text(), /Temporarily unavailable/);
        assert.equal(offline.headers.get('cache-control'), 'no-store');

        const apiOffline = await worker.fetch(new Request('https://flummi.example.com/api/overview', {
            headers: { accept: 'application/json' }
        }));
        assert.equal(apiOffline.status, 503);
        assert.deepEqual(await apiOffline.json(), {
            error: 'Flummi is temporarily unavailable. Please try again shortly.'
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('cloudflared service keeps its tunnel token out of the process arguments', () => {
    const service = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'cloudflared.service'), 'utf8');
    const installer = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'install-cloudflared-user-service.sh'), 'utf8');

    assert.match(service, /--token-file %h\/\.config\/cloudflared\/tunnel\.token/);
    assert.doesNotMatch(service, /--token\s|\$\{TUNNEL_TOKEN\}/);
    assert.match(service, /NoNewPrivileges=true/);
    assert.match(installer, /chmod 600 "\$\{token_file\}"/);
    assert.match(installer, /read -rsp/);
});
