const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'panel', 'index.html'), 'utf8');
const locale = fs.readFileSync(path.join(root, 'panel', 'i18n', 'locales', 'nl.js'), 'utf8');
const translated = new Set(Array.from(locale.matchAll(/^\s*'((?:\\'|[^'])+)':/gm), match => match[1].replace(/\\'/g, "'")));
const visibleElement = /<(?:h1|h2|h3|p|label|button|summary|option|a|span)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|p|label|button|summary|option|a|span)>/g;
const ignored = new Set(['English', 'Nederlands', 'Flummi', 'Dashboard']);
const missing = [];

for (const match of html.matchAll(visibleElement)) {
    const text = match[1]
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#8592;|&#8594;/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text || ignored.has(text) || translated.has(text) || !/[A-Za-z]/.test(text) || text.includes('${')) continue;
    if (!missing.includes(text)) missing.push(text);
}

if (require.main === module) {
    const wordBlock = locale.match(/const dutchWords = \{([\s\S]*?)\n    \};/)?.[1] || '';
    const knownWords = new Set(Array.from(wordBlock.matchAll(/\b([a-z]+):/g), match => match[1]));
    const unknownWords = new Map();
    for (const text of missing) {
        for (const word of text.toLowerCase().match(/[a-z][a-z'-]*/g) || []) {
            if (knownWords.has(word) || word.length < 3 || word.startsWith('flummi') || word.startsWith('discord')) continue;
            unknownWords.set(word, (unknownWords.get(word) || 0) + 1);
        }
    }
    const commonUnknownWords = [...unknownWords].sort((a, b) => b[1] - a[1]).slice(0, 150);
    const shortExactGaps = missing.filter(text => (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length <= 4);
    console.log(JSON.stringify({ exactTranslationGaps: missing.length, commonUnknownWords, shortExactGaps, missing }, null, 2));
}

module.exports = { missing };
