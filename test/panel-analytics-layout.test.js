const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelMarkup = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelStyles = fs.readFileSync(path.join(__dirname, '..', 'panel', 'styles.css'), 'utf8');
const panelScript = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
const panelHtml = `${panelMarkup}\n${panelStyles}\n${panelScript}`;
const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');

function tabMarkup(id) {
    const start = panelHtml.indexOf(`<section id="tab-${id}"`);
    assert.notEqual(start, -1, `tab-${id} should exist`);
    const end = panelHtml.indexOf('\n            <section id="tab-', start + 1);
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

test('message and voice heatmaps offer all-time and navigable weekly modes', () => {
    for (const kind of ['message', 'voice']) {
        assert.match(panelHtml, new RegExp(`id="${kind}HeatmapMode"`));
        assert.match(panelHtml, new RegExp(`id="${kind}HeatmapPreviousWeek"`));
        assert.match(panelHtml, new RegExp(`id="${kind}HeatmapNextWeek"`));
        assert.match(panelHtml, new RegExp(`id="${kind}HeatmapWeekLabel"`));
        assert.ok(panelHtml.indexOf(`id="${kind}HeatmapWeekControls"`) < panelHtml.indexOf(`id="${kind}HeatmapMode"`));
    }
    assert.match(panelHtml, /<option value="all">All time<\/option>/);
    assert.match(panelHtml, /<option value="weekly">Weekly<\/option>/);
    assert.match(panelHtml, /function utcWeekRange\(offset = 0\)/);
    assert.match(panelServer, /requestUrl\.pathname === '\/api\/activity-heatmap'/);
});

test('voice and message graph controls are centralized at the top of their tabs', () => {
    for (const tabId of ['voice', 'stats']) {
        const markup = tabMarkup(tabId);
        const controlsStart = markup.indexOf('class="row tab-controls"');
        const controlsEnd = markup.indexOf('</div>', controlsStart);
        const firstSection = markup.indexOf('<div class="section">');
        assert.ok(controlsStart >= 0 && controlsEnd < firstSection);
    }
    const voice = tabMarkup('voice');
    const messages = tabMarkup('stats');
    for (const id of ['voiceGraphRange', 'voiceGraphChannel', 'voiceGraphType']) {
        assert.ok(voice.indexOf(`id="${id}"`) < voice.indexOf('<div class="section">'));
    }
    for (const id of ['analyticsDays', 'analyticsChannel', 'analyticsMember', 'analyticsGraphType']) {
        assert.ok(messages.indexOf(`id="${id}"`) < messages.indexOf('<div class="section">'));
    }
    assert.ok(voice.indexOf('id="voiceHeatmapMode"') > voice.indexOf('Voice activity by day and hour'));
    assert.ok(messages.indexOf('id="messageHeatmapMode"') > messages.indexOf('Message activity by day and hour'));
});

test('Stats & Analytics is a lightweight cross-feature summary', () => {
    const summary = tabMarkup('analytics');
    for (const id of ['analyticsSummaryMessages', 'analyticsSummaryVoice', 'analyticsSummaryMedia', 'moderationCards']) {
        assert.match(summary, new RegExp(`id="${id}"`));
    }
    assert.match(summary, /data-admin-only/);
    assert.doesNotMatch(tabMarkup('stats'), /id="moderationCards"/);
    assert.match(panelHtml, /data-tab="analytics"[^>]*>Stats &amp; Analytics<\/button>/);
    assert.match(panelHtml, /data-tab="stats"[^>]*>Messages<\/button>/);
});

test('sidebar uses the canonical Flummi logo and name lockup', () => {
    assert.match(panelHtml, /class="brand-image" src="\/assets\/branding\/flummi\.png"/);
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

test('moderation analytics are withheld from member API responses', () => {
    assert.match(panelServer, /events: canViewModeration \? messages\.moderation : null/);
    assert.match(panelServer, /analytics\.moderation = null/);
});

test('every panel tab starts with a consistent description', () => {
    for (const id of ['overview', 'analytics', 'messenger', 'triggers', 'voice', 'stats', 'users', 'settings', 'pings', 'profiles', 'ai', 'global', 'files', 'logs', 'reliability', 'soundboard', 'audit', 'experiments']) {
        assert.match(tabMarkup(id), /<h2 style="font-size:20px;">[\s\S]*?<\/h2>\s*<p class="sub tab-intro">/, `${id} should have a top-level description`);
    }
});

test('global platform controls have their own developer tab', () => {
    const globalSettings = tabMarkup('global');
    const aiSystem = tabMarkup('ai');
    const guildSettings = tabMarkup('settings');

    for (const id of ['developerSiteSettings', 'publicPanelEnabled', 'savePublicPanelAccess', 'developerGlobalFeatures', 'developerTabOrder', 'analyticsRetentionDays', 'tabOrderEditor']) {
        assert.match(globalSettings, new RegExp(`id="${id}"`));
        assert.doesNotMatch(aiSystem, new RegExp(`id="${id}"`));
        assert.doesNotMatch(guildSettings, new RegExp(`id="${id}"`));
    }
    assert.match(aiSystem, /id="aiTextModel"/);
    assert.match(aiSystem, /id="panelEnabledOnStart"/);
    assert.match(panelHtml, /data-tab="global"[^>]*data-developer-only[^>]*>Global Settings<\/button>/);
    assert.match(panelHtml, /global: loadGlobalSettings/);
    assert.match(panelHtml, /data-developer-tab-name=/);
    assert.match(panelHtml, /editableTabNames\[input\.dataset\.developerTabName\]/);
    assert.match(panelHtml, /panel: \{ publicAccessEnabled: enabled \}/);
});

test('trigger JSON import is only exposed inside developer data tools', () => {
    assert.doesNotMatch(tabMarkup('triggers'), /id="importTriggers"/);
    const toolsStart = panelHtml.indexOf('<div id="developerDataTools"');
    const toolsEnd = panelHtml.indexOf('</div>\n            </section>', toolsStart);
    assert.notEqual(toolsStart, -1);
    assert.match(panelHtml.slice(toolsStart, toolsEnd), /id="importTriggers"/);
    assert.match(panelHtml, /reliabilityPanel\?\.append\(document\.getElementById\('developerDataTools'\)\)/);
});

test('Voice and Server Media use matching top-level period controls', () => {
    for (const id of ['voice', 'soundboard']) {
        const markup = tabMarkup(id);
        assert.match(markup, /class="row tab-controls"/);
        assert.match(markup, />Period[\s\S]*?<\/label>/);
    }
    assert.match(tabMarkup('voice'), /<option value="all">All time<\/option>/);
    assert.match(tabMarkup('soundboard'), /id="mediaGraphType"/);
    assert.match(panelHtml, /document\.getElementById\('mediaGraphType'\)\.value/);
});

test('Messages, Voice, and Server Media share total, range, and previous-period cards', () => {
    for (const id of ['analyticsDays', 'voiceGraphRange', 'mediaRange']) {
        const selected = panelHtml.match(new RegExp(`<select id="${id}"[\\s\\S]*?<\\/select>`))?.[0] || '';
        assert.match(selected, /<option value="30" selected>30 days<\/option>/);
        assert.doesNotMatch(selected, />Last /);
    }
    for (const label of ['Total messages', 'Total voice time', 'Total media uses']) assert.match(panelHtml, new RegExp(label));
    assert.match(panelHtml, /statCard\('Vs previous period'/);
    for (const id of ['messageRangeLabel', 'voiceRangeLabel', 'voiceMinutesRangeLabel', 'soundboardRangeLabel']) assert.match(panelHtml, new RegExp(`id="${id}"`));
});

test('finite analytics periods expose linked date controls and one-day charts keep hourly points', () => {
    for (const rangeId of ['analyticsSummaryRange', 'analyticsDays', 'voiceGraphRange', 'mediaRange']) {
        assert.match(panelHtml, new RegExp(`data-range-dates="${rangeId}"`));
    }
    assert.match(panelHtml, /row\.granularity === 'hour'/);
    assert.match(panelHtml, /const maxPoints = hourly \? sourceValues\.length/);
    assert.match(panelHtml, /query: `days=\$\{encodeURIComponent\(value\)\}&from=/);
    assert.match(panelHtml, /wrapper\.classList\.toggle\('is-disabled', allTime\)/);
    assert.doesNotMatch(panelHtml, /wrapper\.hidden = allTime/);
});

test('tooltips activate only from help controls and unavailable Tailscale features', () => {
    assert.doesNotMatch(panelHtml, /surface\.dataset\.tooltip/);
    assert.doesNotMatch(panelHtml, /closest\?\.\('\[data-tooltip\]'\)/);
    assert.match(panelHtml, /const tooltipAnchorSelector = '[^']*\.help-tip\[data-tooltip\][^']*\.tab-btn\[data-global-disabled="true"\]\[data-tooltip\]'/);
    assert.match(panelHtml, /closest\?\.\(tooltipAnchorSelector\)/);
    assert.match(panelHtml, /All tracked voice time, including the current duration of active sessions/);
    assert.match(panelHtml, /immediately preceding period of equal length/);
    assert.match(panelHtml, /Cell intensity is scaled against the busiest cell/);
});

test('analytics tabs tolerate partial API responses and expose GIF counts', () => {
    assert.match(panelHtml, /Array\.isArray\(data\?\.activeSessions\)/);
    assert.match(panelHtml, /Array\.isArray\(analyticsResponse\?\.topUsers\)/);
    assert.match(panelHtml, /statCard\('GIFs', data\.engagement\?\.gifs \|\| 0/);
    assert.match(panelHtml, /A link and its Discord preview count once/);
});

test('bar charts reserve space between Y-axis labels and the first bar', () => {
    assert.match(panelHtml, /const horizontalInset = chartType === 'bar' \? barWidth \/ 2 : 0/);
    assert.match(panelHtml, /left \+ horizontalInset \+ index \* \(pointWidth \/ \(values\.length - 1\)\)/);
    assert.match(panelHtml, /relativeX - left - horizontalInset/);
});

test('audit log renders structured setting changes in their own column', () => {
    assert.match(panelHtml, /\{ label: 'Changes', key: 'changes'/);
    assert.match(panelHtml, /function renderAuditChanges\(changes\)/);
});
