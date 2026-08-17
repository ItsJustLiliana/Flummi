const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFlatBannerUrl } = require('../commands/profile');

test('profile banner image uses a flat center-cropped preview url', () => {
    const result = buildFlatBannerUrl('https://example.com/images/banner.png?size=large');
    const parsed = new URL(result);

    assert.equal(parsed.origin, 'https://images.weserv.nl');
    assert.equal(parsed.searchParams.get('url'), 'example.com/images/banner.png?size=large');
    assert.equal(parsed.searchParams.get('w'), '720');
    assert.equal(parsed.searchParams.get('h'), '270');
    assert.equal(parsed.searchParams.get('fit'), 'cover');
    assert.equal(parsed.searchParams.get('a'), 'center');
});
