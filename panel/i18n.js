(() => {
    'use strict';

    const storageKey = 'flummi.language';
    const supportedLanguages = new Set(['en', 'nl']);
    const translations = {
        nl: {
            'Main navigation': 'Hoofdnavigatie',
            'Home': 'Home',
            'Commands': 'Commando\'s',
            'Status': 'Status',
            'Feedback': 'Feedback',
            'Developer tools': 'Ontwikkelaarstools',
            'Log in with Discord': 'Inloggen met Discord',
            'Log out': 'Uitloggen',
            'Language': 'Taal',
            'Your Flummi workspace': 'Jouw Flummi-werkruimte',
            'Your servers.': 'Jouw servers.',
            'One happy bot.': 'Eén blije bot.',
            'Choose a shared server and jump straight into its controls, activity, and settings.': 'Kies een gedeelde server en ga direct naar het beheer, de activiteit en de instellingen.',
            'Continue with Discord': 'Doorgaan met Discord',
            'Discord command guide': 'Discord-commandogids',
            'Browse every slash command published by Flummi and see the role required to use it.': 'Bekijk alle slashcommando\'s van Flummi en zie welke rol ervoor nodig is.',
            'Find a command': 'Zoek een commando',
            'Search commands and descriptions...': 'Zoek in commando\'s en beschrijvingen...',
            'Loading commands...': 'Commando\'s laden...',
            'Live service health': 'Actuele servicestatus',
            'Current availability of Flummi and its public features.': 'De huidige beschikbaarheid van Flummi en de openbare functies.',
            'Checking status...': 'Status controleren...',
            'Refresh': 'Vernieuwen',
            'Loading status...': 'Status laden...',
            'Help shape Flummi': 'Help Flummi verbeteren',
            'Found something confusing, broken, or worth improving? Send it straight to the people building Flummi.': 'Iets onduidelijk, kapot of voor verbetering vatbaar? Stuur het direct naar het Flummi-team.',
            'Log in to send feedback': 'Log in om feedback te sturen',
            'Discord sign-in keeps submissions useful and lets the team understand who reported an issue.': 'Inloggen met Discord houdt inzendingen bruikbaar en helpt het team begrijpen wie een probleem meldt.',
            'Your feedback': 'Jouw feedback',
            'Share an idea, issue, or improvement...': 'Deel een idee, probleem of verbetering...',
            'To prevent spam, you can send one message per minute and up to five messages per hour.': 'Om spam te voorkomen kun je één bericht per minuut en maximaal vijf berichten per uur sturen.',
            'Send feedback': 'Feedback versturen',
            'Private workspace': 'Privéwerkruimte',
            'Server context': 'Servercontext',
            'Select a server': 'Selecteer een server',
            'Find a setting or tool': 'Zoek een instelling of hulpmiddel',
            'Search settings, files, AI, reliability...': 'Zoek in instellingen, bestanden, AI, betrouwbaarheid...',
            'Refresh current tool': 'Huidig hulpmiddel vernieuwen',
            'Release center': 'Releasecentrum',
            'Feedback inbox': 'Feedback-inbox',
            'Load feedback': 'Feedback laden',
            'Messenger': 'Berichten',
            'Profiles': 'Profielen',
            'AI & System': 'AI & systeem',
            'Global Settings': 'Algemene instellingen',
            'Reliability': 'Betrouwbaarheid',
            'Statistics': 'Statistieken',
            'Developer Files': 'Ontwikkelaarsbestanden',
            'Bot Logs': 'Botlogs',
            'Experiments': 'Experimenten',
            'Dashboard': 'Dashboard',
            'Menu': 'Menu',
            'Search dashboard features and settings': 'Zoek in dashboardfuncties en instellingen',
            'Search triggers, permissions, voice, settings...': 'Zoek in triggers, rechten, voice en instellingen...',
            'Dashboard sections': 'Dashboardonderdelen',
            'Overview': 'Overzicht',
            'Stats & Analytics': 'Statistieken & analyse',
            'Messages': 'Berichten',
            'Bots': 'Bots',
            'Channels': 'Kanalen',
            'Admins': 'Beheerders',
            'Total Messages Tracked': 'Totaal bijgehouden berichten',
            'Bot Enabled': 'Bot ingeschakeld',
            'Members in Voice Now': 'Leden nu in voice',
            'Total Voice Time Tracked': 'Totaal bijgehouden voicetijd',
            'Boost Tier': 'Boostniveau',
            'Verification Level': 'Verificatieniveau',
            'Server Created': 'Server aangemaakt',
            'Server Owner': 'Servereigenaar',
            'AI conversations': 'AI-gesprekken',
            'AI attachments': 'AI-bijlagen',
            'Image search': 'Afbeeldingen zoeken',
            'Ping responses': 'Pingreacties',
            'Save pings': 'Pings opslaan',
            'Voice Analytics': 'Voice-analyse',
            'Server Media': 'Servermedia',
            'Triggers': 'Triggers',
            'Shots': 'Shots',
            'Members & Permissions': 'Leden & rechten',
            'Management': 'Beheer',
            'Moderation': 'Moderatie',
            'AutoMod & Safety': 'AutoMod & veiligheid',
            'Cases & Logs': 'Zaken & logs',
            'Roles & Onboarding': 'Rollen & onboarding',
            'Automation': 'Automatisering',
            'Tickets': 'Tickets',
            'Suggestions': 'Suggesties',
            'Join Security': 'Toetredingsbeveiliging',
            'Starboard': 'Starboard',
            'Forms & Appeals': 'Formulieren & bezwaren',
            'Channel Management': 'Kanaalbeheer',
            'Discord Integrations': 'Discord-integraties',
            'Server Doctor': 'Servercontrole',
            'Incident Center': 'Incidentcentrum',
            'Reports & Modmail': 'Meldingen & modmail',
            'Workflow Studio': 'Workflowstudio',
            'Staff Operations': 'Teambeheer',
            'Community Health': 'Communitygezondheid',
            'Backup & Recovery': 'Back-up & herstel',
            'Flummi Copilot': 'Flummi Copilot',
            'Engagement & Utilities': 'Betrokkenheid & hulpmiddelen',
            'Settings': 'Instellingen',
            'Ping Requests': 'Pingverzoeken',
            'Audit Log': 'Auditlog',
            'Invite bot': 'Bot uitnodigen',
            'Signed in': 'Ingelogd',
            'Refresh Discord access': 'Discord-toegang vernieuwen',
            'Server details, key totals, and recent message and voice activity at a glance.': 'Serverdetails, belangrijke totalen en recente bericht- en voiceactiviteit in één overzicht.',
            'Server Details': 'Serverdetails',
            'Features': 'Functies',
            'Top Message Channels': 'Populairste berichtkanalen',
            'Loading...': 'Laden...',
            'Period': 'Periode',
            'Last 24 hours': 'Afgelopen 24 uur',
            'Last 7 days': 'Afgelopen 7 dagen',
            'Last 30 days': 'Afgelopen 30 dagen',
            'Last 90 days': 'Afgelopen 90 dagen',
            'Graph': 'Grafiek',
            'Bars': 'Balken',
            'Line': 'Lijn',
            'Message activity': 'Berichtactiviteit',
            'Voice sessions': 'Voicesessies',
            'Voice': 'Voice',
            'Moderation Insights': 'Moderatie-inzichten',
            'Channel': 'Kanaal',
            'Member': 'Lid',
            'Members': 'Leden',
            'Roles': 'Rollen',
            'Save': 'Opslaan',
            'Search': 'Zoeken',
            'Cancel': 'Annuleren',
            'Continue': 'Doorgaan',
            'Confirm': 'Bevestigen',
            'Confirm change': 'Wijziging bevestigen',
            'Enter a value': 'Voer een waarde in',
            'Value': 'Waarde',
            'Create a new folder': 'Nieuwe map maken',
            'Create a new file': 'Nieuw bestand maken',
            'Folder name': 'Mapnaam',
            'File name': 'Bestandsnaam',
            'Enter a name only. You can move or rename it afterwards.': 'Voer alleen een naam in. Je kunt het item daarna verplaatsen of hernoemen.',
            'Create folder': 'Map maken',
            'Create file': 'Bestand maken',
            'Rename or move item': 'Item hernoemen of verplaatsen',
            'Change the name, or enter another folder to move this item within the repository.': 'Wijzig de naam of voer een andere map in om het item binnen de repository te verplaatsen.',
            'New repository path': 'Nieuw repositorypad',
            'Use a path relative to the repository root, without a leading slash.': 'Gebruik een pad vanaf de repositoryhoofdmap, zonder slash aan het begin.',
            'Rename item': 'Item hernoemen',
            'Discard unsaved changes?': 'Niet-opgeslagen wijzigingen weggooien?',
            'Your current draft has not been saved. Discard it and open the selected file?': 'Je huidige concept is niet opgeslagen. Wil je het weggooien en het geselecteerde bestand openen?',
            'Discard changes': 'Wijzigingen weggooien',
            'Reload the saved version?': 'Opgeslagen versie opnieuw laden?',
            'Your unsaved draft will be discarded and replaced with the latest version from the server.': 'Je niet-opgeslagen concept wordt vervangen door de nieuwste versie van de server.',
            'Discard and reload': 'Weggooien en herladen',
            'Delete': 'Verwijderen',
            'Close': 'Sluiten',
            'On': 'Aan',
            'Off': 'Uit',
            'Yes': 'Ja',
            'No': 'Nee',
            'None': 'Geen',
            'Never': 'Nooit',
            'Unavailable': 'Niet beschikbaar',
            'Try again': 'Opnieuw proberen',
            'Previous': 'Vorige',
            'Next': 'Volgende',
            'Search...': 'Zoeken...',
            'No matching rows.': 'Geen overeenkomende rijen.',
            'No data yet.': 'Nog geen gegevens.',
            'Home - Flummi': 'Home - Flummi',
            'Commands - Flummi': 'Commando\'s - Flummi',
            'Status - Flummi': 'Status - Flummi',
            'Feedback - Flummi': 'Feedback - Flummi',
            'Developer Tools - Flummi': 'Ontwikkelaarstools - Flummi',
            'Server | Flummi': 'Server | Flummi',
            'Expand Analytics tabs': 'Analysetabs uitklappen',
            'Collapse Analytics tabs': 'Analysetabs inklappen',
            'Expand Management tabs': 'Beheertabs uitklappen',
            'Collapse Management tabs': 'Beheertabs inklappen',
            'Close navigation': 'Navigatie sluiten'
        }
    };

    const textRecords = [];
    const attributeRecords = [];
    const translatableAttributes = ['aria-label', 'placeholder', 'title'];

    function normalizeLanguage(value) {
        return supportedLanguages.has(value) ? value : 'en';
    }

    function preferredLanguage() {
        try {
            const saved = localStorage.getItem(storageKey);
            if (supportedLanguages.has(saved)) return saved;
        } catch { /* storage can be unavailable in privacy modes */ }
        return String(navigator.language || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
    }

    let language = preferredLanguage();

    function t(source) {
        return translations[language]?.[source] || source;
    }

    function registerStaticContent(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;
            if (!parent || parent.closest('script, style, code, pre, textarea')) continue;
            const source = node.nodeValue.trim();
            if (!source || !translations.nl[source]) continue;
            textRecords.push({ node, source, leading: node.nodeValue.match(/^\s*/)?.[0] || '', trailing: node.nodeValue.match(/\s*$/)?.[0] || '' });
        }
        for (const element of root.querySelectorAll('*')) {
            for (const attribute of translatableAttributes) {
                const source = element.getAttribute(attribute);
                if (source && translations.nl[source]) attributeRecords.push({ element, attribute, source });
            }
        }
    }

    function applyLanguage() {
        document.documentElement.lang = language;
        for (const record of textRecords) {
            if (record.node.isConnected) record.node.nodeValue = `${record.leading}${t(record.source)}${record.trailing}`;
        }
        for (const record of attributeRecords) {
            if (record.element.isConnected) record.element.setAttribute(record.attribute, t(record.source));
        }
        for (const select of document.querySelectorAll('[data-language-select]')) select.value = language;
    }

    function setLanguage(nextLanguage) {
        const normalized = normalizeLanguage(nextLanguage);
        if (normalized === language) return;
        language = normalized;
        try { localStorage.setItem(storageKey, language); } catch { /* optional preference */ }
        applyLanguage();
        window.dispatchEvent(new CustomEvent('flummi:languagechange', { detail: { language } }));
    }

    registerStaticContent(document.body);
    for (const select of document.querySelectorAll('[data-language-select]')) {
        select.addEventListener('change', event => setLanguage(event.target.value));
    }
    applyLanguage();

    window.FlummiI18n = {
        get language() { return language; },
        setLanguage,
        t
    };
})();
