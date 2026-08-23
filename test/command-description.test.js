const test = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');
const {
    MAX_COMMAND_DESCRIPTION_LENGTH,
    appendAccessSuffix,
    commandPayloadWithAccessDescriptions
} = require('../utils/command-description');

test('access suffixes are added once and stay inside Discord limits', () => {
    assert.equal(appendAccessSuffix('Manage members', 'admin'), 'Manage members (admin only)');
    assert.equal(appendAccessSuffix('Internal tools', 'developer'), 'Internal tools (developer only)');
    assert.equal(appendAccessSuffix('Public command', 'member'), 'Public command');
    assert.equal(appendAccessSuffix('Manage members (admin only)', 'admin'), 'Manage members (admin only)');
    assert.equal(appendAccessSuffix('x'.repeat(100), 'developer').length, MAX_COMMAND_DESCRIPTION_LENGTH);
});

test('deployment descriptions reflect top-level and subcommand access', () => {
    const command = {
        adminOnly: true,
        data: new SlashCommandBuilder()
            .setName('manage')
            .setDescription('Manage members')
            .addSubcommand(subcommand => subcommand.setName('permissions').setDescription('Edit permissions'))
            .addSubcommand(subcommand => subcommand.setName('role').setDescription('Edit roles'))
    };
    const resolver = (_name, subcommand) => subcommand === 'role' ? 'developer' : 'admin';
    const payload = commandPayloadWithAccessDescriptions(command, resolver);

    assert.equal(payload.description, 'Manage members (admin only)');
    assert.equal(payload.options[0].description, 'Edit permissions (admin only)');
    assert.equal(payload.options[1].description, 'Edit roles (developer only)');
});
