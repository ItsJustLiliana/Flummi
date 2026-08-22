const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');

test('public root is a landing page with role-aware navigation and server groups', () => {
    assert.match(panelServer, /authenticated: false/);
    assert.doesNotMatch(panelServer, /pathname === '\/'\) \{\s*if \(!sessionFor\(req\)\)/);
    for (const id of ['homeShell', 'homeFeedbackNav', 'homeDeveloperNav', 'homeGuilds', 'dashboardHome']) {
        assert.match(panelHtml, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /row\.isAdmin/);
    const sidebarStart = panelHtml.indexOf('<aside class="sidebar">');
    const sidebarEnd = panelHtml.indexOf('</aside>', sidebarStart);
    const sidebar = panelHtml.slice(sidebarStart, sidebarEnd);
    assert.doesNotMatch(sidebar, /<label for="guild">|<select id="guild"/);
    assert.ok(sidebar.indexOf('id="refreshAll"') > sidebar.indexOf('</nav>'));
    assert.ok(sidebar.indexOf('id="refreshAll"') < sidebar.indexOf('id="logoutPanel"'));
    assert.match(panelHtml, /id="logoutPanel"[\s\S]*?window\.location\.assign\('\/'\)/);
    assert.match(panelHtml, /class="home-auth-button" href="\/auth\/login"/);
    assert.match(panelHtml, /id="homeSignedIn" class="home-account-card"/);
});

test('feedback, manager audit, autosave, and staged promotion are enforced', () => {
    assert.match(panelServer, /pathname === '\/api\/feedback'/);
    assert.match(panelServer, /The audit log is only available to the server owner or a manager/);
    assert.match(panelHtml, /data-tab="audit" data-manager-only/);
    assert.doesNotMatch(panelHtml, /id="saveSettings"/);
    assert.match(panelHtml, /instantSettingIds/);
    assert.match(panelServer, /pathname === '\/api\/release\/promote'/);
});

test('developer tools live in the top-level workspace instead of the server dashboard', () => {
    const developerStart = panelHtml.indexOf('id="homeDeveloperTabs"');
    const developerEnd = panelHtml.indexOf('id="homeDeveloperPanelHost"', developerStart);
    const developerNavigation = panelHtml.slice(developerStart, developerEnd);
    for (const tab of ['messenger', 'profiles', 'ai', 'global', 'reliability', 'files', 'logs', 'experiments']) {
        assert.match(developerNavigation, new RegExp(`data-tab="${tab}"`));
    }

    const sidebarStart = panelHtml.indexOf('<aside class="sidebar">');
    const sidebarEnd = panelHtml.indexOf('</aside>', sidebarStart);
    const sidebar = panelHtml.slice(sidebarStart, sidebarEnd);
    assert.doesNotMatch(sidebar, /data-tab="(?:messenger|profiles|ai|global|reliability|files|logs|experiments)"/);
    assert.doesNotMatch(panelHtml, /Open dashboard tools|id="openDeveloperPanel"/);
    assert.match(panelHtml, /developerPanelHost\.appendChild\(panel\)/);
});

test('panel markup keeps unique ids and syntactically valid inline scripts', () => {
    const ids = Array.from(panelHtml.matchAll(/\sid="([^"]+)"/g), match => match[1]).filter(id => !id.includes('${'));
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    assert.deepEqual(duplicates, []);

    const inlineScripts = Array.from(panelHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).filter(Boolean);
    for (const script of inlineScripts) assert.doesNotThrow(() => new Function(script));
});

test('overview is detail-focused and analytics summary owns compact graphs', () => {
    assert.match(panelHtml, /id="overviewFeatures"/);
    assert.doesNotMatch(panelHtml, /id="overviewMessageChart"|id="overviewVoiceChart"|id="overviewShots"/);
    assert.match(panelHtml, /id="analyticsSummaryRange"/);
    assert.match(panelHtml, /id="analyticsSummaryGraphType"/);
    assert.doesNotMatch(panelHtml, /statCard\('Busiest day'/);
});
