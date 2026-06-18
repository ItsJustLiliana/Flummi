const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    readSerperUsage,
    recordSerperImageSearch
} = require('../stores/serper-usage-store');

test('serper usage store tracks successful and failed image requests', () => {
    const originalUsageFile = process.env.SERPER_USAGE_FILE;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serper-usage-'));

    process.env.SERPER_USAGE_FILE = path.join(tempDir, 'usage.json');

    try {
        recordSerperImageSearch({
            statusCode: 200,
            ok: true,
            at: new Date('2026-06-18T20:00:00.000Z')
        });
        recordSerperImageSearch({
            statusCode: 429,
            ok: false,
            at: new Date('2026-06-18T20:01:00.000Z')
        });

        const usage = readSerperUsage();

        assert.equal(usage.requests.total, 2);
        assert.equal(usage.requests.successful, 1);
        assert.equal(usage.requests.failed, 1);
        assert.deepEqual(usage.requests.byDate['2026-06-18'], {
            total: 2,
            successful: 1,
            failed: 1
        });
        assert.equal(usage.lastStatusCode, 429);
    } finally {
        if (originalUsageFile === undefined) {
            delete process.env.SERPER_USAGE_FILE;
        } else {
            process.env.SERPER_USAGE_FILE = originalUsageFile;
        }

        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
