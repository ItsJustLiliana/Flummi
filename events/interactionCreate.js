const { MessageFlags } = require('discord.js');
const { canUseCommandPath, canUseTriggerCommands, isAdmin } = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');

async function handleRemoveTriggerButton(interaction) {
    if (
        interaction.customId !== 'removetrigger:confirm' &&
        interaction.customId !== 'removetrigger:cancel'
    ) {
        return false;
    }

    const { pendingRemovals } = require('../commands/trigger');
    const pendingKey = `${interaction.guildId || 'global'}:${interaction.user.id}`;
    const phrase = pendingRemovals.get(pendingKey);
    pendingRemovals.delete(pendingKey);

    if (!phrase) {
        await interaction.update({ content: 'This confirmation has expired.', components: [] });
        return true;
    }

    if (interaction.customId === 'removetrigger:cancel') {
        await interaction.update({ content: 'Removal cancelled.', components: [] });
        return true;
    }

    const { removeTrigger, appendAuditEntry } = require('../stores/trigger-store');
    const result = removeTrigger(phrase, interaction.guildId);

    if (!result.ok) {
        await interaction.update({ content: `Trigger "${phrase}" was already removed.`, components: [] });
        return true;
    }

    const pad = v => String(v).padStart(2, '0');
    const now = new Date();
    const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    appendAuditEntry({
        action: 'remove',
        trigger: result.trigger.trigger,
        byId: interaction.user.id,
        byTag: interaction.user.tag,
        at
    }, interaction.guildId);

    await interaction.update({ content: `Removed trigger "${result.trigger.trigger}".`, components: [] });
    return true;
}

module.exports = {
    name: 'interactionCreate',

    async execute(interaction) {
        if (interaction.isModalSubmit() && interaction.customId.startsWith('community-form:')) {
            const { EmbedBuilder } = require('discord.js');
            const store = require('../stores/community-management-store');
            const { moduleConfig } = require('../services/community-management-service');
            const type = interaction.customId.split(':')[1];
            const config = moduleConfig(interaction.guildId, 'forms');
            if (!config) return interaction.reply({ content: 'Forms & Appeals were turned off before this form was sent.', flags: MessageFlags.Ephemeral });
            const answers = [...interaction.fields.fields.values()].map((field, index) => ({ question: field.label || `Answer ${index + 1}`, answer: field.value }));
            const submission = store.addSubmission(interaction.guildId, { type, authorId: interaction.user.id, answers });
            const channelId = config.reviewChannelId || config.submissionChannelId;
            const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);
            if (!channel?.isTextBased()) return interaction.reply({ content: 'An admin needs to select a form review channel first.', flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder().setTitle(`${type === 'appeal' ? 'Appeal' : 'Application'} ${submission.id}`).setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }).addFields(answers.map(entry => ({ name: entry.question.slice(0, 256), value: entry.answer.slice(0, 1024) }))).setColor(type === 'appeal' ? 0xf59e42 : 0x7785ff).setTimestamp();
            await channel.send({ embeds: [embed] });
            return interaction.reply({ content: `Your ${type} was sent as **${submission.id}**.`, flags: MessageFlags.Ephemeral });
        }
        if (interaction.isStringSelectMenu()) {
            const { handleRoleSelect } = require('../services/role-service');
            if (await handleRoleSelect(interaction)) return;
        }
        if (interaction.isButton()) {
            if (interaction.customId.startsWith('voicetime-channel-history:')) {
                if (!interaction.guildId || !isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions)) {
                    await interaction.reply({
                        content: 'You need admin permissions to view voice history.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const [, channelId, pageValue] = interaction.customId.split(':');
                const { buildChannelMembersPage } = require('../commands/voicetime');
                await interaction.update(buildChannelMembersPage(
                    interaction.guildId,
                    channelId,
                    Number(pageValue)
                ));
                return;
            }

            if (interaction.customId.startsWith('voicetime-history:')) {
                if (!interaction.guildId || !isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions)) {
                    await interaction.reply({
                        content: 'You need admin permissions to view voice history.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const [, targetUserId, channelValue, pageValue] = interaction.customId.split(':');
                const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);

                if (!targetUser) {
                    await interaction.reply({
                        content: 'That user could not be found.',
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const { buildHistoryPage } = require('../commands/voicetime');
                await interaction.update(buildHistoryPage(
                    interaction.guildId,
                    targetUser,
                    Number(pageValue),
                    channelValue === '-' ? null : channelValue
                ));
                return;
            }

            if (
                interaction.customId.startsWith('removetrigger:') &&
                !canUseTriggerCommands(interaction.user.id)
            ) {
                await interaction.reply({
                    content: 'This feature is under maintenance, try again later.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await handleRemoveTriggerButton(interaction);
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        if (!interaction.guildId) {
            return interaction.reply({
                content: 'This bot can only be used inside a server.',
                flags: MessageFlags.Ephemeral
            });
        }

        const command =
            interaction.client.commands.get(interaction.commandName);

        if (!command) return;

        const guildId = interaction.guildId;
        const settings = readSettings(guildId);
        const allowedWhenDisabled = new Set([
            'help',
            'ping',
            'status',
            'settings'
        ]);

        if (!settings.botEnabled && !allowedWhenDisabled.has(command.data.name)) {
            return interaction.reply({
                content: 'The bot is currently disabled. Use `/settings bot enabled:true` to turn it back on.',
                flags: MessageFlags.Ephemeral
            });
        }

        const triggerCommands = new Set([
            'trigger'
        ]);

        if (
            triggerCommands.has(command.data.name) &&
            !canUseTriggerCommands(interaction.user.id)
        ) {
            return interaction.reply({
                content: 'This feature is under maintenance, try again later.',
                flags: MessageFlags.Ephemeral
            });
        }

        let subcommandName = null;
        let subcommandGroupName = null;

        try {
            subcommandGroupName = interaction.options.getSubcommandGroup(false);
            subcommandName = interaction.options.getSubcommand(false);
        } catch {
            subcommandName = null;
            subcommandGroupName = null;
        }

        const commandAccess = canUseCommandPath({
            userId: interaction.user.id,
            guildId,
            commandName: command.data.name,
            subcommandName,
            subcommandGroupName,
            commandDefinition: command,
            memberPermissions: interaction.memberPermissions
        });

        if (!commandAccess.allowed) {
            const commandPath = subcommandName
                ? subcommandGroupName
                    ? `${command.data.name}.${subcommandGroupName}.${subcommandName}`
                    : `${command.data.name}.${subcommandName}`
                : command.data.name;
            const blockedByOverride = commandAccess.override && commandAccess.override.allowed === false;

            return interaction.reply({
                content: blockedByOverride
                    ? `You are blocked from using /${commandPath}.`
                    : `You need ${commandAccess.requiredRole} permissions to use this command.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);

            const reply = {
                content: 'There was an error while executing this command.',
                flags: MessageFlags.Ephemeral
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply).catch(replyError => {
                    console.error(`Could not send the error follow-up for /${interaction.commandName}:`, replyError);
                });
            } else {
                // An interaction may have expired while a command was working. Never let that
                // secondary reply failure crash the bot process.
                await interaction.reply(reply).catch(replyError => {
                    console.error(`Could not send the error reply for /${interaction.commandName}:`, replyError);
                });
            }
        }
    }
};
