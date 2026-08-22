const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { executeModerationAction, durationLabel, parseDuration } = require('../services/moderation-service');
const { getCase, getMemberCases } = require('../stores/moderation-store');
const { readSettings } = require('../stores/settings-store');

const ephemeral = MessageFlags.Ephemeral;

function userAction(name, description, duration = false) {
    return sub => {
        sub.setName(name).setDescription(description)
            .addUserOption(option => option.setName('user').setDescription('Member to moderate').setRequired(true));
        if (duration) sub.addStringOption(option => option.setName('duration').setDescription('For example 30m, 2h or 7d').setRequired(name === 'timeout'));
        return sub.addStringOption(option => option.setName('reason').setDescription('Reason for this action').setRequired(false));
    };
}

function caseSummary(entry) {
    const when = Math.floor(new Date(entry.createdAt).getTime() / 1000);
    return `**${entry.id}** · ${entry.action} · <@${entry.targetId}> · <t:${when}:R>\n${entry.reason}`;
}

module.exports = {
    managerOnly: true,
    data: new SlashCommandBuilder()
        .setName('moderate').setDescription('Moderation actions and case history')
        .addSubcommand(userAction('warn', 'Warn a member'))
        .addSubcommand(userAction('timeout', 'Temporarily mute a member', true))
        .addSubcommand(userAction('untimeout', 'Remove a member timeout'))
        .addSubcommand(userAction('kick', 'Kick a member'))
        .addSubcommand(userAction('ban', 'Ban or temporarily ban a member', true))
        .addSubcommand(userAction('softban', 'Ban and immediately unban to remove recent messages'))
        .addSubcommand(userAction('note', 'Add a private case note'))
        .addSubcommand(sub => sub.setName('unban').setDescription('Unban a user by ID')
            .addStringOption(option => option.setName('user-id').setDescription('Discord user ID').setRequired(true))
            .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sub => sub.setName('purge').setDescription('Delete recent messages')
            .addIntegerOption(option => option.setName('count').setDescription('1 to 100').setMinValue(1).setMaxValue(100).setRequired(true))
            .addChannelOption(option => option.setName('channel').setDescription('Defaults to this channel').setRequired(false))
            .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sub => sub.setName('slowmode').setDescription('Set channel slowmode')
            .addIntegerOption(option => option.setName('seconds').setDescription('0 disables, maximum 21600').setMinValue(0).setMaxValue(21600).setRequired(true))
            .addChannelOption(option => option.setName('channel').setDescription('Defaults to this channel').setRequired(false))
            .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sub => sub.setName('lock').setDescription('Lock a channel')
            .addChannelOption(option => option.setName('channel').setDescription('Defaults to this channel').setRequired(false))
            .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sub => sub.setName('unlock').setDescription('Unlock a channel')
            .addChannelOption(option => option.setName('channel').setDescription('Defaults to this channel').setRequired(false))
            .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(false)))
        .addSubcommand(sub => sub.setName('history').setDescription('View moderation history for a member')
            .addUserOption(option => option.setName('user').setDescription('Member').setRequired(true)))
        .addSubcommand(sub => sub.setName('case').setDescription('View one case')
            .addStringOption(option => option.setName('id').setDescription('Case ID').setRequired(true))),

    async execute(interaction) {
        if (!interaction.guild) return interaction.reply({ content: 'This command only works in a server.', flags: ephemeral });
        const sub = interaction.options.getSubcommand();
        const settings = readSettings(interaction.guildId);
        if (!settings.management.modules.moderation && !['history', 'case'].includes(sub)) {
            return interaction.reply({ content: 'Enable the Moderation module in the Flummi dashboard first.', flags: ephemeral });
        }
        if (sub === 'history') {
            const user = interaction.options.getUser('user', true);
            const entries = getMemberCases(interaction.guildId, user.id).slice(0, 10);
            return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`Cases for ${user.tag}`).setDescription(entries.length ? entries.map(caseSummary).join('\n\n') : 'No cases found.').setColor(0x75cfff)], flags: ephemeral });
        }
        if (sub === 'case') {
            const entry = getCase(interaction.guildId, interaction.options.getString('id', true));
            return interaction.reply({ content: entry ? caseSummary(entry) : 'Case not found.', flags: ephemeral });
        }
        await interaction.deferReply({ flags: ephemeral });
        try {
            const user = interaction.options.getUser('user');
            const durationText = interaction.options.getString('duration');
            const durationMs = durationText ? parseDuration(durationText) : null;
            if (durationText && durationMs === null) throw new Error('Invalid duration. Use a value such as 30m, 2h or 7d.');
            const action = sub === 'ban' && durationMs ? 'tempban' : sub;
            const entry = await executeModerationAction({
                guild: interaction.guild, action, actorId: interaction.user.id, actorLabel: interaction.user.tag,
                targetId: user?.id || interaction.options.getString('user-id'), reason: interaction.options.getString('reason'),
                durationMs, channel: interaction.options.getChannel('channel') || interaction.channel,
                count: interaction.options.getInteger('count'), seconds: interaction.options.getInteger('seconds'),
                metadata: { deleteMessageSeconds: sub === 'softban' ? 86400 : 0 }
            });
            const duration = entry.durationMs ? ` for ${durationLabel(entry.durationMs)}` : '';
            return interaction.editReply(`Done: **${entry.action}**${duration}. Case: \`${entry.id}\``);
        } catch (error) {
            return interaction.editReply(`Could not complete that action: ${error.message}`);
        }
    }
};
