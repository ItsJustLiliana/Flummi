const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const { getConfiguredCommandRows, getRegisteredCommandRows } = require('../commands/help');

function makeCommand(name, description) {
    return {
        data: new SlashCommandBuilder()
            .setName(name)
            .setDescription(description)
    };
}

test('help rows follow commandPermissions order from config', () => {
    const client = {
        commands: new Collection()
    };

    for (const commandName of new Set(Object.keys(config.commandPermissions).map(pathKey => pathKey.split('.')[0]))) {
        client.commands.set(commandName, makeCommand(commandName, `${commandName} description`));
    }

    const rows = getConfiguredCommandRows(client);
    const expected = Object.keys(config.commandPermissions)
        .filter(pathKey => pathKey.includes('.') || !Object.keys(config.commandPermissions).some(candidate => candidate.startsWith(`${pathKey}.`)));

    assert.deepEqual(
        rows.slice(0, 8).map(row => row.pathKey),
        expected.slice(0, 8)
    );
});

test('public commands remain visible as member commands despite stale configured roles', () => {
    const client = { commands: new Collection() };
    const dashboard = makeCommand('dashboard', 'Open the Flummi dashboard');
    dashboard.public = true;
    client.commands.set('dashboard', dashboard);

    const row = getConfiguredCommandRows(client).find(entry => entry.pathKey === 'dashboard');
    assert.equal(row.requiredRole, 'member');
});

test('help discovers every registered subcommand including developer commands', () => {
    const client = { commands: new Collection() };
    const settings = {
        data: new SlashCommandBuilder()
            .setName('settings')
            .setDescription('Settings')
            .addSubcommand(option => option.setName('view').setDescription('View settings'))
            .addSubcommand(option => option.setName('triggers').setDescription('Developer trigger settings'))
    };
    client.commands.set('settings', settings);

    const rows = getRegisteredCommandRows(client, 'guild');
    assert.deepEqual(rows.map(row => row.pathKey).sort(), ['settings.triggers', 'settings.view']);
    assert.equal(rows.find(row => row.pathKey === 'settings.triggers').requiredRole, 'developer');
});

test('public commands keep developer-only subcommands out of the member section', () => {
    const client = { commands: new Collection() };
    const data = {
        public: true,
        developerSubcommands: ['correction-update'],
        data: new SlashCommandBuilder()
            .setName('data')
            .setDescription('Data tools')
            .addSubcommand(option => option.setName('view').setDescription('View your data'))
            .addSubcommand(option => option.setName('correction-update').setDescription('Update a correction request'))
    };
    client.commands.set('data', data);

    const rows = getRegisteredCommandRows(client, 'guild');
    assert.equal(rows.find(row => row.pathKey === 'data.view').requiredRole, 'member');
    assert.equal(rows.find(row => row.pathKey === 'data.correction-update').requiredRole, 'developer');
});
