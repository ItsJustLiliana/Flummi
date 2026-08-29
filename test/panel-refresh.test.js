const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelMarkup = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelStyles = fs.readFileSync(path.join(__dirname, '..', 'panel', 'styles.css'), 'utf8');
const panelScript = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
const panelHtml = `${panelMarkup}\n${panelStyles}\n${panelScript}`;

test('passive panel refresh protects every tab with unsaved editors', () => {
    const match = panelHtml.match(/tabsExcludedFromAutoRefresh\s*=\s*new Set\(\[([^\]]+)\]\)/);
    assert.ok(match, 'protected tab set should exist');
    for (const tab of ['messenger', 'triggers', 'users', 'settings', 'profiles', 'ai', 'experiments']) {
        assert.match(match[1], new RegExp(`['"]${tab}['"]`));
    }
});

test('resize and timer refreshes both use the passive-refresh guard', () => {
    assert.match(panelHtml, /resize[\s\S]{0,500}!shouldSkipPassiveRefresh\(\)/);
    assert.match(panelHtml, /if \(shouldSkipPassiveRefresh\(tab\)\)/);
    assert.match(panelHtml, /autoRefreshBusy \|\| !state\.guildId \|\| !isDashboardVisible\(\)/);
    assert.match(panelHtml, /actualRole === 'developer' && isDashboardVisible\(\) && activeTab\(\) === 'experiments'/);
});

test('manual Discord access refresh is only visible to actual developers', () => {
    assert.match(panelHtml, /<button id="refreshDiscordAccess"[^>]*data-actual-developer-only/);
});
