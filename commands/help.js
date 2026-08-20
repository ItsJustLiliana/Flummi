const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed } = require('../utils/command-ui');
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
                requiredRole: command.public ? 'user' : requiredRole,
                label: formatCommandPath(pathKey, command)
            };
        })
        .filter(Boolean);
}

const COMMAND_CATALOG = [
    { path: 'help', label: '/help', description: 'Shows the commands available to you.' },
    { path: 'ping', label: '/ping', description: 'Checks whether Flummi is online.' },
    { path: 'status', label: '/status', description: 'Shows the features and services available to you.' },
    { path: 'profile.view', label: '/profile view [user]', description: 'View your own or another member’s profile and stats.' },
    { path: 'profile.set', label: '/profile set', description: 'Edit your profile, bio, socials, colour, and other fields.' },
    { path: 'profile.clear', label: '/profile clear', description: 'Clear selected fields from your profile.' },
    { path: 'leaderboard', label: '/leaderboard category:messages|voice [limit]', description: 'View this server’s message or voice-time ranking.' },
    { path: 'shots', label: '/shots', description: 'Check, gamble, manage your own shots, or view the leaderboard.' },
    { path: 'trigger', label: '/trigger', description: 'Use and manage trigger responses available in this server.' },
    { path: 'resetmemory', label: '/resetmemory', description: 'Delete your own saved AI conversation memory.' },
    { path: 'tree', label: '/tree', description: 'Open this community’s family tree.' },
    { path: 'serverstats', label: '/serverstats [limit]', description: 'View server message, channel, user, and trigger activity.', minimumRole: 'manager' },
    { path: 'voicetime', label: '/voicetime', description: 'View server voice activity, history, channels, and rankings.', minimumRole: 'manager' },
    { path: 'userinfo', label: '/userinfo user', description: 'View a member’s bot permissions and role.', minimumRole: 'manager' },
    { path: 'settings', label: '/settings', description: 'View or change selected guild bot settings.', minimumRole: 'manager' },
    { path: 'manage.permissions', label: '/manage permissions', description: 'Set feature and command access for a member.', minimumRole: 'manager' },
    { path: 'manage.role', label: '/manage role', description: 'Assign or remove the Flummi manager role.', minimumRole: 'developer' },
    { path: 'shots.audit', label: '/shots audit [limit]', description: 'View the developer audit log for shot changes.', minimumRole: 'developer' },
    { path: 'dashboard', label: '/dashboard', description: 'Open the public Flummi dashboard.' }
];

const ROLE_RANK = { user: 0, manager: 1, developer: 2 };

function getCatalogCommandRows(client, guildId) {
    return COMMAND_CATALOG
        .filter(entry => {
            const command = client.commands.get(entry.path.split('.')[0]);
            return command && (!Array.isArray(command.allowedGuildIds) || command.allowedGuildIds.includes(guildId));
        })
        .map(entry => {
            const [commandName, subcommandName] = entry.path.split('.');
            const command = client.commands.get(commandName);
            const configuredRole = getRequiredCommandRole(commandName, subcommandName || null, command);
            const minimumRole = entry.minimumRole || 'user';
            const requiredRole = ROLE_RANK[configuredRole] >= ROLE_RANK[minimumRole]
                ? configuredRole
                : minimumRole;

            return {
                ...entry,
                requiredRole,
                label: `\`${entry.label}\` — ${entry.description}`
            };
        });
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

        const commandRows = getCatalogCommandRows(interaction.client, guildId);

        const userCommands = commandRows
            .filter(row => row.requiredRole === 'user')
            .map(row => row.label);

        const managerCommands = commandRows
            .filter(row => row.requiredRole === 'manager')
            .map(row => row.label);

        const developerCommands = commandRows
            .filter(row => row.requiredRole === 'developer')
            .map(row => row.label);

        const embed = createCommandEmbed(interaction, {
            title: 'Command Guide',
            description: availabilityNote,
            tone: developer ? 'danger' : manager ? 'staff' : 'primary',
            footer: 'Flummi • Commands update with your access level'
        })
            .addFields(
                { name: 'Your Role', value: roleLabel, inline: true },
                { name: 'Bot Status', value: botStatus, inline: true }
            )
            .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

        if (roleMeetsRequirement(userRole, 'user')) {
            embed.addFields({
                name: 'Member Commands',
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
