const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');

test('panel applies browser security and private-cache headers', () => {
    for (const header of [
        'Cache-Control',
        'Content-Security-Policy',
        'Cross-Origin-Opener-Policy',
        'Permissions-Policy',
        'Referrer-Policy',
        'Strict-Transport-Security',
        'X-Content-Type-Options',
        'X-Frame-Options'
    ]) {
        assert.match(panelServer, new RegExp(`setHeader\\('${header}'`));
    }
});

test('COOP is only sent over HTTPS or a trustworthy localhost origin', () => {
    assert.match(panelServer, /function isPotentiallyTrustworthyRequest\(req\)/);
    assert.match(panelServer, /if \(isPotentiallyTrustworthyRequest\(req\)\) \{\s*res\.setHeader\('Cross-Origin-Opener-Policy', 'same-origin'\)/);
});

test('panel validates mutation origins and retains direct Tailscale hosting support', () => {
    assert.match(panelServer, /const stateChangingMethods = new Set\(\['POST', 'PUT', 'PATCH', 'DELETE'\]\)/);
    assert.match(panelServer, /if \(!hasAllowedMutationOrigin\(req\)\)/);
    assert.match(panelServer, /suppliedOrigin === requestOrigin \|\| suppliedOrigin === publicOrigin/);
    assert.match(panelServer, /process\.env\.PANEL_HOST \|\| '0\.0\.0\.0'/);
    assert.match(panelServer, /\[host, '127\.0\.0\.1'\]/);
});

test('panel session cookies use HttpOnly and strict same-site protection', () => {
    assert.match(panelServer, /HttpOnly; SameSite=Strict; Path=\//);
    assert.doesNotMatch(panelServer, /SameSite=Lax/);
});

test('server-provided panel configuration is escaped before inline script injection', () => {
    assert.match(panelServer, /function serializeForInlineScript\(value\)/);
    assert.match(panelServer, /\.replace\(\/<\/g, '\\\\u003c'\)/);
    assert.match(panelServer, /serializeForInlineScript\(tabNames\)/);
});
