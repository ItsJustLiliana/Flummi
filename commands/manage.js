const { EmbedBuilder, MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../utils/command-ui');
const {
    getRequiredCommandRole,
    getUserPermissions,
    getUserRole,
    isDeveloper,
    normalizeCommandPath,
    roleMeetsRequirement,
    setUserCommandPermission,
    setUserPermission
} = require('../stores/access-store');
const { checkCooldown } = require('../utils/cooldowns');
const { readSettings } = require('../stores/settings-store');

function formatCommandOverrides(overrides) {
    const rows = Object.entries(overrides || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([pathKey, allowed]) => `${pathKey}: ${allowed ? 'allowed' : 'blocked'}`);

    return rows.length ? rows.join(' | ') : 'none';
}

function formatFeaturePermissions(perms) {
    return [
        `Normal triggers: ${perms.useTriggers ? 'Enabled' : 'Disabled'}`,
        `Add triggers: ${perms.addTriggers ? 'Enabled' : 'Disabled'}`,
        `AI chat: ${perms.useAiChat ? 'Enabled' : 'Disabled'}`,
        `@bot responses: ${perms.useBotMentions ? 'Enabled' : 'Disabled'}`,
        `Ping-save: ${perms.savePingRequests ? 'Enabled' : 'Disabled'}`
    ].join('\n');
}

module.exports = {
    adminOnly: true,

    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Manage member permissions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('features')
                .setDescription('Set bot feature permissions for a member')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to manage')
                        .setRequired(true)
                )
                .addBooleanOption(option =>
                    option
                        .setName('using-triggers')
                        .setDescription('Allow or deny using triggers')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName('adding-triggers')
                        .setDescription('Allow or deny adding triggers')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName('ai-chat')
                        .setDescription('Allow or deny AI replies when mentioning/replying to the bot')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName('bot-mentions')
                        .setDescription('Allow or deny @bot random mention responses')
                        .setRequired(false)
                )
                .addBooleanOption(option =>
                    option
                        .setName('ping-save')
                        .setDescription('Allow or deny saving replied messages with configured @bot save phrases')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('command')
                .setDescription('Set one command override for a member')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('Member to manage')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('path')
                        .setDescription('Command to override, for example trigger.add, ticket.claim, serverstats')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('access')
                        .setDescription('Override access for this command')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Allow', value: 'allow' },
                            { name: 'Block', value: 'block' },
                            { name: 'Inherit role config', value: 'inherit' }
                        )
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');

        if (subcommand === 'features' || subcommand === 'command') {
            if (!isDeveloper(interaction.user.id)) {
                const settings = readSettings(guildId);

                if (settings.triggerActionCooldownEnabled) {
                    const cooldown = checkCooldown(
                        interaction.user.id,
                        'trigger-action',
                        settings.triggerActionCooldownSeconds
                    );

                    if (!cooldown.allowed) {
                        return interaction.reply({
                            content: `Please wait ${cooldown.remaining} more second(s) before using this command again.`,
                            flags: MessageFlags.Ephemeral
                        });
                    }
                }
            }

            const usingTriggers = interaction.options.getBoolean('using-triggers');
            const addingTriggers = interaction.options.getBoolean('adding-triggers');
            const aiChat = interaction.options.getBoolean('ai-chat');
            const botMentions = interaction.options.getBoolean('bot-mentions');
            const pingSave = interaction.options.getBoolean('ping-save');
            const commandPathInput = interaction.options.getString('path');
            const commandAccess = interaction.options.getString('access');
            const commandPath = normalizeCommandPath(commandPathInput);
            const featureOptions = [
                ['useTriggers', usingTriggers, 'normal triggers'],
                ['addTriggers', addingTriggers, 'add triggers'],
                ['useAiChat', aiChat, 'AI chat'],
                ['useBotMentions', botMentions, '@bot responses'],
                ['savePingRequests', pingSave, 'ping-save']
            ];

            if (subcommand === 'features' && featureOptions.every(([, value]) => value === null)) {
                return interaction.reply({
                    content: 'Choose at least one feature permission to change.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (subcommand === 'command' && !commandPath) {
                return interaction.reply({
                    content: 'Provide a valid command path, for example trigger.add or ticket.claim.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!isDeveloper(interaction.user.id) && isDeveloper(targetUser.id)) {
                return interaction.reply({
                    content: 'Only developers can change permissions for developers.',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                for (const [key, value] of featureOptions) {
                    if (subcommand === 'features' && value !== null) {
                        setUserPermission(targetUser.id, key, value, guildId);
                    }
                }

                if (subcommand === 'command') {
                    const [commandName, groupOrSubcommandName, nestedSubcommandName] = commandPath.split('.');
                    const requiredRole = getRequiredCommandRole(
                        commandName,
                        nestedSubcommandName || groupOrSubcommandName || null,
                        null,
                        nestedSubcommandName ? groupOrSubcommandName : null
                    );
                    const actorRole = getUserRole(interaction.user.id, guildId, interaction.memberPermissions);
                    const nextValue = commandAccess === 'inherit'
                        ? null
                        : commandAccess === 'allow';

                    if (nextValue === true && !roleMeetsRequirement(actorRole, requiredRole)) {
                        return interaction.reply({
                            content: `You cannot allow ${commandPath}; it requires ${requiredRole} permissions.`,
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    setUserCommandPermission(targetUser.id, commandPath, nextValue, guildId);
                }
            } catch (error) {
                console.error('Failed to update member permission:', error);
                return interaction.reply({ content: 'Failed to update member permissions.', flags: MessageFlags.Ephemeral });
            }

            const updated = getUserPermissions(targetUser.id, guildId);
            const changes = [];

            for (const [key, value, label] of featureOptions) {
                if (subcommand === 'features' && value !== null) {
                    changes.push(`${label}: ${updated[key] ? 'enabled' : 'disabled'}`);
                }
            }

            if (subcommand === 'command') {
                changes.push(`command ${commandPath}: ${commandAccess === 'inherit' ? 'inherited' : commandAccess === 'allow' ? 'allowed' : 'blocked'}`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`Permissions Updated: ${targetUser.tag}`)
                .setColor(COLORS.staff)
                .addFields(
                    { name: 'Changes', value: changes.join('\n') || 'No changes.', inline: false },
                    { name: 'Feature Permissions', value: formatFeaturePermissions(updated), inline: false },
                    { name: 'Command Overrides', value: formatCommandOverrides(updated.commandOverrides), inline: false }
                );

            return interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral
            });
        }

        return interaction.reply({
            content: 'Unknown mode. Use /manage features or /manage command.',
            flags: MessageFlags.Ephemeral
        });
    }
};
