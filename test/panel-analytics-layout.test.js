const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');

function tabMarkup(id) {
    const start = panelHtml.indexOf(`<section id="tab-${id}"`);
    assert.notEqual(start, -1, `tab-${id} should exist`);
    const end = panelHtml.indexOf('\n            <!--', start);
    return panelHtml.slice(start, end === -1 ? panelHtml.length : end);
}

test('message analytics details live on the Messages tab', () => {
    const messages = tabMarkup('stats');
    const summary = tabMarkup('analytics');

    for (const id of ['analyticsDays', 'analyticsChannel', 'analyticsMember', 'analyticsChart', 'messageHeatmap', 'analyticsChannels', 'analyticsUsers']) {
        assert.match(messages, new RegExp(`id="${id}"`));
        assert.doesNotMatch(summary, new RegExp(`id="${id}"`));
    }
});

test('Stats & Analytics is a lightweight cross-feature summary', () => {
    const summary = tabMarkup('analytics');
    for (const id of ['analyticsSummaryMessages', 'analyticsSummaryVoice', 'analyticsSummaryMedia', 'analyticsSummaryShots', 'moderationCards']) {
        assert.match(summary, new RegExp(`id="${id}"`));
    }
    assert.match(summary, /data-manager-only/);
    assert.doesNotMatch(tabMarkup('stats'), /id="moderationCards"/);
    assert.match(panelHtml, /data-tab="analytics"[^>]*>Stats &amp; Analytics<\/button>/);
    assert.match(panelHtml, /data-tab="stats"[^>]*>Messages<\/button>/);
});

test('sidebar uses the Flummi profile image and name lockup', () => {
    assert.match(panelHtml, /class="brand-image" src="\/assets\/branding\/flummi-pfp\.jpeg"/);
    assert.match(panelHtml, /<h1>Flummi<\/h1>/);
    assert.match(panelHtml, /<p class="sub">Dashboard<\/p>/);
    assert.doesNotMatch(panelHtml, /class="brand-banner"/);
});

test('overview separates human members from bots', () => {
    assert.match(panelServer, /memberCount: humanMemberCount/);
    assert.match(panelServer, /botCount,/);
    assert.match(panelHtml, /statCard\('Members', guildInfo\.memberCount \?\? 'Unavailable'\)/);
    assert.match(panelHtml, /statCard\('Bots', guildInfo\.botCount \?\? 'Unavailable'\)/);
    assert.doesNotMatch(panelHtml, /statCard\('Developers', data\.developerCount\)/);
});

test('moderation analytics are withheld from regular-user API responses', () => {
    assert.match(panelServer, /events: canViewModeration \? messages\.moderation : null/);
    assert.match(panelServer, /analytics\.moderation = null/);
});

test('every panel tab starts with a consistent description', () => {
    for (const id of ['overview', 'analytics', 'messenger', 'triggers', 'shots', 'voice', 'stats', 'users', 'settings', 'pings', 'profiles', 'ai', 'logs', 'reliability', 'soundboard', 'audit', 'experiments']) {
        assert.match(tabMarkup(id), /<h2 style="font-size:20px;">[\s\S]*?<\/h2>\s*<p class="sub tab-intro">/, `${id} should have a top-level description`);
    }
});

test('Voice and Server Media use matching top-level period controls', () => {
    for (const id of ['voice', 'soundboard']) {
        const markup = tabMarkup(id);
        assert.match(markup, /class="row tab-controls"/);
        assert.match(markup, />Period<\/label>/);
    }
    assert.match(tabMarkup('voice'), /<option value="all">All time<\/option>/);
});

test('audit log renders structured setting changes in their own column', () => {
    assert.match(panelHtml, /\{ label: 'Changes', key: 'changes'/);
    assert.match(panelHtml, /function renderAuditChanges\(changes\)/);
});
