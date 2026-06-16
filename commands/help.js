const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { isDeveloper, isManager } = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');

const HELP_COMMAND_ORDER = [
    'help',
    'ping',
    'tree',
    'resetmemory',
    'shots',
    'addtrigger',
    'triggerlist',
    'triggerinfo',
    'triggerstats',
    'triggeraudit',
    'edittrigger',
    'removetrigger',
    'userinfo',
    'manage',
    'settings'
];

function sortByHelpOrder(left, right) {
    const leftIndex = HELP_COMMAND_ORDER.indexOf(left.data.name);
    const rightIndex = HELP_COMMAND_ORDER.indexOf(right.data.name);

    if (leftIndex === -1 && rightIndex === -1) {
        return left.data.name.localeCompare(right.data.name);
    }

    if (leftIndex === -1) {
        return 1;
    }

    if (rightIndex === -1) {
        return -1;
    }

    return leftIndex - rightIndex;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show your available commands and role'),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const developer = isDeveloper(userId);
        const manager = isManager(userId, guildId);

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

        const commands = Array.from(interaction.client.commands.values())
            .sort(sortByHelpOrder);

        const publicCommands = commands
            .filter(command => !command.devOnly && !command.managerOnly)
            .map(command => `/${command.data.name} - ${command.data.description}`);

        const managerCommands = commands
            .filter(command => command.managerOnly)
            .map(command => `/${command.data.name} - ${command.data.description}`);

        const developerCommands = commands
            .filter(command => command.devOnly)
            .map(command => `/${command.data.name} - ${command.data.description}`);

        const embed = new EmbedBuilder()
            .setColor(roleColor)
            .setTitle('Bot Help')
            .setDescription(`${availabilityNote}`)
            .addFields(
                { name: 'Your Role', value: roleLabel, inline: true },
                { name: 'Bot Status', value: botStatus, inline: true },
                { name: 'Available Commands', value: publicCommands.join('\n') || 'No public commands.', inline: false }
            )
            .setFooter({ text: 'Blue = manager, red = developer, white = user' });

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
