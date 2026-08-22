const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { installTimestampedConsole } = require('../utils/logger');
const { loadEnv } = require('../utils/env-loader');
const { readConfig } = require('../utils/config');
const { getRequiredCommandRole } = require('../stores/access-store');
const { commandPayloadWithAccessDescriptions } = require('../utils/command-description');
const config = readConfig();

installTimestampedConsole();
loadEnv();

const commands = [];

const commandsDir = path.join(__dirname, '..', 'commands');
const commandFiles = fs
    .readdirSync(commandsDir)
    .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(path.join(commandsDir, file));
    commands.push(command);
}

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_BOT_TOKEN || config.token);

async function deployCommands() {
    console.log(`Preparing ${commands.length} commands...`);

    const guildIds = Array.from(new Set([
        ...(Array.isArray(config.guildIds) ? config.guildIds : []),
        ...(config.guildId ? [config.guildId] : [])
    ]));

    if (guildIds.length > 0) {
        const globalCommands = commands
            .filter(command => !Array.isArray(command.allowedGuildIds))
            .map(command => commandPayloadWithAccessDescriptions(command, getRequiredCommandRole));

        try {
            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: globalCommands }
            );
            console.log(`Registered ${globalCommands.length} global commands.`);
        } catch (error) {
            console.warn(`Could not register global commands: ${error.message}`);
        }

        const failures = [];

        for (const guildId of guildIds) {
            try {
                const guildCommands = commands
                    .filter(command => Array.isArray(command.allowedGuildIds) && command.allowedGuildIds.includes(guildId))
                    .map(command => commandPayloadWithAccessDescriptions(command, getRequiredCommandRole));

                await rest.put(
                    Routes.applicationGuildCommands(config.clientId, guildId),
                    { body: guildCommands }
                );
                console.log(`Registered ${guildCommands.length} guild-only commands for guild ${guildId}.`);
            } catch (error) {
                failures.push({ guildId, error });
                console.warn(`Skipping guild ${guildId}: ${error.message}`);
            }
        }

        if (failures.length === guildIds.length) {
            throw new Error('Command deployment failed for all configured guilds.');
        }
    } else {
        try {
            const globalCommands = commands
                .filter(command => !Array.isArray(command.allowedGuildIds))
                .map(command => commandPayloadWithAccessDescriptions(command, getRequiredCommandRole));

            await rest.put(
                Routes.applicationCommands(config.clientId),
                { body: globalCommands }
            );
            console.log(`Registered ${globalCommands.length} global commands.`);
        } catch (error) {
            console.warn(`Skipping global command deployment: ${error.message}`);
        }
    }
}

module.exports = deployCommands;

if (require.main === module) {
    deployCommands().catch(error => {
        console.error(error);
        process.exit(1);
    });
}
