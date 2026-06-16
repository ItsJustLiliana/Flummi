const { MessageFlags } = require('discord.js');
const { isDeveloper, isManager, canUseTriggerCommands } = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');

async function handleRemoveTriggerButton(interaction) {
    if (
        interaction.customId !== 'removetrigger:confirm' &&
        interaction.customId !== 'removetrigger:cancel'
    ) {
        return false;
    }

    const { pendingRemovals } = require('../commands/removetrigger');
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
        if (interaction.isButton()) {
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
            'settings'
        ]);

        if (!settings.botEnabled && !allowedWhenDisabled.has(command.data.name)) {
            return interaction.reply({
                content: 'The bot is currently disabled. Use `/settings setting:Bot Enabled value:true` to turn it back on.',
                flags: MessageFlags.Ephemeral
            });
        }

        const triggerCommands = new Set([
            'addtrigger',
            'edittrigger',
            'removetrigger',
            'triggerstats'
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

        if (command.devOnly && !isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: MessageFlags.Ephemeral
            });
        }

        if (
            command.managerOnly &&
            !isManager(interaction.user.id, guildId)
        ) {
            return interaction.reply({
                content: 'You need manager permissions to use this command.',
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
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    }
};