const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const templates = require('../services/config-template-service');
const { simulateWorkflows } = require('../services/workflow-service');
const panelPreferences = require('../stores/panel-preference-store');
const { moduleDependencies, validateManagement } = require('../services/dashboard-experience-service');

const root = path.join(__dirname, '..');
const panel = fs.readFileSync(path.join(root, 'panel', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'panel', 'app.js'), 'utf8');
const accountFeatures = fs.readFileSync(path.join(root, 'panel', 'account-features.js'), 'utf8');
const realtime = fs.readFileSync(path.join(root, 'panel', 'realtime.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'control-panel.js'), 'utf8');

test('account workspace exposes privacy, session, and notification delivery controls', () => {
    for (const tab of ['data', 'sessions']) assert.match(panel, new RegExp(`data-account-tab="${tab}"`));
    assert.match(accountFeatures, /api\/account\/data/);
    assert.match(accountFeatures, /api\/account\/sessions/);
    assert.match(accountFeatures, /notificationDelivery/);
    assert.match(server, /Type DELETE to confirm permanent removal/);
});

test('notification preferences normalize every supported delivery channel', () => {
    const normalized = panelPreferences.normalize('user', { notificationDelivery: { support: 'dm', privacy: 'off', workflow: 'invalid' }, statusSubscription: 'both' });
    assert.equal(normalized.notificationDelivery.support, 'dm');
    assert.equal(normalized.notificationDelivery.privacy, 'off');
    assert.equal(normalized.notificationDelivery.workflow, 'dashboard');
    assert.equal(normalized.statusSubscription, 'both');
});

test('status subscribers are read from the requested storage root', t => {
    const storageRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'flummi-status-subscribers-'));
    t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
    fs.mkdirSync(path.join(storageRoot, 'subscribed-user'), { recursive: true });
    fs.writeFileSync(path.join(storageRoot, 'subscribed-user', 'panel-preferences.json'), JSON.stringify({ statusSubscription: 'dm' }));
    assert.deepEqual(panelPreferences.listStatusSubscribers(storageRoot), [{ userId: 'subscribed-user', delivery: 'dm' }]);
});

test('management validation reports unavailable resources and confirmed module dependencies', () => {
    const guild = { channels: { cache: new Map([['known-channel', {}]]) }, roles: { cache: new Map([['known-role', {}]]) } };
    const result = validateManagement(guild, { modules: { workflows: true, automation: false, tickets: true }, workflows: { rules: [] }, tickets: { categoryId: 'missing-channel', supportRoleId: 'known-role' } });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(warning => warning.code === 'missing-channel'));
    assert.ok(result.warnings.some(warning => warning.code === 'module-dependency' && warning.dependencies.includes('automation')));
    assert.deepEqual(moduleDependencies.workflows, ['automation']);
});

test('configuration templates never copy Discord resource identifiers', () => {
    const result = templates.applyTemplate({ reports: { channelId: 'keep-me', allowAnonymous: true } }, { reports: { channelId: 'remove-me', allowAnonymous: false }, roles: { selfAssignableRoleIds: ['remove-me'] } });
    assert.equal(result.reports.channelId, 'keep-me');
    assert.equal(result.reports.allowAnonymous, false);
    assert.equal(result.roles?.selfAssignableRoleIds, undefined);
});

test('workflow debugger traces matches without executing actions', () => {
    const trace = simulateWorkflows({ workflows: { rules: [{ id: 'young-account', name: 'Young account', enabled: true, event: 'member.join', conditions: [{ field: 'accountAgeDays', operator: 'less-than', value: 7 }], actions: [{ type: 'add-role', roleId: '123' }] }] } }, 'member.join', { accountAgeDays: 2 });
    assert.equal(trace[0].matched, true);
    assert.equal(trace[0].actions[0].wouldRun, true);
    assert.match(trace[0].actions[0].summary, /Would run/);
});

test('staff All inbox, change preview, graph annotations, safe tests, schedules, and SSE are wired', () => {
    assert.match(app, /data-staff-inbox-filter="all"/);
    assert.match(app, /managementChangePreview/);
    assert.match(app, /renderChartAnnotations/);
    assert.match(app, /Safe test result/);
    assert.match(app, /scheduledReportFrequency/);
    assert.match(realtime, /new EventSource\('\/api\/events'\)/);
    assert.match(server, /Content-Type': 'text\/event-stream/);
});

test('new account and realtime behavior is split out of the main frontend bundle', () => {
    assert.match(panel, /panel\/account-features\.js/);
    assert.match(panel, /panel\/realtime\.js/);
    assert.doesNotMatch(accountFeatures, /\bstate\.guildId\b/);
});

test('guided setup, validation, access preview, recovery, attention, examples, palette, dependencies and status subscriptions are wired', () => {
    for (const id of ['overviewAttentionCentre', 'permissionSimulator', 'recoverySettingsHistory', 'publicStatusSubscription', 'commandPalette']) assert.match(panel, new RegExp(`id="${id}"`));
    for (const route of ['/api/management/validate', '/api/management/attention', '/api/management/recovery']) assert.match(server, new RegExp(route.replaceAll('/', '\\/')));
    assert.match(app, /data-module-onboarding/);
    assert.match(app, /Effective access preview/);
    assert.match(app, /Example and options/);
    assert.match(app, /event\.ctrlKey \|\| event\.metaKey/);
    assert.match(app, /Enable dependencies/);
    assert.match(server, /listStatusSubscribers/);
    assert.match(server, /settings: saved, revision: recorded\.revision, changeId: recorded\.entry\.id/);
    assert.match(app, /state\.settingsRevision = data\.revision/);
});
