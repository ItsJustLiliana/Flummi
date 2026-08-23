const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const stageScript = fs.readFileSync(path.join(root, 'deploy', 'stage-update.sh'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'update-staging.yml'), 'utf8');

test('staging updater serializes overlapping runs and supports non-interactive user services', () => {
    assert.match(stageScript, /flock -n 9/);
    assert.match(stageScript, /XDG_RUNTIME_DIR/);
    assert.match(stageScript, /DBUS_SESSION_BUS_ADDRESS/);
    assert.match(stageScript, /record-update-status\.js" checked/);
    assert.match(stageScript, /record-update-status\.js" updated/);
    assert.match(stageScript, /FLUMMI_COMMAND_SCOPE=guild node "\$\{staging_dir\}\/scripts\/deploy-commands\.js"/);
});

test('GitHub pushes to main request an immediate staging update over Tailscale', () => {
    assert.match(workflow, /push:\s*[\s\S]*branches:\s*[\s\S]*- main/);
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /tailscale\/github-action@v4/);
    assert.match(workflow, /oauth-client-id: \$\{\{ secrets\.TS_OAUTH_CLIENT_ID \}\}/);
    assert.match(workflow, /oauth-secret: \$\{\{ secrets\.TS_OAUTH_SECRET \}\}/);
    assert.match(workflow, /tailscale ssh marijn@archlinux\.tail50bfa9\.ts\.net/);
    assert.match(workflow, /\/projects\/Flummi-staging\/deploy\/stage-update\.sh/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.doesNotMatch(workflow, /promote-live|flummi\.service/);
});
