const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, SlashCommandBuilder } = require('discord.js');
const config = require('../config.json');
const { getConfiguredCommandRows } = require('../commands/help');

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
