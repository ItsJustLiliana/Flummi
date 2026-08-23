const { MessageFlags } = require('discord.js');
const {
    ModerationError,
    durationLabel,
    executeModerationAction,
    parseDuration
} = require('../services/moderation-service');

const completedLabels = {
    warn: 'Warned',
    timeout: 'Timed out',
    untimeout: 'Removed the timeout from',
    kick: 'Kicked',
    ban: 'Banned',
    unban: 'Unbanned'
};

async function replyWithError(interaction, error) {
    if (!(error instanceof ModerationError)) {
        console.error(`Failed to run /${interaction.commandName}:`, error);
    }

    const content = error instanceof ModerationError
        ? error.message
        : 'That moderation action could not be completed. Check Flummi\'s permissions and role position.';

    if (interaction.deferred || interaction.replied) return interaction.editReply(content);
    return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function runMemberAction(interaction, action, { durationInput = null } = {}) {
    const member = interaction.options.getUser('member', true);
    const reason = interaction.options.getString('reason');
    let durationMs = null;

    if (durationInput) {
        durationMs = parseDuration(durationInput);
        if (!durationMs) {
            return interaction.reply({
                content: 'Use a duration like `30m`, `2h`, or `1d`.',
                flags: MessageFlags.Ephemeral
            });
        }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const result = await executeModerationAction({
            guild: interaction.guild,
            action,
            actorId: interaction.user.id,
            actorLabel: interaction.user.tag,
            targetId: member.id,
            reason,
            durationMs,
            channel: interaction.channel
        });

        if (result.action === 'ban-approval') {
            return interaction.editReply(`Ban request created as **${result.id}**. A different admin must approve it with \`/server approve-ban\`.`);
        }

        const duration = action === 'timeout' ? ` for **${durationLabel(result.durationMs)}**` : '';
        return interaction.editReply(`${completedLabels[action]} **${member.tag}**${duration}. Case **${result.id}**.`);
    } catch (error) {
        return replyWithError(interaction, error);
    }
}

async function runUnban(interaction) {
    const userId = interaction.options.getString('user-id', true).trim();
    if (!/^\d{17,20}$/.test(userId)) {
        return interaction.reply({ content: 'Enter a valid Discord user ID.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const result = await executeModerationAction({
            guild: interaction.guild,
            action: 'unban',
            actorId: interaction.user.id,
            actorLabel: interaction.user.tag,
            targetId: userId,
            reason: interaction.options.getString('reason'),
            channel: interaction.channel
        });
        return interaction.editReply(`Unbanned **${result.targetLabel || userId}**. Case **${result.id}**.`);
    } catch (error) {
        return replyWithError(interaction, error);
    }
}

async function runPurge(interaction) {
    const amount = interaction.options.getInteger('amount', true);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        const result = await executeModerationAction({
            guild: interaction.guild,
            action: 'purge',
            actorId: interaction.user.id,
            actorLabel: interaction.user.tag,
            reason: interaction.options.getString('reason'),
            channel: interaction.channel,
            count: amount
        });
        return interaction.editReply(`Deleted **${result.metadata.deletedMessages}** messages. Case **${result.id}**.`);
    } catch (error) {
        return replyWithError(interaction, error);
    }
}

module.exports = { runMemberAction, runPurge, runUnban };
