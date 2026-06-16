const { MessageFlags } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const { setUserPermission, getUserPermissions, isDeveloper, setManagerRole } = require('../stores/access-store');
const { checkCooldown } = require('../utils/cooldowns');
const { readSettings } = require('../stores/settings-store');

module.exports = {
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Manage user roles and permissions')
        .addSubcommand(subcommand =>
            subcommand
                .setName('permissions')
                .setDescription('Set trigger permissions for a user')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to manage')
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
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('role')
                .setDescription('Set user role (developer only)')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('User to manage')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('role')
                        .setDescription('Role to set')
                        .setRequired(true)
                        .addChoices(
                            { name: 'User', value: 'user' },
                            { name: 'Manager', value: 'manager' }
                        )
                )
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();
        const targetUser = interaction.options.getUser('user');

        if (subcommand === 'permissions') {
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

            if (usingTriggers === null && addingTriggers === null) {
                return interaction.reply({
                    content: 'For permissions mode, provide using-triggers and/or adding-triggers.',
                    flags: MessageFlags.Ephemeral
                });
            }

            try {
                if (usingTriggers !== null) {
                    setUserPermission(targetUser.id, 'useTriggers', usingTriggers, guildId);
                }

                if (addingTriggers !== null) {
                    setUserPermission(targetUser.id, 'addTriggers', addingTriggers, guildId);
                }
            } catch (error) {
                console.error('Failed to update user permission:', error);
                return interaction.reply({ content: 'Failed to update user permissions.', flags: MessageFlags.Ephemeral });
            }

            const updated = getUserPermissions(targetUser.id, guildId);
            return interaction.reply({
                content:
                    `Updated ${targetUser.tag}. ` +
                    `using triggers enabled:${updated.useTriggers} | ` +
                    `adding triggers enabled:${updated.addTriggers}`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (subcommand === 'role') {
            if (!isDeveloper(interaction.user.id)) {
                return interaction.reply({ content: 'Only developers can manage roles.', flags: MessageFlags.Ephemeral });
            }

            const role = interaction.options.getString('role');

            if (role === 'manager') {
                setManagerRole(targetUser.id, true, guildId);

                return interaction.reply({ content: `${targetUser.tag} role:manager`, flags: MessageFlags.Ephemeral });
            }

            if (role === 'user') {
                setManagerRole(targetUser.id, false, guildId);

                return interaction.reply({ content: `${targetUser.tag} role:user`, flags: MessageFlags.Ephemeral });
            }
        }

        return interaction.reply({
            content: 'Unknown mode. Use /manage permissions or /manage role.',
            flags: MessageFlags.Ephemeral
        });
    }
};
