const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const {
    getRequiredCommandRole,
    getUserRole,
    isDeveloper,
    isManager,
    roleMeetsRequirement
} = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');
const { readConfig } = require('../utils/config');
const config = readConfig();

function getCommandDescription(command, pathKey) {
    const parts = pathKey.split('.');

    if (parts.length === 1) {
        return command?.data?.description || 'No description.';
    }

    const commandJson = command?.data?.toJSON?.();
    let options = commandJson?.options || [];

    for (const part of parts.slice(1)) {
        const match = options.find(option => option.name === part);

        if (!match) {
            return command?.data?.description || 'No description.';
        }

        if (part === parts[parts.length - 1]) {
            return match.description || command?.data?.description || 'No description.';
        }

        options = match.options || [];
    }

    return command?.data?.description || 'No description.';
}

function formatCommandPath(pathKey, command) {
    return `/${pathKey.replace(/\./g, ' ')} - ${getCommandDescription(command, pathKey)}`;
}

function getConfiguredCommandRows(client) {
    const commandPermissions = config.commandPermissions || {};
    const commands = client.commands;
    const configuredPaths = Object.keys(commandPermissions);

    return Object.entries(commandPermissions)
        .map(([pathKey, requiredRole]) => {
            const isContainerOnly = !pathKey.includes('.') &&
                configuredPaths.some(candidate => candidate.startsWith(`${pathKey}.`));

            if (isContainerOnly) {
                return null;
            }

            const commandName = pathKey.split('.')[0];
            const command = commands.get(commandName);

            if (!command) {
                return null;
            }

            return {
                pathKey,
                command,
                requiredRole,
                label: formatCommandPath(pathKey, command)
            };
        })
        .filter(Boolean);
}

module.exports = {
    getConfiguredCommandRows,

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show your available commands and role'),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const developer = isDeveloper(userId);
        const manager = isManager(userId, guildId);
        const userRole = getUserRole(userId, guildId);

        const roleLabel = developer ? 'Developer' : manager ? 'Manager' : 'User';
        const roleColor = developer
            ? 0xFF1744
            : manager
                ? 0x1E88E5
                : 0xFFFFFF;
        const botStatus = readSettings(guildId).botEnabled ? 'Enabled' : 'Disabled';

        const availabilityNote = developer
            ? 'You can use every command, including developer-only ones.'
            : manager
                ? 'You can use public commands and manager-only commands.'
                : 'You can only use public commands.';

        const commandRows = getConfiguredCommandRows(interaction.client)
            .map(row => ({
                ...row,
                requiredRole: getRequiredCommandRole(
                    row.pathKey.split('.')[0],
                    row.pathKey.split('.')[2] || row.pathKey.split('.')[1] || null,
                    row.command,
                    row.pathKey.split('.')[2] ? row.pathKey.split('.')[1] : null
                )
            }));

        const userCommands = commandRows
            .filter(row => row.requiredRole === 'user')
            .map(row => row.label);

        const managerCommands = commandRows
            .filter(row => row.requiredRole === 'manager')
            .map(row => row.label);

        const developerCommands = commandRows
            .filter(row => row.requiredRole === 'developer')
            .map(row => row.label);

        const embed = new EmbedBuilder()
            .setColor(roleColor)
            .setTitle('Bot Help')
            .setDescription(`${availabilityNote}`)
            .addFields(
                { name: 'Your Role', value: roleLabel, inline: true },
                { name: 'Bot Status', value: botStatus, inline: true }
            )
            .setFooter({ text: 'Blue = manager, red = developer, white = user' });

        if (roleMeetsRequirement(userRole, 'user')) {
            embed.addFields({
                name: 'User Commands',
                value: userCommands.join('\n') || 'No user commands.',
                inline: false
            });
        }

        if (manager) {
            embed.addFields({
                name: 'Manager Commands',
                value: managerCommands.join('\n') || 'No manager commands.',
                inline: false
            });
        }

        if (developer) {
            embed.addFields({
                name: 'Developer Commands',
                value: developerCommands.join('\n') || 'No developer commands.',
                inline: false
            });
        }

        await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral
        });
    }
};
