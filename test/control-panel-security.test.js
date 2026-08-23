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

test('panel serves extracted application JavaScript without stale caching', () => {
    assert.match(panelServer, /pathname === '\/panel\/app\.js'/);
    assert.match(panelServer, /sendAsset\(res, panelScriptPath, 'no-store'\)/);
    assert.match(panelServer, /pathname === '\/panel\/styles\.css'/);
    assert.match(panelServer, /sendAsset\(res, panelStylesPath, 'no-store'\)/);
    assert.match(panelServer, /pathname === '\/panel\/i18n\.js'/);
    assert.match(panelServer, /sendAsset\(res, panelI18nPath, 'no-store'\)/);
    assert.match(panelServer, /'text\/css; charset=utf-8'/);
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

test('panel session cookies remain HttpOnly and support the Discord OAuth return', () => {
    assert.match(panelServer, /HttpOnly; SameSite=Lax; Path=\//);
    assert.doesNotMatch(panelServer, /SameSite=Strict/);
    assert.match(panelServer, /Lax is required for the top-level redirect returning from Discord/);
});

test('server-provided panel configuration is escaped before inline script injection', () => {
    assert.match(panelServer, /function serializeForInlineScript\(value\)/);
    assert.match(panelServer, /\.replace\(\/<\/g, '\\\\u003c'\)/);
    assert.match(panelServer, /serializeForInlineScript\(tabNames\)/);
});

test('developer file writes require developer access, Tailscale, and recent authentication', () => {
    assert.match(panelServer, /pathname\.startsWith\('\/api\/developer\/files'\) && !requireDeveloperAccess/);
    assert.match(panelServer, /function requireDeveloperFileWriteAccess\(req, session, res\)/);
    assert.match(panelServer, /TAILSCALE_REQUIRED/);
    assert.match(panelServer, /REAUTH_REQUIRED/);
    assert.match(panelServer, /authenticatedAt: Date\.now\(\)/);
    assert.match(panelServer, /function requireDeveloperSensitiveFileAccess\(req, res\)/);
    assert.match(panelServer, /isSensitivePath\(requestedPath\)/);
    assert.match(panelServer, /Runtime data and log files are only available through the direct Tailscale/);
    assert.match(panelServer, /privateConnection: developerFileWriteStatus\(req, session\)\.privateConnection/);
});

test('public site maintenance can only be controlled privately and preserves private access', () => {
    assert.match(panelServer, /function isCloudflareRequest\(req\)/);
    assert.match(panelServer, /config\.panel\?\.publicAccessEnabled === false && isCloudflareRequest\(req\)/);
    assert.match(panelServer, /function requirePublicSiteToggleAccess\(req, session, res\)/);
    assert.match(panelServer, /Public site access can only be changed through the direct Tailscale or localhost panel address/);
    assert.match(panelServer, /Refresh your Discord sign-in before changing public site access/);
    assert.match(panelServer, /publicSiteUnavailablePage\(\), 503/);
    assert.match(panelServer, /X-Flummi-Maintenance', 'public-paused'/);
    assert.match(panelServer, /auditPanelAction\(panelSession, 'public-site-access'/);
});
