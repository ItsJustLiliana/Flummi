const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelMarkup = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelStyles = fs.readFileSync(path.join(__dirname, '..', 'panel', 'styles.css'), 'utf8');
const panelScript = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
const panelHtml = `${panelMarkup}\n${panelStyles}\n${panelScript}`;
const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');
const promoteScript = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'promote-live.sh'), 'utf8');
const updateRecorder = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'record-update-status.js'), 'utf8');

test('public root is a landing page with role-aware navigation and server groups', () => {
    assert.match(panelServer, /authenticated: false/);
    assert.doesNotMatch(panelServer, /pathname === '\/'\) \{\s*if \(!sessionFor\(req\)\)/);
    for (const id of ['homeShell', 'homeFeedbackNav', 'homeDeveloperNav', 'homeGuilds', 'dashboardHome']) {
        assert.match(panelHtml, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /row\.displayRole === 'admin'/);
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

test('home pages and selected servers use descriptive browser titles', () => {
    assert.match(panelMarkup, /<title>Home - Flummi<\/title>/);
    for (const [view, title] of Object.entries({
        servers: 'Home - Flummi',
        commands: 'Commands - Flummi',
        status: 'Status - Flummi',
        feedback: 'Feedback - Flummi',
        developer: 'Developer Tools - Flummi'
    })) {
        assert.match(panelScript, new RegExp(`${view}: '${title}'`));
    }
    assert.match(panelScript, /document\.title = guild\?\.name \? `\$\{guild\.name\} \| Flummi` : 'Server \| Flummi'/);
    assert.match(panelScript, /function openDashboard\([\s\S]*?setServerPageTitle\(state\.guildId\)/);
});

test('commands and status are public home pages backed by unauthenticated APIs', () => {
    for (const view of ['commands', 'status']) {
        assert.match(panelHtml, new RegExp(`data-home-view="${view}"`));
        assert.match(panelHtml, new RegExp(`id="homeView${view[0].toUpperCase()}${view.slice(1)}"`));
        assert.match(panelServer, new RegExp(`requestUrl\\.pathname === '\/api\/public\/${view}'`));
    }
    assert.match(panelServer, /buildPublicCommandCatalog\(\)/);
    assert.match(panelServer, /accessStore\.getRequiredCommandRole/);
    assert.match(panelServer, /function buildPublicStatus\(\)/);
    assert.match(panelScript, /const publicViews = new Set\(\['servers', 'commands', 'status', 'feedback'\]\)/);

    const publicCommandsRoute = panelServer.indexOf("requestUrl.pathname === '/api/public/commands'");
    const authenticatedApiGate = panelServer.indexOf("if (requestUrl.pathname.startsWith('/api/'))", publicCommandsRoute);
    assert.ok(publicCommandsRoute >= 0 && authenticatedApiGate > publicCommandsRoute);
});

test('dashboard access follows Discord membership and Administrator permission', () => {
    assert.match(panelServer, /sharedGuildIds = userGuilds[\s\S]*?availableGuildIds\.has\(guildId\)/);
    assert.match(panelServer, /member\.permissions\.has\(PermissionsBitField\.Flags\.Administrator\)/);
    assert.match(panelServer, /adminGuildIds\.includes\(String\(guildId\)\) \? 'admin' : 'member'/);
    assert.match(panelScript, /state\.role = \['developer', 'admin', 'member'\]/);
    assert.match(panelMarkup, /Members &amp; Permissions/);
    assert.doesNotMatch(panelServer, /\/api\/managers|\/api\/members\/role|setManagerRole/);
    assert.doesNotMatch(panelScript, /data-role-select|canManageManagers/);
});

test('developer home cards show the real per-server Discord relationship', () => {
    assert.match(panelServer, /displayRole = member\.permissions\.has\(PermissionsBitField\.Flags\.Administrator\) \? 'admin' : 'member'/);
    assert.match(panelServer, /displayRole = 'not a member'/);
    assert.match(panelServer, /role: getPanelGuildRole\(session, guild\.id\),\s*displayRole/);
    assert.match(panelScript, /role: row\.displayRole \|\| row\.role/);
    for (const title of ['Admin access', 'Member access', 'Developer-only access']) {
        assert.match(panelScript, new RegExp(`title: '${title}'`));
    }
});

test('feedback stays public while its form requires Discord authentication', () => {
    assert.match(panelHtml, /id="homeFeedbackNav" data-home-view="feedback"/);
    assert.doesNotMatch(panelHtml, /id="homeFeedbackNav"[^>]*\shidden/);
    assert.match(panelHtml, /id="feedbackSignedOut"[\s\S]*?href="\/auth\/login"[\s\S]*?Log in with Discord/);
    assert.match(panelHtml, /id="feedbackSignedIn" class="home-panel" hidden/);
    assert.match(panelHtml, /document\.getElementById\('feedbackSignedOut'\)\.hidden = true/);
    assert.match(panelHtml, /document\.getElementById\('feedbackSignedIn'\)\.hidden = false/);
});

test('feedback exposes its rate limit and developer-only delete flow', () => {
    assert.match(panelHtml, /one message per minute and up to five messages per hour/);
    assert.match(panelHtml, /error\?\.code === 'FEEDBACK_RATE_LIMITED'/);
    assert.match(panelHtml, /data-feedback-delete/);
    assert.match(panelHtml, /method: 'DELETE'/);
    assert.match(panelServer, /res\.setHeader\('Retry-After'/);
    assert.match(panelServer, /req\.method === 'DELETE' && requestUrl\.pathname === '\/api\/feedback'[\s\S]*?requireDeveloperAccess/);
    assert.match(panelServer, /feedbackStore\.deleteFeedback\(feedbackId\)/);
});

test('feedback, admin audit, autosave, and staged promotion are enforced', () => {
    assert.match(panelServer, /pathname === '\/api\/feedback'/);
    assert.match(panelServer, /The audit log is only available to server administrators/);
    assert.match(panelHtml, /data-tab="audit" data-audit-only/);
    assert.match(panelHtml, /document\.querySelectorAll\('\[data-audit-only\]'\)\.forEach\(element => \{ element\.hidden = !canViewAudit; \}\)/);
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

test('dashboard and developer searches recommend matching boxes and fade unrelated tabs', () => {
    for (const name of ['developer', 'dashboard']) {
        assert.match(panelHtml, new RegExp(`id="${name}Search" type="search"`));
        assert.match(panelHtml, new RegExp(`id="${name}SearchResults" class="developer-search-results" hidden`));
    }
    assert.match(panelHtml, /function setupWorkspaceSearch\(/);
    assert.match(panelHtml, /const panelSearchAliases =/);
    assert.match(panelHtml, /button\.classList\.toggle\('search-muted', Boolean\(query\) && !tabMatches\)/);
    assert.match(panelHtml, /data-workspace-search-result/);
    assert.match(panelHtml, /result\.node\.scrollIntoView/);
    assert.match(panelHtml, /\.developer-tool-nav \.tab-btn\.search-muted \{ opacity: \.34/);
    assert.match(panelHtml, /#dashboardLayout \.tabs \.tab-btn\.search-muted \{ opacity: \.34/);
});

test('global feature switches control tabs and explain effective overview statuses', () => {
    assert.match(panelServer, /globalFeatures: config\.features \|\| \{\}/);
    assert.match(panelHtml, /const globalFeatureTabs = \{[\s\S]*?triggers: 'triggersEnabled'[\s\S]*?shots: 'shotsEnabled'[\s\S]*?pings: 'pingRequestSaveEnabled'/);
    assert.match(panelHtml, /const hide = globallyDisabled && !developerView/);
    assert.match(panelHtml, /button\.dataset\.globalDisabled = String\(globallyDisabled && developerView\)/);
    assert.match(panelHtml, /\.tab-btn\[data-global-disabled="true"\]::after/);
    assert.match(panelHtml, /globallyDisabled[\s\S]*?statCard\(label, 'Off', 'This feature is temporarily turned off globally\.', '!'\)/);
    assert.doesNotMatch(panelHtml, /Off \(global\)/);
    assert.doesNotMatch(panelHtml, /saved server setting is/);
    assert.match(panelHtml, /\.table-wrap td code \{[\s\S]*?white-space: nowrap/);
    assert.match(panelHtml, /function updateTabNavigationStructure\(\)/);
    assert.match(panelHtml, /item\.hidden = !hasBefore \|\| !hasAfter/);
    assert.match(panelHtml, /const globalState = button\.dataset\.globalDisabled === 'true' \? ', globally disabled' : ''/);
});

test('presence updates are applied to both Discord gateway connections', () => {
    assert.match(panelServer, /const \{ applyConfiguredPresence \} = require\('\.\/utils\/presence'\)/);
    assert.match(panelServer, /await client\.login\(botToken\);\s*applyConfiguredPresence\(client\)/);
    assert.match(panelServer, /if \(updates\.presence\) \{\s*applyConfiguredPresence\(client\)/);
});

test('command deployment keeps normal commands global and restricted commands guild-only', () => {
    const deploySource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-commands.js'), 'utf8');
    const stagingService = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'flummi-staging.service'), 'utf8');
    assert.match(deploySource, /checkoutName\.endsWith\('-staging'\) \? 'guild' : 'global'/);
    assert.match(deploySource, /process\.env\.FLUMMI_COMMAND_SCOPE \|\| config\.commandDeploymentScope \|\| defaultDeploymentScope/);
    assert.match(deploySource, /deploymentScope === 'guild'/);
    assert.match(deploySource, /Routes\.applicationCommands\(config\.clientId\), \{ body: \[\] \}/);
    assert.match(deploySource, /!Array\.isArray\(command\.allowedGuildIds\) \|\| command\.allowedGuildIds\.includes\(guildId\)/);
    assert.match(stagingService, /Environment=FLUMMI_COMMAND_SCOPE=guild/);
    assert.match(stagingService, /Environment=FLUMMI_DEPLOY_COMMANDS_ON_START=true/);
    assert.match(deploySource, /const globalCommands = commands\s*\.filter\(command => !Array\.isArray\(command\.allowedGuildIds\)\)/);
    assert.match(deploySource, /const guildCommands = commands\s*\.filter\(command => Array\.isArray\(command\.allowedGuildIds\) && command\.allowedGuildIds\.includes\(guildId\)\)/);
    assert.doesNotMatch(deploySource, /globalCommandNames/);
});

test('management pages stay in the nested sidebar while their modules can be toggled', () => {
    assert.match(panelHtml, /id="managementNavToggle"[\s\S]*?aria-controls="managementSubnav"/);
    assert.match(panelHtml, /id="managementSubnav" class="management-subnav"/);
    for (const module of ['moderation', 'automod', 'cases', 'roles', 'automation']) {
        assert.match(panelHtml, new RegExp(`data-management-module="${module}"`));
        assert.match(panelHtml, new RegExp(`${module}: \\{ tab: 'management-${module}'`));
    }
    assert.match(panelHtml, /data-toggle-management="\$\{escapeHtml\(key\)\}"/);
    assert.match(panelHtml, /class="module-toggle"[\s\S]*?aria-pressed="\$\{enabled\}"/);
    assert.match(panelHtml, /state\.management\.modules\[moduleKey\] = nextEnabled/);
    assert.match(panelHtml, /button\.hidden = false/);
    assert.match(panelHtml, /data-page-module-toggle="moderation"/);
    assert.match(panelHtml, /function normalizeEditableTabOrder\(order\)/);
    assert.match(panelHtml, /const childOrder = \[\.\.\.group\.children\]\.sort/);
    assert.match(panelHtml, /leftLabel\.localeCompare\(rightLabel/);
    assert.match(panelHtml, /subnav\.appendChild\(child\)/);
    assert.match(panelHtml, /data-tab-order-entry="\$\{escapeHtml\(entry\)\}"/);
    assert.match(panelHtml, /filter\(entry => !nestedChildTabIds\.has\(entry\)\)/);
    assert.match(panelHtml, /group\.parent === entry/);
    assert.match(panelHtml, /<span class="badge accent">Group<\/span>/);
    assert.match(panelHtml, /id="managementModuleSearch"[^>]*type="search"/);
    assert.match(panelHtml, /function filterManagementModules\(\)/);
    assert.match(panelHtml, /searchableText\.includes\(query\)/);
    assert.match(panelHtml, /id="managementModuleEmpty" class="empty" hidden/);
});

test('nested tabs are alphabetical and folded by default', () => {
    assert.match(panelHtml, /id="analyticsNavPage"[^>]*data-tab="analytics"/);
    assert.match(panelHtml, /id="analyticsNavToggle"[\s\S]*?aria-controls="analyticsSubnav"/);
    const analyticsGroup = panelHtml.slice(panelHtml.indexOf('id="analyticsNavGroup"'), panelHtml.indexOf('id="managementNavGroup"'));
    for (const tab of ['stats', 'voice', 'soundboard']) assert.match(analyticsGroup, new RegExp(`data-tab="${tab}"[^>]*data-analytics-child`));
    assert.match(panelHtml, /const analyticsChildTabIds = new Set\(\['stats', 'voice', 'soundboard'\]\)/);
    assert.match(panelHtml, /parent: 'analytics', label: 'Analytics'/);
    assert.match(panelHtml, /id="analyticsNavToggle"[^>]*aria-expanded="false"/);
    assert.match(panelHtml, /id="analyticsSubnav" class="management-subnav" hidden/);
    assert.match(panelHtml, /id="managementNavToggle"[^>]*aria-expanded="false"/);
    assert.match(panelHtml, /id="managementSubnav" class="management-subnav" hidden/);
    assert.doesNotMatch(panelHtml, /setAnalyticsExpanded\(true\);\s*if \(state\.role !== 'member'\) setManagementExpanded\(true\)/);
    assert.match(panelHtml, /applyTabNames\(window\.__PANEL_TAB_NAMES__\);\s*applyTabOrder\(window\.__PANEL_TAB_ORDER__\);/);
    assert.match(panelHtml, /class="nested-nav-toggle"/);
    assert.match(panelHtml, /analyticsNavToggle'\)\.addEventListener\('click'/);
    assert.match(panelHtml, /Collapse' : 'Expand'\} Analytics tabs/);
});

test('management configuration remains admin-only and saves through guild settings', () => {
    assert.match(panelHtml, /id="tab-management"[^>]*data-admin-only/);
    assert.match(panelHtml, /id="tab-management-automod"[^>]*data-admin-only/);
    assert.match(panelHtml, /body: JSON\.stringify\(\{ management: state\.management \}\)/);
    assert.match(panelServer, /requireSettingsAccess\(panelSession, guildId, res\)/);
    assert.match(panelServer, /'management\.modules\.moderation': 'Moderation module'/);
});

test('management modules include live actions, case timelines, AutoMod rules, role menus, and automation rules', () => {
    assert.match(panelHtml, /id="managementRunAction"/);
    assert.match(panelHtml, /id="managementCasesTable"/);
    assert.match(panelHtml, /id="managementBlockedTerms"/);
    assert.match(panelHtml, /id="managementAutomodRules"/);
    assert.match(panelHtml, /externalLinks: \{ title: 'External links'/);
    assert.match(panelHtml, /data-automod-toggle/);
    assert.match(panelHtml, /id="managementPublishRoles"/);
    assert.match(panelHtml, /id="managementSchedules"/);
    assert.match(panelServer, /\/api\/management\/cases/);
    assert.match(panelServer, /\/api\/management\/action/);
    assert.match(panelServer, /\/api\/management\/roles\/publish/);
    assert.match(panelServer, /Cases and event logs are only available to server administrators/);
});

test('GitHub update status compares staged and live commits and records promotions', () => {
    for (const id of ['updateStatusCards', 'releaseComparisonStatus', 'stagedCommitList']) {
        assert.match(panelHtml, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /statCard\('Staged, not live'/);
    assert.match(panelHtml, /statCard\('Last pushed live'/);
    assert.match(panelHtml, /statCard\('Live push date'/);
    assert.match(panelHtml, /release\.stagedCommits/);
    assert.match(panelServer, /release: buildReleaseStatus\(\)/);
    assert.match(promoteScript, /record-update-status\.js" promoted/);
    assert.match(updateRecorder, /status\.lastPromotedAt = now/);
    assert.match(updateRecorder, /status\.lastPromotedCommit = execFileSync/);
});

test('dashboard reuses the landing surface styling and primary buttons keep a clean focus edge', () => {
    assert.match(panelHtml, /#dashboardLayout \{[\s\S]*?radial-gradient/);
    assert.match(panelHtml, /\.home-shell \{[\s\S]*?background-attachment: fixed, fixed, fixed/);
    assert.match(panelHtml, /#dashboardLayout \{[\s\S]*?background-attachment: fixed, fixed, fixed/);
    assert.match(panelHtml, /#dashboardLayout \.sidebar \{[\s\S]*?backdrop-filter: blur\(22px\)/);
    assert.match(panelHtml, /\.primary:focus:not\(:focus-visible\)/);
    assert.match(panelHtml, /button:focus-visible,[\s\S]*?\.invite-btn:focus-visible/);
});

test('landing, developer tools, and dashboard adapt to touch screens and tablets', () => {
    assert.match(panelHtml, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(panelHtml, /@media \(min-width: 821px\) and \(max-width: 1000px\)[\s\S]*?#dashboardLayout \.sidebar[\s\S]*?width: 100%/);
    assert.match(panelHtml, /@media \(max-width: 820px\)[\s\S]*?\.mobile-menu-toggle[\s\S]*?display: inline-flex/);
    assert.match(panelHtml, /matchMedia\('\(max-width: 820px\)'\)/);
    assert.match(panelHtml, /select,[\s\S]*?input,[\s\S]*?textarea \{[\s\S]*?font-size: 16px/);
    assert.match(panelHtml, /\.sound-player \{[\s\S]*?grid-template-columns: 34px minmax\(0, 1fr\) 58px/);
    assert.match(panelHtml, /@media \(max-width: 600px\)[\s\S]*?\.developer-search-result \{ grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(panelHtml, /@media \(max-width: 420px\)[\s\S]*?\.home-nav-inner/);
    assert.match(panelHtml, /@media \(prefers-reduced-motion: reduce\)/);
    const sidebarStart = panelHtml.indexOf('<aside class="sidebar">');
    const sidebarEnd = panelHtml.indexOf('</aside>', sidebarStart);
    const sidebar = panelHtml.slice(sidebarStart, sidebarEnd);
    assert.ok(sidebar.indexOf('id="dashboardHome"') < sidebar.indexOf('id="mobileMenuToggle"'));
    assert.ok(sidebar.indexOf('id="dashboardSearch"') < sidebar.indexOf('<nav class="tabs"'));
    assert.ok(sidebar.indexOf('<nav class="tabs"') < sidebar.indexOf('class="sidebar-footer"'));
    assert.match(panelHtml, /\.sidebar \{[\s\S]*?overflow: hidden/);
    assert.match(panelHtml, /\.tabs \{[\s\S]*?flex: 1 1 auto;[\s\S]*?overflow-y: auto/);
    assert.match(panelHtml, /#dashboardLayout \.brand \{ width: 100%; padding: 0; border-bottom: 0; \}/);
});

test('Tailscale-only features are disabled and explained on public sessions', () => {
    assert.match(panelHtml, /state\.privateConnection = data\.privateConnection === true/);
    assert.match(panelHtml, /function applyTailscaleAvailability\(root = document\)/);
    assert.match(panelHtml, /This feature is only available through the direct Tailscale or localhost panel/);
    assert.match(panelHtml, /data-tailscale-disabled="true"/);
    assert.match(panelHtml, /control\.dataset\.tailscaleWasDisabled = String\(control\.disabled\)/);
    assert.match(panelHtml, /entry\.privateOnly \? 'data-tailscale-required' : ''/);

    for (const id of [
        'fileNew', 'fileNewFolder', 'fileSearch', 'fileSearchButton', 'fileUpload',
        'fileUploadButton', 'fileRename', 'fileTrash', 'fileSave', 'fileRunTests', 'fileRestart'
    ]) {
        assert.match(panelHtml, new RegExp(`id="${id}"[^>]*data-tailscale-required`));
    }
    assert.match(panelHtml, /class="developer-overview-card" data-tailscale-required[\s\S]*?id="promoteLiveRelease"/);
    assert.match(panelHtml, /id="developerSiteSettings" class="section" data-tailscale-required/);
});

test('panel markup keeps unique ids and syntactically valid inline scripts', () => {
    const ids = Array.from(panelHtml.matchAll(/\sid="([^"]+)"/g), match => match[1]).filter(id => !id.includes('${'));
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    assert.deepEqual(duplicates, []);

    const inlineScripts = Array.from(panelHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g), match => match[1]).filter(Boolean);
    for (const script of inlineScripts) assert.doesNotThrow(() => new Function(script));
    assert.match(panelMarkup, /<link rel="stylesheet" href="\/panel\/styles\.css">/);
    assert.match(panelMarkup, /<script src="\/panel\/app\.js" defer><\/script>/);
    assert.doesNotThrow(() => new Function(panelScript));
});

test('expired developer authentication offers an in-place refresh action and restores context', () => {
    assert.match(panelHtml, /id="fileRefreshAuthentication"[\s\S]*?>Refresh Discord sign-in<\/button>/);
    assert.match(panelHtml, /error\?\.code === 'REAUTH_REQUIRED'/);
    assert.match(panelHtml, /button\.textContent = 'Refresh Discord sign-in'/);
    assert.match(panelHtml, /sessionStorage\.setItem\(reauthReturnKey, returnTo\)/);
    assert.match(panelHtml, /history\.replaceState\(null, '', reauthReturn\)/);
});

test('overview is detail-focused and analytics summary owns compact graphs', () => {
    assert.match(panelHtml, /id="overviewFeatures"/);
    assert.doesNotMatch(panelHtml, /id="overviewMessageChart"|id="overviewVoiceChart"|id="overviewShots"/);
    assert.match(panelHtml, /id="analyticsSummaryRange"/);
    assert.match(panelHtml, /id="analyticsSummaryGraphType"/);
    assert.doesNotMatch(panelHtml, /statCard\('Busiest day'/);
});
