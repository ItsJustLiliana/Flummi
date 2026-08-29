const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { commandPayloadWithAccessDescriptions } = require('../utils/command-description');
const { getRequiredCommandRole } = require('../stores/access-store');

const commandDirectory = path.join(__dirname, '..', 'commands');
const commands = fs.readdirSync(commandDirectory)
    .filter(file => file.endsWith('.js'))
    .map(file => require(path.join(commandDirectory, file)));

function commandPaths(payload) {
    const paths = [];
    const containers = (payload.options || []).filter(option => option.type === 1 || option.type === 2);
    if (!containers.length) return [payload.name];
    for (const option of containers) {
        if (option.type === 1) paths.push(`${payload.name}.${option.name}`);
        if (option.type === 2) {
            for (const child of option.options || []) if (child.type === 1) paths.push(`${payload.name}.${option.name}.${child.name}`);
        }
    }
    return paths;
}

test('every built-in command serializes, executes, and is deployed server-only', () => {
    for (const command of commands) {
        assert.equal(typeof command.execute, 'function', command.data?.name);
        const payload = commandPayloadWithAccessDescriptions(command, getRequiredCommandRole);
        assert.match(payload.name, /^[a-z0-9_-]{1,32}$/);
        assert.equal(payload.dm_permission, false, payload.name);
        assert.ok(payload.description.length <= 100, payload.name);
    }
});

test('declared staff subcommands exist and resolve to their declared role', () => {
    for (const command of commands) {
        const payload = command.data.toJSON();
        const paths = new Set(commandPaths(payload));
        for (const subcommand of command.adminSubcommands || []) {
            assert.ok(paths.has(`${payload.name}.${subcommand}`), `${payload.name}.${subcommand}`);
            assert.equal(getRequiredCommandRole(payload.name, subcommand, command), 'admin');
        }
        for (const subcommand of command.developerSubcommands || []) {
            assert.ok(paths.has(`${payload.name}.${subcommand}`), `${payload.name}.${subcommand}`);
            assert.equal(getRequiredCommandRole(payload.name, subcommand, command), 'developer');
        }
    }
});

test('support-team transfer uses Discord autocomplete instead of copied IDs', () => {
    const ticket = require('../commands/ticket');
    const transfer = ticket.data.toJSON().options.find(option => option.name === 'transfer');
    assert.equal(transfer.options.find(option => option.name === 'team').autocomplete, true);
    assert.equal(typeof ticket.autocomplete, 'function');
});

test('failed modmail delivery is reported before an outgoing message is stored', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'modmail-service.js'), 'utf8');
    const deliveryCheck = source.indexOf('if (!delivered)');
    const storedMessage = source.indexOf("direction: 'out'", deliveryCheck);
    assert.ok(deliveryCheck >= 0 && storedMessage > deliveryCheck);
});
