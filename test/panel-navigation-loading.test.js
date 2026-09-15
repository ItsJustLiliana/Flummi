const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../panel/app.js'), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('refresh restores the requested server and tab without visiting Home', async () => {
    const visits = [];
    const state = {};
    const context = vm.createContext({
        URLSearchParams, console, state,
        window: { location: { pathname: '/', search: '?guildId=123&tab=stats' } },
        sessionStorage: { getItem: () => null, removeItem() {} }, reauthReturnKey: 'return',
        homeViewPaths: { servers: '/', account: '/account' }, homeViewNames: ['servers', 'account'],
        loadInviteLink: async () => {}, loadPanelAccount: async () => true,
        applyAccountPreferences() {}, api: async () => ({ guilds: [{ id: '123' }] }),
        renderHomeGuilds: rows => { state.guilds = rows; },
        showHomeView: view => visits.push(view),
        openDashboard: async (guild, tab) => visits.push([guild, tab])
    });
    vm.runInContext(extract('async function initializePanel()', '// Keep revealed blocks'), context);
    await context.initializePanel();
    assert.deepEqual(visits, [['123', 'stats']]);
});

test('failed initialization preserves the requested URL for retry', async () => {
    const context = vm.createContext({
        URLSearchParams, console, state: {},
        window: { location: { pathname: '/', search: '?guildId=123&tab=voice' } },
        sessionStorage: { getItem: () => null, removeItem() {} }, reauthReturnKey: 'return',
        homeViewPaths: { servers: '/' }, homeViewNames: ['servers'],
        loadInviteLink: async () => {}, loadPanelAccount: async () => true,
        applyAccountPreferences() {}, api: async path => {
            if (path === '/api/guilds') throw new Error('Offline');
            return {};
        },
        showHomeView: () => assert.fail('must not navigate away while restoring')
    });
    vm.runInContext(extract('async function initializePanel()', '// Keep revealed blocks'), context);
    await assert.rejects(context.initializePanel(), /Offline/);
    assert.equal(context.window.location.search, '?guildId=123&tab=voice');
});

test('opening a server shows the dashboard and loads its tab once despite management failure', async () => {
    const elements = { homeShell: { hidden: false }, dashboardLayout: { hidden: true } };
    const loaded = [];
    const state = { guilds: [{ id: '123' }], guildRoles: new Map([['123', 'admin']]) };
    const context = vm.createContext({
        state, window: { location: { hash: '' } }, guildSelect: {}, managementChannelsGuildId: null,
        fillGuildSelect() {}, setServerPageTitle() {}, applyAccessVisibility() {},
        localStorage: { setItem() {}, getItem: () => 'voice' },
        document: { getElementById: id => elements[id] },
        tabButtons: [{ dataset: { tab: 'stats' } }, { dataset: { tab: 'voice' } }],
        fixedDeveloperTabIds: new Set(), history: { replaceState() {} }, encodeURIComponent,
        withGuild: path => path, api: async () => { throw new Error('Management unavailable'); },
        console: { error() {} },
        activateTab: async button => {
            assert.equal(elements.dashboardLayout.hidden, false);
            loaded.push(button.dataset.tab);
        }
    });
    vm.runInContext(extract('async function openDashboard(', 'async function openAccountArea('), context);
    await context.openDashboard('123', 'stats');
    assert.deepEqual(loaded, ['stats']);
    assert.equal(elements.homeShell.hidden, true);
});

test('responses for a previous server are rejected before they can render', async () => {
    const state = { guildId: '123' };
    let complete;
    const context = vm.createContext({
        URL, AbortController, setTimeout, clearTimeout, state,
        window: { location: { origin: 'https://example.test' } },
        fetch: () => new Promise(resolve => { complete = resolve; })
    });
    vm.runInContext(extract('async function api(', 'const reauthReturnKey'), context);
    const request = context.api('/api/analytics?guildId=123');
    state.guildId = '456';
    complete({ ok: true, json: async () => ({ messageCount: 99 }) });
    await assert.rejects(request, error => error.code === 'STALE_GUILD');
});

test('a failed Discord channel list does not prevent statistics loading', async () => {
    const select = { dataset: {}, value: '', innerHTML: '' };
    const context = vm.createContext({
        state: { guildId: '123' }, document: { getElementById: () => select },
        withGuild: path => path, console: { error() {} },
        api: async () => { throw new Error('Discord unavailable'); }
    });
    vm.runInContext(extract('const analyticsChannelFilterRequests = new Map();', 'function renderActivityChart('), context);
    await context.ensureAnalyticsChannelFilter('analyticsChannel', '/api/channels');
    assert.match(select.innerHTML, /All channels/);
    assert.equal(select.dataset.guildId, undefined, 'a later refresh can retry channel discovery');
});

test('concurrent analytics filter refreshes share one channel discovery request', async () => {
    const select = {
        dataset: {}, value: '', innerHTML: '',
        appendChild(option) { this.innerHTML += option.textContent; }
    };
    let resolveRequest;
    let calls = 0;
    const context = vm.createContext({
        Map, state: { guildId: '123' }, document: {
            getElementById: () => select,
            createElement: () => ({ value: '', textContent: '' })
        },
        withGuild: path => path, console: { error() {} },
        api: () => {
            calls += 1;
            return new Promise(resolve => { resolveRequest = resolve; });
        }
    });
    vm.runInContext(extract('const analyticsChannelFilterRequests = new Map();', 'function renderActivityChart('), context);
    const first = context.ensureAnalyticsChannelFilter('analyticsChannel', '/api/channels');
    const second = context.ensureAnalyticsChannelFilter('analyticsChannel', '/api/channels');
    assert.equal(calls, 1);
    resolveRequest({ channels: [{ id: 'general', name: 'general' }] });
    await Promise.all([first, second]);
    assert.equal(select.dataset.guildId, '123');
    assert.match(select.innerHTML, /#general/);
});
