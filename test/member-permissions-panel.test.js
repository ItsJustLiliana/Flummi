const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'panel', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'panel', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'control-panel.js'), 'utf8');

test('command permission requirements live in Developer Tools and refresh the public Commands catalog', () => {
    const usersStart = markup.indexOf('id="tab-users"');
    const usersEnd = markup.indexOf('</section>', usersStart);
    const globalStart = markup.indexOf('id="tab-global"');
    const commandRequirements = markup.indexOf('Command Permission Requirements');

    assert.ok(commandRequirements > globalStart);
    assert.ok(commandRequirements < markup.indexOf('id="developerTabOrder"', globalStart));
    assert.ok(commandRequirements < usersStart || commandRequirements > usersEnd);
    assert.match(server, /accessStore\.setCommandPermissions\(config\.commandPermissions\)/);
    assert.match(script, /state\.publicCommands = \[\];\s*await loadPublicCommands\(\)/);
});

test('member permission UI uses owner precedence and no longer exposes command blockades', () => {
    assert.ok(script.indexOf('if (member.isOwner)') < script.indexOf("return member.role === 'admin'"));
    assert.match(script, /badge owner">Owner/);
    assert.match(script, /member\.role === 'member' \|\| String\(member\.id\) === String\(state\.accountUserId\)/);
    assert.doesNotMatch(markup, /Command Overrides|Blockades/);
    assert.doesNotMatch(script, /setOverride|data-clear-override|overrideCommandPath/);
    assert.doesNotMatch(script, /Manage permissions/);
});

test('admins can edit themselves but not another admin or the server owner', () => {
    assert.match(server, /const isSelf = String\(targetUserId\) === String\(session\.userId\)/);
    assert.match(server, /String\(targetUserId\) === String\(guild\.ownerId\)\) return isSelf/);
    assert.match(server, /targetMember\.permissions\.has\(PermissionsBitField\.Flags\.Administrator\)\) return isSelf/);
    assert.match(server, /if \(String\(userId\) === String\(guild\.ownerId\)\) return 'owner'/);
});

test('member feature toggles inherit both global and server feature gates', () => {
    for (const key of ['useTriggers', 'addTriggers', 'useAiChat', 'useBotMentions', 'savePingRequests']) {
        assert.match(server, new RegExp(`${key}: \\[`));
    }
    assert.match(server, /globalEnabled && serverEnabled/);
    assert.match(server, /featureAvailability\[key\]\?\.enabled/);
    assert.match(script, /readOnly \|\| unavailable \? 'disabled'/);
    assert.match(script, /availability\.reason/);
});
