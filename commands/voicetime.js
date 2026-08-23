const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    SlashCommandBuilder
} = require('discord.js');
const {
    getChannelVoiceMembers,
    getUserVoiceStats,
    getVoiceHistory
} = require('../stores/voice-store');

const HISTORY_PAGE_SIZE = 5;

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}

function formatDiscordTimestamp(value, style = 'R') {
    const date = value ? new Date(value) : null;

    if (!date || Number.isNaN(date.getTime())) {
        return 'Never';
    }

    return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function buildHistoryPage(guildId, targetUser, page = 0, channelId = null) {
    const history = getVoiceHistory(guildId, targetUser.id, channelId);
    const pageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
    const pageEntries = history.slice(safePage * HISTORY_PAGE_SIZE, (safePage + 1) * HISTORY_PAGE_SIZE);
    const description = pageEntries.length
        ? pageEntries.map((session, index) => {
            const companions = session.withUserIds
                .filter(userId => userId !== targetUser.id)
                .map(userId => `<@${userId}>`)
                .join(', ') || 'Alone';
            const ended = session.endedAt ? formatDiscordTimestamp(session.endedAt) : 'still active';
            return `${safePage * HISTORY_PAGE_SIZE + index + 1}. <#${session.channelId}> - ${formatDiscordTimestamp(session.startedAt)} to ${ended} (${formatDuration(session.durationMs)})\nWith: ${companions}`;
        }).join('\n\n')
        : 'No voice session history recorded yet.';
    const components = pageCount > 1
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`voicetime-history:${targetUser.id}:${channelId || '-'}:${safePage - 1}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`voicetime-history:${targetUser.id}:${channelId || '-'}:${safePage + 1}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === pageCount - 1)
        )]
        : [];

    return {
        embeds: [new EmbedBuilder()
            .setTitle(`Voice History: ${targetUser.tag}${pageCount > 1 ? ` (${safePage + 1}/${pageCount})` : ''}`)
            .setColor(0x1E88E5)
            .setDescription(description)],
        components
    };
}

function buildChannelMembersPage(guildId, channelId, page = 0) {
    const members = getChannelVoiceMembers(guildId, channelId);
    const pageCount = Math.max(1, Math.ceil(members.length / HISTORY_PAGE_SIZE));
    const safePage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
    const pageEntries = members.slice(safePage * HISTORY_PAGE_SIZE, (safePage + 1) * HISTORY_PAGE_SIZE);
    const description = pageEntries.length
        ? pageEntries.map((member, index) => `${safePage * HISTORY_PAGE_SIZE + index + 1}. <@${member.userId}> - last joined ${formatDiscordTimestamp(member.lastJoinedAt)}${member.inVoice ? ' (in VC now)' : ''}`).join('\n')
        : 'No members have entered this channel yet.';
    const components = pageCount > 1
        ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`voicetime-channel-history:${channelId}:${safePage - 1}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`voicetime-channel-history:${channelId}:${safePage + 1}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === pageCount - 1)
        )]
        : [];

    return {
        embeds: [new EmbedBuilder()
            .setTitle(`Voice Members: <#${channelId}>${pageCount > 1 ? ` (${safePage + 1}/${pageCount})` : ''}`)
            .setColor(0x1E88E5)
            .setDescription(description)],
        components
    };
}

module.exports = {
    buildChannelMembersPage,
    buildHistoryPage,
    managerOnly: true,

    data: new SlashCommandBuilder()
        .setName('voicetime')
        .setDescription('Show voice channel activity')
        .addSubcommand(subcommand => subcommand
            .setName('member')
            .setDescription('Show voice activity for a member')
            .addUserOption(option => option.setName('user').setDescription('Member to check (defaults to you)').setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('history')
            .setDescription('Show recorded voice sessions for a member')
            .addUserOption(option => option.setName('user').setDescription('Member to check (defaults to you)').setRequired(false))
            .addChannelOption(option => option.setName('channel').setDescription('Only sessions in this channel')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('channel')
            .setDescription('Show members recorded in a voice channel')
            .addChannelOption(option => option.setName('channel').setDescription('Voice or stage channel')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice).setRequired(true))),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const subcommand = interaction.options.getSubcommand();
        const historyChannel = interaction.options.getChannel('channel');

        const selectedUser = interaction.options.getUser('user');

        if (subcommand === 'history') {
            const targetUser = selectedUser || interaction.user;
            await interaction.reply({
                ...buildHistoryPage(guildId, targetUser, 0, historyChannel?.id || null),
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (subcommand === 'channel') {
            await interaction.reply({
                ...buildChannelMembersPage(guildId, historyChannel.id, 0),
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const targetUser = selectedUser || interaction.user;

        const stats = getUserVoiceStats(guildId, targetUser.id);

        const topChannels = stats.byChannel.slice(0, 5)
            .map((row, index) => `${index + 1}. <#${row.id}> - ${formatDuration(row.ms)}`)
            .join('\n') || 'No voice activity tracked yet.';

        const embed = new EmbedBuilder()
            .setTitle(`Voice Time: ${targetUser.tag}`)
            .setColor(0x1E88E5)
            .addFields(
                { name: 'Total Voice Time', value: formatDuration(stats.totalMs), inline: true },
                {
                    name: 'Currently In',
                    value: stats.currentChannelId
                        ? `<#${stats.currentChannelId}> since ${formatDiscordTimestamp(stats.currentSince)}`
                        : 'Not in a voice channel',
                    inline: true
                },
                {
                    name: 'Last In',
                    value: stats.lastChannelId ? `<#${stats.lastChannelId}>` : 'Unknown',
                    inline: true
                },
                { name: 'Last Left', value: formatDiscordTimestamp(stats.lastLeftAt), inline: true },
                { name: 'Top Channels', value: topChannels, inline: false }
            );

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
