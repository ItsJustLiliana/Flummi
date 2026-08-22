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
});

test('feedback, manager audit, autosave, and staged promotion are enforced', () => {
    assert.match(panelServer, /pathname === '\/api\/feedback'/);
    assert.match(panelServer, /The audit log is only available to the server owner or a manager/);
    assert.match(panelHtml, /data-tab="audit" data-manager-only/);
    assert.doesNotMatch(panelHtml, /id="saveSettings"/);
    assert.match(panelHtml, /instantSettingIds/);
    assert.match(panelServer, /pathname === '\/api\/release\/promote'/);
});

test('overview is detail-focused and analytics summary owns compact graphs', () => {
    assert.match(panelHtml, /id="overviewFeatures"/);
    assert.doesNotMatch(panelHtml, /id="overviewMessageChart"|id="overviewVoiceChart"|id="overviewShots"/);
    assert.match(panelHtml, /id="analyticsSummaryRange"/);
    assert.match(panelHtml, /id="analyticsSummaryGraphType"/);
    assert.doesNotMatch(panelHtml, /statCard\('Busiest day'/);
});
