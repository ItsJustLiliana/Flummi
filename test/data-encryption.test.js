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
    assert.match(script, /mount_service_name="\$\{instance_name\}-data-mount\.service"/);
    assert.match(script, /--root/);
    assert.match(script, /--instance/);
});

test('production and staging encryption wrapper keeps roots and services separate', () => {
    const wrapper = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'flummi-encrypt-both.sh'), 'utf8');
    assert.match(wrapper, /\/projects\/Flummi --service flummi\.service --instance flummi/);
    assert.match(wrapper, /\/projects\/Flummi-staging --service flummi-staging\.service --instance flummi-staging/);
    assert.match(wrapper, /different passfiles/i);
});

test('remote encryption guide documents migration, finalization, and key tradeoffs', () => {
    const guide = fs.readFileSync(guidePath, 'utf8');
    assert.match(guide, /\/projects\/Flummi/);
    assert.match(guide, /finalize/);
    assert.match(guide, /rollback/);
    assert.match(guide, /same machine.*does not protect/s);
    assert.match(guide, /recovery master key/i);
});
