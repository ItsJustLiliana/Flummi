const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { consentButtons, disclosure } = require('../services/ai-consent-service');
const { dashboardUrl, privacyUrl, termsUrl } = require('../utils/public-links');

test('AI consent is concise and links to the public policies', () => {
    assert.match(disclosure, /\[Terms of Service\]\(https:\/\//);
    assert.match(disclosure, /\[Privacy Policy\]\(https:\/\//);
    assert.ok(disclosure.length < 300);
    const buttons = consentButtons('user').components.map(button => button.data);
    assert.deepEqual(buttons.map(button => button.label), ['Enable AI', 'Keep AI off', 'Terms', 'Privacy']);
    assert.equal(buttons[2].url, termsUrl());
    assert.equal(buttons[3].url, privacyUrl());
});

test('public command links share one canonical site base', () => {
    assert.equal(dashboardUrl(), 'https://flummi.liliananuzohra.com/');
    assert.equal(termsUrl(), 'https://flummi.liliananuzohra.com/terms');
    assert.equal(privacyUrl(), 'https://flummi.liliananuzohra.com/privacy');
});

test('user-facing command and dashboard sources contain no known mojibake markers', () => {
    const roots = ['commands', 'events', 'services', 'utils', 'panel'];
    const files = roots.flatMap(root => fs.readdirSync(path.join(__dirname, '..', root), { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(?:js|html|css)$/.test(entry.name))
        .map(entry => path.join(entry.parentPath, entry.name)));
    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /(?:Ã.|Â.|â€|â€™|ðŸ|ï¸)/, file);
    }
});
