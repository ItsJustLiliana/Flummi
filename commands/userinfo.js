const { MessageFlags } = require('discord.js');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { getUserRole, isDeveloper, isAdmin, getUserPermissions } = require('../stores/access-store');
const { getUserMessageStats } = require('../stores/server-stats-store');
const { getUserConversationSummary } = require('../stores/user-conversation-store');
const { formatColor, getProfile } = require('../stores/profile-store');

function formatDiscordTimestamp(date, style = 'f') {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 'Unknown';
    }

    return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

function formatPercent(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0%';
    }

    return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function formatCommandOverrideList(overrides, allowedValue) {
    const rows = Object.entries(overrides || {})
        .filter(([, allowed]) => allowed === allowedValue)
        .map(([pathKey]) => pathKey)
        .sort((left, right) => left.localeCompare(right));

    if (rows.length === 0) {
        return 'None';
    }

    const output = rows.slice(0, 10).join('\n');
    return rows.length > 10 ? `${output}\n...and ${rows.length - 10} more` : output;
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
        .setName('userinfo')
        .setDescription('View permissions and role for a member')
        .addUserOption(option =>
            option.setName('user').setDescription('Member to check').setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const targetUser = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
        const dev = isDeveloper(targetUser.id);
        const admin = isAdmin(targetUser.id, guildId, member?.permissions);
        const roleKey = getUserRole(targetUser.id, guildId, member?.permissions);
        const perms = getUserPermissions(targetUser.id, guildId);
        const messageStats = getUserMessageStats(guildId, targetUser.id);
        const memory = getUserConversationSummary(targetUser.id);
        const profile = getProfile(targetUser.id, guildId);

        const role = dev ? 'Developer' : admin ? 'Admin' : 'Member';
        const joinedAt = member?.joinedAt || null;
        const highestRole = member?.roles?.highest?.name || 'Unknown';
        const serverNickname = member?.nickname || 'None';
        const accountCreated = targetUser.createdAt || null;

        const embed = new EmbedBuilder()
            .setTitle(`Member Info: ${targetUser.tag}`)
            .setColor(dev ? 0xFF1744 : admin ? 0x1E88E5 : 0xFFFFFF)
            .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
            .addFields(
                { name: 'Discord', value: [
                    `ID: ${targetUser.id}`,
                    `Bot: ${targetUser.bot ? 'Yes' : 'No'}`,
                    `Created: ${formatDiscordTimestamp(accountCreated)}`
                ].join('\n'), inline: false },
                { name: 'Server', value: [
                    `Joined: ${formatDiscordTimestamp(joinedAt)}`,
                    `Nickname: ${serverNickname}`,
                    `Highest Role: ${highestRole}`
                ].join('\n'), inline: false },
                { name: 'Bot Role', value: `${role} (${roleKey})`, inline: true },
                { name: 'Feature Permissions', value: formatFeaturePermissions(perms), inline: false },
                { name: 'Blocked Commands', value: formatCommandOverrideList(perms.commandOverrides, false), inline: true },
                { name: 'Allowed Overrides', value: formatCommandOverrideList(perms.commandOverrides, true), inline: true },
                { name: 'Profile', value: [
                    `Nickname: ${profile.nickname || 'Not set'}`,
                    `Bio: ${profile.bio ? 'Set' : 'Not set'}`,
                    `Color: ${formatColor(profile.color)}`
                ].join('\n'), inline: true },
                { name: 'Activity', value: [
                    `Messages tracked: ${messageStats.count}`,
                    `Server share: ${formatPercent(messageStats.percentage)}`
                ].join('\n'), inline: true },
                { name: 'AI Memory', value: [
                    `Turns saved: ${memory.turns}`,
                    `Older context: ${memory.summaryChars} chars`,
                    `User profile: ${memory.profileChars} chars`,
                    `Last updated: ${memory.updatedAt || 'Never'}`
                ].join('\n'), inline: false }
            )
            .setFooter({ text: `Server messages tracked total: ${messageStats.totalMessages}` });

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
