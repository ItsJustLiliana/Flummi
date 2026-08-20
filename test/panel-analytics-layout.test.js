const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');

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
    for (const id of ['analyticsSummaryMessages', 'analyticsSummaryVoice', 'analyticsSummaryMedia', 'analyticsSummaryShots', 'analyticsSummaryEvents']) {
        assert.match(summary, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /data-tab="analytics"[^>]*>Stats &amp; Analytics<\/button>/);
    assert.match(panelHtml, /data-tab="stats"[^>]*>Messages<\/button>/);
});
