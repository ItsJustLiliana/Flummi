const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'deploy', 'flummi-data-encryption.sh');

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
    assert.match(script, /gocryptfs_password_args\(\).*?return 0/s);
    assert.match(script, /verified_marker="\$\{plain_dir\}\/\.flummi-migration-verified"/);
    assert.doesNotMatch(script, /verified_marker="\$\{cipher_dir\}/);
    assert.match(script, /systemctl --user enable "\$mount_service_name"/);
    assert.match(script, /systemctl --user stop "\$service_name".*?systemctl --user is-active --quiet "\$mount_service_name".*?systemctl --user restart "\$mount_service_name"/s);
    assert.match(script, /mountpoint -q "\$plain_dir".*?unmount_plain/s);
    assert.doesNotMatch(script, /enable --now "\$mount_service_name"/);
    assert.match(script, /ExecStartPost=.*?mountpoint -q \$\{plain_dir\}/);
    assert.match(script, /ExecStop=-\/usr\/bin\/fusermount3/);
});

test('production and staging encryption wrapper keeps roots and services separate', () => {
    const wrapper = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'flummi-encrypt-both.sh'), 'utf8');
    assert.match(wrapper, /\/projects\/Flummi --service flummi\.service --instance flummi/);
    assert.match(wrapper, /\/projects\/Flummi-staging --service flummi-staging\.service --instance flummi-staging/);
    assert.match(wrapper, /different passfiles/i);
});

test('secret migration encrypts env and local config with rollback and guarded finalization', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'flummi-secrets-encryption.sh'), 'utf8');
    assert.match(script, /secret_names=\(\.env config\.local\.json config\.json\)/);
    assert.match(script, /\.flummi-secrets\.encrypted/);
    assert.match(script, /rsync -a --omit-dir-times --checksum --delete --dry-run/);
    assert.match(script, /gocryptfs -fsck/);
    assert.match(script, /migration_failed/);
    assert.match(script, /Type ERASE PLAINTEXT SECRETS/);
    assert.match(script, /Requires=\$\{mount_service_name\}/);
    assert.match(script, /ExecStartPre=.*mountpoint -q/);
});

test('production and staging secrets wrapper keeps roots and services separate', () => {
    const wrapper = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'flummi-encrypt-secrets-both.sh'), 'utf8');
    assert.match(wrapper, /--root \/projects\/Flummi --service flummi\.service --instance flummi/);
    assert.match(wrapper, /--root \/projects\/Flummi-staging --service flummi-staging\.service --instance flummi-staging/);
    assert.equal((wrapper.match(/bash "\$script_dir\/flummi-secrets-encryption\.sh"/g) || []).length, 2);
    assert.match(wrapper, /different passfiles/i);
});
