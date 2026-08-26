const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed } = require('../utils/command-ui');
const {
    getRequiredCommandRole,
    getUserRole,
    isDeveloper,
    isAdmin,
    normalizeRole,
    roleMeetsRequirement
} = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');
const { readConfig } = require('../utils/config');
const { appendAccessSuffix } = require('../utils/command-description');
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

function formatCommandPath(pathKey, command, requiredRole) {
    return `/${pathKey.replace(/\./g, ' ')} - ${appendAccessSuffix(getCommandDescription(command, pathKey), requiredRole)}`;
}

function getConfiguredCommandRows(client) {
    const commandPermissions = config.commandPermissions || {};
    const commands = client.commands;
    const configuredPaths = Object.keys(commandPermissions);

    return Object.entries(commandPermissions)
        .map(([pathKey, configuredRole]) => {
            const requiredRole = normalizeRole(configuredRole);
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
                requiredRole: command.public ? 'member' : requiredRole,
                label: formatCommandPath(pathKey, command, command.public ? 'member' : requiredRole)
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
    { path: 'leaderboard', label: '/leaderboard messages|voice|shots|media', description: 'View this server’s rankings.' },
    { path: 'shots', label: '/shots', description: 'Check, gamble, or manage shot totals.' },
    { path: 'trigger', label: '/trigger', description: 'Use and manage trigger responses available in this server.' },
    { path: 'resetmemory', label: '/resetmemory', description: 'Delete your own saved AI conversation memory.' },
    { path: 'data', label: '/data view|export|delete|correct|ai-consent', description: 'Access, export, delete, correct, or control external AI processing of your stored data.' },
    { path: 'report', label: '/report submit|status', description: 'Privately report abuse, safety, privacy, or policy issues and follow their status.' },
    { path: 'tree', label: '/tree', description: 'Open this community’s family tree.' },
    { path: 'community', label: '/community report|remind|afk|rank|pulse', description: 'Use private reports and enabled community utilities.' },
    { path: 'serverstats', label: '/serverstats [limit]', description: 'View server message, channel, member, and trigger activity.', minimumRole: 'admin' },
    { path: 'voicetime', label: '/voicetime member|history|channel', description: 'View member and channel voice activity.', minimumRole: 'admin' },
    { path: 'userinfo', label: '/userinfo user', description: 'View a member’s bot permissions and role.', minimumRole: 'admin' },
    { path: 'settings', label: '/settings view|bot|triggers', description: 'View or change selected guild bot settings.', minimumRole: 'admin' },
    { path: 'manage.features', label: '/manage features', description: 'Set feature access for a member.', minimumRole: 'admin' },
    { path: 'manage.command', label: '/manage command', description: 'Set a command override for a member.', minimumRole: 'admin' },
    { path: 'server', label: '/server safety and community tools', description: 'Use server safety, recovery, staff, and engagement tools.', minimumRole: 'admin' },
    { path: 'shots.audit', label: '/shots audit [limit]', description: 'View the developer audit log for shot changes.', minimumRole: 'developer' },
    { path: 'dashboard', label: '/dashboard', description: 'Open the public Flummi dashboard.' }
];

const ROLE_RANK = { member: 0, admin: 1, developer: 2 };

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
            const minimumRole = entry.minimumRole || 'member';
            const requiredRole = ROLE_RANK[configuredRole] >= ROLE_RANK[minimumRole]
                ? configuredRole
                : minimumRole;

            return {
                ...entry,
                requiredRole,
                label: `\`${entry.label}\` — ${appendAccessSuffix(entry.description, requiredRole)}`
            };
        });
}

module.exports = {
    getConfiguredCommandRows,

    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show your available commands and role')
        .setDMPermission(false),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const developer = isDeveloper(userId);
        const admin = isAdmin(userId, guildId, interaction.memberPermissions);
        const userRole = getUserRole(userId, guildId, interaction.memberPermissions);

        const roleLabel = developer ? 'Developer' : admin ? 'Admin' : 'Member';
        const roleColor = developer
            ? 0xFF1744
            : admin
                ? 0x1E88E5
                : 0xFFFFFF;
        const botStatus = readSettings(guildId).botEnabled ? 'Enabled' : 'Disabled';

        const availabilityNote = developer
            ? 'You can use every command, including developer-only ones.'
            : admin
                ? 'You can use member commands and admin-only commands.'
                : 'You can use member commands.';

        const commandRows = getCatalogCommandRows(interaction.client, guildId);

        const memberCommands = commandRows
            .filter(row => row.requiredRole === 'member')
            .map(row => row.label);

        const adminCommands = commandRows
            .filter(row => row.requiredRole === 'admin')
            .map(row => row.label);

        const developerCommands = commandRows
            .filter(row => row.requiredRole === 'developer')
            .map(row => row.label);

        const embed = createCommandEmbed(interaction, {
            title: 'Command Guide',
            description: availabilityNote,
            tone: developer ? 'danger' : admin ? 'staff' : 'primary',
            footer: 'Flummi • Commands update with your access level'
        })
            .addFields(
                { name: 'Your Role', value: roleLabel, inline: true },
                { name: 'Bot Status', value: botStatus, inline: true }
            )
            .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }));

        if (roleMeetsRequirement(userRole, 'member')) {
            embed.addFields({
                name: 'Member Commands',
                value: memberCommands.join('\n') || 'No member commands.',
                inline: false
            });
        }

        if (admin) {
            embed.addFields({
                name: 'Admin Commands',
                value: adminCommands.join('\n') || 'No admin commands.',
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
