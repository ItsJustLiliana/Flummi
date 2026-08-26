const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'deploy', 'flummi-data-encryption.sh');
const guidePath = path.join(__dirname, '..', 'deploy', 'DATA_ENCRYPTION.md');

test('remote data encryption migration has verification, rollback, and guarded finalization', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');
    assert.match(script, /set -Eeuo pipefail/);
    assert.match(script, /\.flummi-data\.encrypted/);
    assert.match(script, /rsync -a --checksum --delete --dry-run/);
    assert.match(script, /gocryptfs -fsck/);
    assert.match(script, /migration_failure/);
    assert.match(script, /Type ERASE PLAINTEXT/);
    assert.match(script, /resolved_backup.*\.flummi-data\.plaintext-backup/s);
    assert.match(script, /flummi-data-mount\.service/);
});

test('remote encryption guide documents migration, finalization, and key tradeoffs', () => {
    const guide = fs.readFileSync(guidePath, 'utf8');
    assert.match(guide, /\/projects\/Flummi/);
    assert.match(guide, /finalize/);
    assert.match(guide, /rollback/);
    assert.match(guide, /same machine.*does not protect/s);
    assert.match(guide, /recovery master key/i);
});
