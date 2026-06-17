const test = require('node:test');
const assert = require('node:assert/strict');
const { formatLogTimestamp } = require('../utils/logger');

test('formatLogTimestamp returns a readable local timestamp', () => {
    const timestamp = formatLogTimestamp(new Date(2026, 5, 17, 9, 8, 7));

    assert.equal(timestamp, '2026-06-17 09:08:07');
});
