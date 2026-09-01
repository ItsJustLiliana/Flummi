const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const panelMarkup = fs.readFileSync(path.join(__dirname, '..', 'panel', 'index.html'), 'utf8');
const panelStyles = fs.readFileSync(path.join(__dirname, '..', 'panel', 'styles.css'), 'utf8');
const panelScript = fs.readFileSync(path.join(__dirname, '..', 'panel', 'app.js'), 'utf8');
const panelI18n = fs.readFileSync(path.join(__dirname, '..', 'panel', 'i18n', 'engine.js'), 'utf8');
const panelDutch = fs.readFileSync(path.join(__dirname, '..', 'panel', 'i18n', 'locales', 'nl.js'), 'utf8');
const panelGerman = fs.readFileSync(path.join(__dirname, '..', 'panel', 'i18n', 'locales', 'de.js'), 'utf8');
const panelHtml = `${panelMarkup}\n${panelStyles}\n${panelScript}`;
const panelServer = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');
const operationsService = fs.readFileSync(path.join(__dirname, '..', 'services', 'operations-service.js'), 'utf8');
const promoteScript = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'promote-live.sh'), 'utf8');
const updateRecorder = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'record-update-status.js'), 'utf8');

test('public root is a landing page with role-aware navigation and server groups', () => {
    assert.match(panelServer, /authenticated: false/);
    assert.doesNotMatch(panelServer, /pathname === '\/'\) \{\s*if \(!sessionFor\(req\)\)/);
    for (const id of ['homeShell', 'homeMobileMenuToggle', 'homeDeveloperNav', 'homeGuilds', 'dashboardHome']) {
        assert.match(panelHtml, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /row\.displayRole === 'admin'/);
    const sidebarStart = panelHtml.indexOf('<aside class="sidebar">');
    const sidebarEnd = panelHtml.indexOf('</aside>', sidebarStart);
    const sidebar = panelHtml.slice(sidebarStart, sidebarEnd);
    assert.doesNotMatch(sidebar, /<label for="guild">|<select id="guild"/);
    assert.ok(sidebar.indexOf('id="refreshAll"') > sidebar.indexOf('</nav>'));
    assert.ok(sidebar.indexOf('id="refreshAll"') < sidebar.indexOf('id="panelAccount"'));
    assert.doesNotMatch(panelMarkup, /id="logoutPanel"|id="homeLogout"/);
    assert.equal((panelMarkup.match(/data-account-logout/g) || []).length, 2);
    assert.match(panelScript, /function logoutToHome\(\)[\s\S]*?window\.location\.assign\('\/'\)[\s\S]*?querySelectorAll\('\[data-account-logout\]'\)/);
    assert.match(panelHtml, /class="home-auth-button" href="\/auth\/login"/);
    assert.match(panelHtml, /id="homeSignedIn" class="[^"]*home-account-card[^"]*"/);
    assert.match(panelMarkup, /id="panelAccount"[\s\S]*?data-account-destination="account-profile"[\s\S]*?data-account-destination="notifications"[\s\S]*?data-account-logout/);
    assert.match(panelMarkup, /class="home-footer"[\s\S]*?id="homeInviteLink"[\s\S]*?data-invite-link/);
    assert.equal((panelMarkup.match(/data-invite-link/g) || []).length, 4);
    assert.match(panelMarkup, /id="homeNoServers"[\s\S]*?class="home-nav-invite home-empty-invite"[\s\S]*?>Add Flummi to your server<\/a>/);
    assert.match(panelScript, /emptyState\.hidden = rows\.length > 0;[\s\S]*?groupContainer\.hidden = rows\.length === 0/);
    assert.match(panelMarkup, /class="home-nav-links"[\s\S]*?>Home<\/button>[\s\S]*?class="home-nav-invite"/);
    for (const group of ['Product', 'Contact', 'Legal']) assert.match(panelMarkup, new RegExp(`<summary><span class="home-nav-label">${group}`));
    assert.match(panelMarkup, /<summary><span class="home-nav-label">Contact[\s\S]*?data-home-view="support"[\s\S]*?data-home-view="feedback"/);
    assert.match(panelMarkup, /<summary><span class="home-nav-label">Legal[\s\S]*?data-home-view="terms"[\s\S]*?data-home-view="privacy"[\s\S]*?data-home-view="credits"/);
    assert.match(panelStyles, /\.home-nav-invite \{[\s\S]*?background: linear-gradient\(135deg, #9be2ff, #65bff2\)/);
    assert.match(panelScript, /document\.querySelectorAll\('\[data-invite-link\]'\)/);
    assert.match(panelScript, /loadInviteLink\(\)[\s\S]*?const authenticated = await loadPanelAccount\(\)/);
    assert.match(panelServer, /pathname === '\/api\/invite-link'[\s\S]*?let panelSession = null/);
    for (const permission of ['ViewAuditLog', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ManageMessages', 'ModerateMembers', 'ManageEvents']) {
        assert.match(panelServer, new RegExp(`'${permission}'`));
    }
});

test('home pages and selected servers use descriptive browser titles', () => {
    assert.match(panelMarkup, /<title>Home - Flummi<\/title>/);
    for (const [view, title] of Object.entries({
        servers: 'Home - Flummi',
        commands: 'Commands - Flummi',
        status: 'Status - Flummi',
        support: 'Support - Flummi',
        feedback: 'Feedback - Flummi',
        developer: 'Developer Tools - Flummi'
    })) {
        assert.match(panelScript, new RegExp(`${view}: '${title}'`));
    }
    assert.match(panelScript, /document\.title = guild\?\.name \? `\$\{guild\.name\} \| Flummi` : \(window\.FlummiI18n\?\.t\('Server \| Flummi'\) \|\| 'Server \| Flummi'\)/);
    assert.match(panelScript, /function openDashboard\([\s\S]*?setServerPageTitle\(state\.guildId\)/);
});

test('English, Dutch, and German are available throughout the shared dashboard shell', () => {
    assert.equal((panelMarkup.match(/data-language-select/g) || []).length, 2);
    assert.match(panelMarkup, /<option value="en">English<\/option><option value="nl">Nederlands<\/option><option value="de">Deutsch<\/option>/);
    const publicHeader = panelMarkup.slice(panelMarkup.indexOf('<header class="home-nav">'), panelMarkup.indexOf('</header>'));
    const publicFooter = panelMarkup.slice(panelMarkup.indexOf('<footer class="home-footer">'), panelMarkup.indexOf('</footer>'));
    assert.doesNotMatch(publicHeader, /data-language-select/);
    assert.match(publicFooter, /Friendly Discord server management\.[\s\S]*?class="language-picker language-picker-footer"[\s\S]*?data-language-select/);
    assert.match(panelMarkup, /<script src="\/panel\/i18n\/locales\/en\.js" defer><\/script>[\s\S]*?<script src="\/panel\/i18n\/locales\/nl\.js" defer><\/script>[\s\S]*?<script src="\/panel\/i18n\/locales\/de\.js" defer><\/script>[\s\S]*?<script src="\/panel\/i18n\/engine\.js" defer><\/script>/);
    assert.match(panelI18n, /const supportedLanguages = new Set\(Object\.keys\(locales\)\)/);
    assert.match(panelDutch, /'Management': 'Beheer'/);
    assert.match(panelDutch, /'Members & Permissions': 'Leden & rechten'/);
    assert.match(panelGerman, /'Management': 'Verwaltung'/);
    assert.match(panelGerman, /'Members & Permissions': 'Mitglieder & Berechtigungen'/);
    assert.match(panelI18n, /localStorage\.setItem\(storageKey, language\)/);
    assert.match(panelI18n, /document\.documentElement\.lang = language/);
    assert.match(panelScript, /window\.addEventListener\('flummi:languagechange'/);
    assert.match(panelScript, /function uiText\(source\)/);
    assert.match(panelI18n, /function fallbackTranslation\(source\)/);
    assert.match(panelI18n, /new MutationObserver\(records =>/);
    assert.match(panelI18n, /registerStaticContent\(node, \{ exactOnly: true \}\)/);
    assert.match(panelScript, /function uiValue\(source\)/);
    assert.doesNotThrow(() => new Function(panelI18n));
    assert.doesNotThrow(() => new Function(panelDutch));
    assert.doesNotThrow(() => new Function(panelGerman));
    assert.doesNotMatch(`${panelDutch}\n${panelGerman}`, /(?:Ã.|Â.|â€|â€™|ðŸ|ï¸|�)/);
});

test('personal account settings are centralised and remain available without a server', () => {
    for (const label of ['Your Flummi profile', 'AI consent', 'AI memory', 'Personal notifications', 'Dashboard preferences', 'Accessibility']) {
        assert.match(panelMarkup, new RegExp(label));
    }
    assert.match(panelServer, /pathname === '\/api\/account\/ai-memory'[\s\S]*?getUserConversationSummary\(panelSession\.userId\)[\s\S]*?clearUserHistory\(panelSession\.userId\)/);
    assert.match(panelMarkup, /id="homeViewAccount" class="home-view account-page"[\s\S]*?data-account-tab="profile"[\s\S]*?data-account-tab="consent"[\s\S]*?data-account-tab="memory"[\s\S]*?data-account-tab="notifications"[\s\S]*?data-account-tab="preferences"/);
    assert.doesNotMatch(panelMarkup, /id="tab-(?:notifications|account-profile)"/);
    assert.doesNotMatch(panelMarkup, /id="operationsSearch"|id="operationsSearchResults"/);
    assert.match(panelServer, /publicPagePaths = new Set\(\[[^\]]*'\/account'/);
    assert.match(panelStyles, /\.account-page-tabs \{[\s\S]*?overflow-x: auto/);
    assert.match(panelScript, /async function openAccountArea[\s\S]*?showHomeView\('account'\)[\s\S]*?\/account\?tab=/);
    assert.match(panelScript, /querySelectorAll\('\[data-account-panel\]'\)[\s\S]*?panel\.hidden = panel\.dataset\.accountPanel !== destination/);
    assert.match(panelScript, /api\(`\/api\/notifications\$\{query \? `\?q=/);
    assert.match(panelScript, /persistentChildren = \[\.\.\.button\.children\]\.filter\(child => child\.matches\('\.nav-count'\)\)[\s\S]*?button\.replaceChildren/);
});

test('expanded nested navigation scrolls without shrinking the Flummi brand', () => {
    assert.match(panelStyles, /\.brand \{[\s\S]*?flex: 0 0 auto;/);
    assert.match(panelStyles, /\.tabs \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/);
    assert.match(panelStyles, /\.sidebar-footer \{[\s\S]*?flex-shrink: 0;/);
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
    assert.match(panelServer, /const publicBotUpdatedAt = release\.live\?\.promotedAt[\s\S]*?\|\| updateStatus\.lastPromotedAt/);
    assert.match(panelServer, /publicBotUpdatedAt,[\s\S]*?lastLiveUpdateAt: publicBotUpdatedAt/);
    assert.match(panelServer, /pathname === '\/api\/public\/status'[\s\S]*?Cache-Control', 'no-store'/);
    assert.match(panelMarkup, /id="publicStatusUpdated"/);
    assert.match(panelMarkup, /id="publicStatusChecked"/);
    assert.match(panelMarkup, /Latest bot update/);
    assert.match(panelMarkup, /id="publicStatusComponents"/);
    assert.match(panelServer, /components\.every\(component => component\.status === 'operational'\)/);
    assert.doesNotMatch(panelMarkup, /id="refreshPublicStatus"/);
    assert.match(panelScript, /const publicViews = new Set\(homeViewNames\.filter\(view => view !== 'account'\)\)/);

    const publicCommandsRoute = panelServer.indexOf("requestUrl.pathname === '/api/public/commands'");
    const authenticatedApiGate = panelServer.indexOf("if (requestUrl.pathname.startsWith('/api/'))", publicCommandsRoute);
    assert.ok(publicCommandsRoute >= 0 && authenticatedApiGate > publicCommandsRoute);
});

test('public policy pages use stable routes, dates, archives, licenses, and a structured footer', () => {
    for (const [view, route] of Object.entries({ terms: '/terms', privacy: '/privacy', licenses: '/licenses', archive: '/policy-archive', credits: '/credits' })) {
        assert.match(panelMarkup, new RegExp(`data-home-view="${view}"`));
        assert.match(panelScript, new RegExp(`${view}: '${route.replaceAll('/', '\\/')}'`));
        assert.match(panelServer, new RegExp(`'${route.replaceAll('/', '\\/')}'`));
    }
    assert.match(panelMarkup, /Effective August 26, 2026/);
    assert.match(panelMarkup, /Last updated August 26, 2026/);
    assert.match(panelMarkup, /id="homeViewArchive"/);
    assert.match(panelMarkup, /id="homeViewLicenses"[\s\S]*?id="repositoryLicenseText"/);
    assert.doesNotMatch(panelMarkup, /The text below is loaded directly from the deployed repository/);
    assert.doesNotMatch(panelMarkup, /Permission to use, copy, modify, and\/or distribute/);
    assert.match(panelScript, /api\('\/api\/public\/license'\)/);
    assert.match(panelServer, /pathname === '\/api\/public\/license'[\s\S]*?fs\.readFileSync\(licensePath, 'utf8'\)/);
    assert.match(panelMarkup, /Resources[\s\S]*?Policies[\s\S]*?Credits/);
    assert.match(panelMarkup, /AI conversation memory<\/td><td>90 days/);
    assert.match(panelMarkup, /Anonymous message\/voice daily totals[\s\S]*?Kept for all-time analytics/);
});

test('developer compliance panel records procedures and provider review state', () => {
    assert.match(panelMarkup, /id="developerComplianceOperations"/);
    assert.match(panelMarkup, /Security incidents and data breaches/);
    assert.match(panelHtml, /CONFIRM PROVIDER REVIEW/);
    assert.match(panelServer, /\/api\/developer\/compliance/);
    assert.match(panelServer, /updateOpenRouter\(parsed, panelSession\.user\.id\)/);
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

test('removed permission selectors cannot stop panel initialization after Discord OAuth', () => {
    assert.doesNotMatch(panelMarkup, /id="permUserSelect"/);
    assert.match(panelScript, /const select = document\.getElementById\(selectId\);[\s\S]*?if \(!select \|\| !input\) continue;/);
    assert.ok(panelScript.indexOf('if (!select || !input) continue;') < panelScript.indexOf('async function initializePanel()'));
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

test('feedback and support have public pages while their forms require Discord authentication', () => {
    assert.match(panelHtml, /data-home-view="feedback" type="button">Feedback/);
    assert.match(panelHtml, /data-home-view="support" type="button">Support/);
    assert.match(panelScript, /support: '\/support'/);
    assert.match(panelScript, /feedback: '\/feedback'/);
    assert.match(panelHtml, /id="feedbackSignedOut"[\s\S]*?href="\/auth\/login"[\s\S]*?Log in with Discord/);
    assert.match(panelHtml, /id="feedbackSignedIn" class="home-panel" hidden/);
    assert.match(panelHtml, /id="supportSignedOut"[\s\S]*?href="\/auth\/login"/);
    assert.match(panelHtml, /id="supportSignedIn" class="home-panel" hidden/);
    assert.match(panelHtml, /document\.getElementById\('feedbackSignedOut'\)\.hidden = true/);
    assert.match(panelHtml, /document\.getElementById\('feedbackSignedIn'\)\.hidden = false/);
    assert.match(panelHtml, /document\.getElementById\('supportSignedOut'\)\.hidden = true/);
    assert.match(panelHtml, /document\.getElementById\('supportSignedIn'\)\.hidden = false/);
});

test('developer mail combines support and feedback and replies over Discord DM', () => {
    assert.match(panelMarkup, /data-tab="mail" data-developer-only/);
    assert.match(panelMarkup, /id="tab-mail"[\s\S]*?id="mailCollection"/);
    assert.match(panelScript, /api\('\/api\/mail\/reply'/);
    assert.match(panelServer, /client\.users\.fetch\(thread\.userId\)/);
    assert.match(panelServer, /user\.send\(\{ content:/);
    assert.match(panelServer, /feedbackStore\.appendMessage\(thread\.id/);
});

test('acknowledgements credit the people who built Flummi', () => {
    assert.match(panelMarkup, /Acknowledgements[\s\S]*?Liliana Nuzohra/);
    assert.match(panelMarkup, /https:\/\/github\.com\/ItsJustLiliana/);
    assert.match(panelMarkup, /https:\/\/liliananuzohra\.com/);
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
    assert.match(panelServer, /LIVE_CHECKOUT_DIRTY/);
    assert.match(panelServer, /readTrackedGitChanges\(productionDir\)/);
    assert.match(panelServer, /promotion\.on\('error'/);
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
    assert.match(panelHtml, /const globalFeatureTabs = \{[\s\S]*?triggers: 'triggersEnabled'[\s\S]*?pings: 'pingRequestSaveEnabled'/);
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

test('every management module gets a consistent guide, status, and section navigation', () => {
    assert.match(panelMarkup, /data-management-filter="all"[\s\S]*?data-management-filter="enabled"[\s\S]*?data-management-filter="disabled"/);
    assert.match(panelScript, /function installManagementModuleExperience\(\)/);
    assert.match(panelScript, /for \(const \[key, definition\] of Object\.entries\(managementModuleDefinitions\)\)/);
    assert.match(panelScript, /data-module-guide-toggle/);
    assert.match(panelScript, /data-module-runtime-state/);
    assert.match(panelScript, /data-module-section-target/);
    assert.match(panelScript, /Recommended setup/);
    assert.match(panelScript, /Turning the module off pauses it without deleting its settings/);
    assert.match(panelStyles, /\.module-guide-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(panelStyles, /@media \(max-width: 600px\)[\s\S]*?\.module-guide-grid \{ grid-template-columns: 1fr; \}/);
    assert.match(panelStyles, /\.module-section-highlight/);
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

test('Discord resources are selectable instead of requiring copied IDs', () => {
    for (const id of ['managementAutoroleId', 'managementTicketSupportRole', 'managementSecurityRole', 'managementChannelsVoiceCategory', 'managementActionTarget']) {
        assert.match(panelMarkup, new RegExp(`<select\\s+id="${id}"`));
    }
    assert.match(panelServer, /sendJson\(res, 200, \{ channels, roles, members, bans \}\)/);
    assert.match(panelScript, /function setManagementResourceOptions/);
    assert.doesNotMatch(panelMarkup, /label for="managementAutoroleId">Autorole ID/);
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
    for (const id of ['updateStatusCards', 'releaseComparisonStatus', 'stagedCommitList', 'releaseCenterCommitCount', 'releaseCenterCommitNames']) {
        assert.match(panelHtml, new RegExp(`id="${id}"`));
    }
    assert.match(panelHtml, /statCard\('Staged, not live'/);
    assert.match(panelHtml, /statCard\('Last pushed live'/);
    assert.match(panelHtml, /statCard\('Live push date'/);
    assert.match(panelHtml, /release\.stagedCommits/);
    assert.match(panelHtml, /function renderReleaseCenterSummary\(release = \{\}\)/);
    assert.match(panelHtml, /loadReleaseCenterSummary\(\)/);
    assert.match(panelMarkup, /Release center[\s\S]*?<\/section>[\s\S]*?class="developer-overview-card release-commit-card"[\s\S]*?Staging commits/);
    assert.match(panelServer, /release: buildReleaseStatus\(\)/);
    assert.match(promoteScript, /record-update-status\.js" promoted/);
    assert.ok(promoteScript.indexOf('record-update-status.js" promoted') < promoteScript.indexOf('systemctl --user restart flummi.service'));
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
    assert.match(panelStyles, /@media \(max-width: 600px\)[\s\S]*?\.analytics-date-range \{[\s\S]*?width: 100%/);
    assert.match(panelStyles, /@media \(max-width: 600px\)[\s\S]*?\.analytics-date-editor \{[\s\S]*?width: min\(320px, calc\(100vw - 48px\)\)/);
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
    assert.match(panelStyles, /@media \(max-width: 820px\)[\s\S]*?#dashboardLayout \.tabs \{[\s\S]*?flex-direction: column;/);
    assert.match(panelStyles, /@media \(max-width: 820px\)[\s\S]*?\.developer-tool-nav \{[\s\S]*?flex-direction: column;/);
    assert.match(panelStyles, /@media \(max-width: 820px\)[\s\S]*?\.developer-command-bar \{[\s\S]*?flex-wrap: wrap;/);
    assert.match(panelStyles, /@media \(max-width: 820px\)[\s\S]*?\.developer-command-bar \.secondary \{[\s\S]*?width: 100%;/);
    assert.match(panelStyles, /\.account-menu:not\(\[open\]\) > \.account-menu-popover \{[\s\S]*?display: none;/);
    assert.match(panelStyles, /\.sidebar\.mobile-menu-open \.mobile-sidebar-content \{[\s\S]*?width: min\(360px, calc\(100vw - 44px\)\)/);
    assert.match(panelStyles, /#dashboardLayout \.management-nav-group > \.management-parent \{[\s\S]*?justify-content: center;[\s\S]*?padding-left: 44px;[\s\S]*?text-align: center;/);
    assert.match(panelMarkup, /id="homeMobileMenuPanel" class="home-nav-menu"[\s\S]*?id="homeNavigation"[\s\S]*?class="home-account"/);
    assert.match(panelStyles, /\.home-nav-menu \{[\s\S]*?position: absolute;[\s\S]*?max-height: calc\(100dvh - 92px\)/);
    assert.match(panelStyles, /\.home-account \{[\s\S]*?width: 100%;[\s\S]*?border-top:/);
    assert.match(panelStyles, /\.home-nav-group > summary \{[\s\S]*?grid-template-columns: 1fr auto 1fr;[\s\S]*?text-align: center/);
    assert.match(panelStyles, /@media \(hover: hover\) and \(min-width: 821px\)[\s\S]*?\.home-nav-group:not\(\[open\]\):hover > \.home-nav-popover/);
    assert.match(panelScript, /homeDesktopNavMedia = window\.matchMedia\('\(hover: hover\) and \(min-width: 821px\)'\)/);
    assert.match(panelScript, /group\.addEventListener\('pointerenter'[\s\S]*?homeNavHoveredGroup = group;[\s\S]*?syncDesktopHomeNav\(\)/);
    assert.match(panelScript, /group\.querySelector\('summary'\)\?\.addEventListener\('click'[\s\S]*?homeNavPinnedGroup = homeNavPinnedGroup === group \? null : group/);
    assert.match(panelScript, /group\.addEventListener\('pointerleave'[\s\S]*?homeNavHoveredGroup = null;[\s\S]*?syncDesktopHomeNav\(\)/);
    assert.match(panelScript, /homeMobileMenuToggle\.getAttribute\('aria-expanded'\) === 'true'[\s\S]*?!event\.target\.closest\('#homeMobileMenuPanel'\)[\s\S]*?setHomeMobileMenu\(false\)/);
});

test('sound previews use an edge-to-edge custom progress track', () => {
    assert.match(panelHtml, /--sound-progress/);
    assert.match(panelHtml, /audio\.currentTime \/ duration \* 100/);
    assert.match(panelStyles, /::-webkit-slider-runnable-track/);
    assert.match(panelStyles, /padding: 0;[\s\S]*?background: linear-gradient\(90deg, #75cfff/);
});

test('public site exposes search, social preview, and install metadata', () => {
    assert.match(panelMarkup, /<!--SITE_METADATA-->/);
    assert.match(panelMarkup, /rel="apple-touch-icon"/);
    assert.match(panelMarkup, /rel="manifest" href="\/site\.webmanifest"/);
    assert.match(panelServer, /function buildSiteMetadata\(req\)/);
    for (const metadata of [
        'meta name="description"',
        'rel="canonical"',
        'property="og:title"',
        'name="twitter:card"',
        'application/ld+json'
    ]) {
        assert.match(panelServer, new RegExp(metadata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const route of ['/robots.txt', '/sitemap.xml', '/site.webmanifest']) {
        assert.match(panelServer, new RegExp(`requestUrl\\.pathname === '${route.replace('.', '\\.')}'`));
    }
    assert.match(panelServer, /\.replace\('<!--SITE_METADATA-->', buildSiteMetadata\(req\)\)/);
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
        'fileUploadButton', 'fileRename', 'fileTrash', 'fileSave', 'fileRunTests', 'fileRestart', 'reliabilityRestart'
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

test('developer file actions use friendly in-dashboard dialogs', () => {
    for (const id of ['textInputDialog', 'textInputDialogTitle', 'textInputDialogMessage', 'textInputDialogValue', 'textInputDialogHint', 'textInputDialogError']) {
        assert.match(panelMarkup, new RegExp(`id="${id}"`));
    }
    assert.match(panelScript, /function requestTextInput\(/);
    assert.match(panelScript, /title: isDirectory \? 'Create a new folder' : 'Create a new file'/);
    assert.match(panelScript, /title: 'Rename or move item'/);
    assert.match(panelScript, /title: 'Discard unsaved changes\?'/);
    assert.match(panelScript, /title: 'Reload the saved version\?'/);
    assert.doesNotMatch(panelScript, /window\.prompt/);
    assert.doesNotMatch(panelScript, /fileIsDirty\(\) && !window\.confirm/);
});

test('overview is detail-focused and analytics summary owns compact graphs', () => {
    assert.match(panelHtml, /id="overviewFeatures"/);
    assert.match(panelMarkup, /class="overview-summary-row"[\s\S]*?id="overviewCards"[\s\S]*?class="section overview-details"/);
    assert.doesNotMatch(panelMarkup, /id="overviewQuad"/);
    assert.match(panelStyles, /\.overview-quad \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?align-content: start/);
    assert.match(panelStyles, /@media \(max-width: 460px\)[\s\S]*?\.overview-quad \{ grid-template-columns: 1fr; \}/);
    assert.match(panelScript, /function renderOverviewCards\([\s\S]*?statCard\('Members'[\s\S]*?statCard\('Admins'/);
    assert.doesNotMatch(panelScript, /statCard\('Bot Enabled'/);
    assert.match(panelMarkup, /class="two-col overview-channel-rankings"[\s\S]*?id="overviewChannels"[\s\S]*?id="overviewVoiceChannels"/);
    assert.match(panelScript, /data\.topVoiceChannels/);
    assert.doesNotMatch(panelHtml, /id="overviewMessageChart"|id="overviewVoiceChart"|id="overviewShots"/);
    assert.match(panelHtml, /id="analyticsSummaryRange"/);
    assert.match(panelHtml, /id="analyticsSummaryGraphType"/);
    assert.doesNotMatch(panelHtml, /statCard\('Busiest day'/);
});

test('overview surfaces server health and a recent changes timeline for administrators', () => {
    assert.match(panelMarkup, /id="overviewHealth"/);
    assert.match(panelMarkup, /id="overviewRecentChanges"/);
    assert.match(panelMarkup, /id="openServerDoctor"[\s\S]*?id="openAuditLog"/);
    assert.match(panelServer, /requestUrl\.pathname === '\/api\/overview'[\s\S]*?overview\.health = guild \? await scanServer\(guild\)[\s\S]*?overview\.recentChanges = readActivity\(\)/);
    assert.match(panelScript, /function renderOverviewHealth\(health\)/);
    assert.match(panelScript, /function renderOverviewChanges\(entries = \[\]\)/);
    assert.match(panelServer, /function labelOverviewChanges\(entries, guildId\)[\s\S]*?labels\[id\]\?\.nickname/);
    assert.match(panelServer, /topChannels = statsSummary\.channels\.map[\s\S]*?namedTopVoiceChannels/);
    assert.match(operationsService, /const configuredChannels = \[[\s\S]*?Modmail log/);
    assert.match(operationsService, /const configuredRoles = \[[\s\S]*?Ticket support/);
    assert.match(operationsService, /const requiredModuleSettings = \{[\s\S]*?tickets:[\s\S]*?incidentCenter:/);
});

test('analytics correction loads selectable Discord resources and a usable default range', () => {
    assert.match(panelScript, /activateDeveloperWorkspace[\s\S]*?await ensureManagementResources\(\)/);
    assert.match(panelScript, /function initializeAnalyticsCorrectionRange\(\)[\s\S]*?7 \* 86400000/);
    assert.match(panelServer, /function listKnownGuildMembers\(guildId\)[\s\S]*?getServerStatsSummary[\s\S]*?getVoiceStatsSummary/);
    assert.match(panelServer, /pathname === '\/api\/management\/channels'[\s\S]*?listKnownGuildMembers\(guildId\)/);
});

test('dashboard empty states are contextual and mobile pages keep a reachable Save dock', () => {
    assert.match(panelMarkup, /id="mobileSaveDock"[\s\S]*?id="mobileSaveDockButton"/);
    assert.match(panelScript, /function enhanceDashboardEmptyState\(element\)/);
    assert.match(panelScript, /data-empty-action/);
    assert.match(panelScript, /function updateMobileSaveDock\(preferredElement = null\)/);
    assert.match(panelScript, /\[data-save-management\], \[data-save-advanced\], button\.primary\[id\^="save"\]/);
    assert.match(panelStyles, /@media \(max-width: 820px\)[\s\S]*?\.mobile-save-dock:not\(\[hidden\]\)/);
    assert.match(panelStyles, /padding-bottom: calc\(104px \+ env\(safe-area-inset-bottom\)\)/);
});
