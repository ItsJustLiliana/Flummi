(() => {
    'use strict';

    const storageKey = 'flummi.language';
    const locales = window.FlummiLocales || {};
    const supportedLanguages = new Set(Object.keys(locales));
    const translations = Object.fromEntries(
        Object.entries(locales).map(([code, locale]) => [code, locale.translations || {}])
    );

    const textRecords = [];
    const textRecordByNode = new WeakMap();
    const attributeRecords = [];
    const attributeRecordByElement = new WeakMap();
    const translatableAttributes = ['aria-label', 'placeholder', 'title'];

    function normalizeLanguage(value) {
        return supportedLanguages.has(value) ? value : 'en';
    }

    function preferredLanguage() {
        try {
            const saved = localStorage.getItem(storageKey);
            if (supportedLanguages.has(saved)) return saved;
        } catch { /* storage can be unavailable in privacy modes */ }
        const browserLanguage = String(navigator.language || '').toLowerCase().split('-')[0];
        return supportedLanguages.has(browserLanguage) ? browserLanguage : 'en';
    }

    let language = preferredLanguage();

    function preserveCapitalization(source, translated) {
        if (source === source.toUpperCase() && source.length > 1) return translated.toUpperCase();
        return /^[A-Z]/.test(source) ? translated.charAt(0).toUpperCase() + translated.slice(1) : translated;
    }

    function fallbackTranslation(source) {
        const locale = locales[language] || {};
        let result = String(source);
        for (const [english, dutch] of Object.entries(locale.phrases || {}).sort((a, b) => b[0].length - a[0].length)) {
            result = result.replace(new RegExp(`\\b${english.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'gi'), match => preserveCapitalization(match, dutch));
        }
        return result.replace(/[A-Za-z][A-Za-z'-]*/g, word => {
            const translated = (locale.words || {})[word.toLowerCase()];
            return translated ? preserveCapitalization(word, translated) : word;
        });
    }

    function t(source) {
        if (language === 'en') return source;
        const exact = translations[language]?.[source];
        // Never build long prose word by word: that produces grammatically broken
        // policy and help text. Long copy stays in its authored language until a
        // reviewed full-sentence translation is available.
        return exact || (String(source).length <= 100 ? fallbackTranslation(source) : source);
    }

    function tExact(source) {
        if (language === 'en') return source;
        return translations[language]?.[source] || source;
    }

    function hasExactTranslation(source) {
        return Object.values(translations).some(locale => Boolean(locale?.[source]));
    }

    function registerStaticContent(root, { exactOnly = false } = {}) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;
            if (!parent || parent.closest('script, style, code, pre, textarea')) continue;
            const source = node.nodeValue.trim();
            if (!source || !/[A-Za-z]/.test(source) || ['English', 'Nederlands', 'Deutsch'].includes(source) || textRecordByNode.has(node)) continue;
            if (exactOnly && !hasExactTranslation(source)) continue;
            const record = { node, source, exactOnly, leading: node.nodeValue.match(/^\s*/)?.[0] || '', trailing: node.nodeValue.match(/\s*$/)?.[0] || '', rendered: node.nodeValue };
            textRecords.push(record);
            textRecordByNode.set(node, record);
        }
        for (const element of root.querySelectorAll('*')) {
            let records = attributeRecordByElement.get(element);
            if (!records) {
                records = new Map();
                attributeRecordByElement.set(element, records);
            }
            for (const attribute of translatableAttributes) {
                const source = element.getAttribute(attribute);
                if (!source || !/[A-Za-z]/.test(source) || records.has(attribute)) continue;
                if (exactOnly && !hasExactTranslation(source)) continue;
                const record = { element, attribute, source, exactOnly, rendered: source };
                attributeRecords.push(record);
                records.set(attribute, record);
            }
        }
    }

    function applyLanguage() {
        document.documentElement.lang = language;
        for (const record of textRecords) {
            if (record.node.isConnected) {
                record.rendered = `${record.leading}${record.exactOnly ? tExact(record.source) : t(record.source)}${record.trailing}`;
                record.node.nodeValue = record.rendered;
            }
        }
        for (const record of attributeRecords) {
            if (record.element.isConnected) {
                record.rendered = record.exactOnly ? tExact(record.source) : t(record.source);
                record.element.setAttribute(record.attribute, record.rendered);
            }
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

    const observer = new MutationObserver(records => {
        let changed = false;
        for (const mutation of records) {
            if (mutation.type === 'characterData') {
                const node = mutation.target;
                const record = textRecordByNode.get(node);
                if (record && node.nodeValue === record.rendered) continue;
                if (record) {
                    record.source = node.nodeValue.trim();
                    record.exactOnly = false;
                    record.leading = node.nodeValue.match(/^\s*/)?.[0] || '';
                    record.trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
                } else {
                    registerStaticContent(node.parentElement || document.body);
                }
                changed = true;
            }
            for (const node of mutation.addedNodes || []) {
                if (node.nodeType === Node.TEXT_NODE) registerStaticContent(node.parentElement || document.body);
                if (node.nodeType === Node.ELEMENT_NODE) {
                    registerStaticContent(node, { exactOnly: true });
                    // A second pass registers text without an exact entry so dynamic
                    // module descriptions still receive phrase/word fallback translation.
                    registerStaticContent(node);
                }
                changed = true;
            }
        }
        if (changed) applyLanguage();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    window.FlummiI18n = {
        get language() { return language; },
        setLanguage,
        t,
        tExact
    };
})();
