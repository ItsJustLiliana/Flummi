const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getUserRole } = require('../stores/access-store');
const { getShots } = require('../stores/shot-store');
const { getUserMessageStats } = require('../stores/server-stats-store');
const {
    clearProfileField,
    formatColor,
    getProfile,
    normalizeColor,
    normalizeText,
    normalizeUrl,
    setProfileSocial,
    updateProfile
} = require('../stores/profile-store');

function formatDiscordTimestamp(date, style = 'R') {
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

function formatOptional(value, fallback = 'Not set') {
    return value || fallback;
}

function formatSocials(socials) {
    const rows = Object.entries(socials || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([platform, handle]) => `${platform}: ${handle}`);

    return rows.length ? rows.join('\n') : 'No socials added.';
}

function getAutomaticBadges({ targetUser, roleKey, messageStats, shots, profile }) {
    const badges = [];

    if (targetUser.bot) badges.push('Bot Account');
    if (roleKey === 'developer') badges.push('Developer');
    if (roleKey === 'manager') badges.push('Manager');
    if (messageStats.count >= 1000) badges.push('Server Regular');
    if (messageStats.count >= 100) badges.push('Active Chatter');
    if (shots >= 100) badges.push('Shot Legend');
    if (shots >= 25) badges.push('Shot Collector');
    if (profile.bio) badges.push('Bio Writer');
    if (Object.keys(profile.socials || {}).length >= 2) badges.push('Social');
    if (profile.bannerUrl) badges.push('Banner Owner');

    return Array.from(new Set(badges)).slice(0, 8);
}

async function buildProfileEmbed(interaction, targetUser) {
    const guildId = interaction.guildId;
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const profile = getProfile(targetUser.id, guildId);
    const roleKey = getUserRole(targetUser.id, guildId);
    const messageStats = getUserMessageStats(guildId, targetUser.id);
    const shots = getShots(targetUser.id, guildId);
    const badges = getAutomaticBadges({ targetUser, roleKey, messageStats, shots, profile });
    const displayName = profile.nickname || member?.displayName || targetUser.username;

    const embed = new EmbedBuilder()
        .setTitle(displayName)
        .setColor(profile.color)
        .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
        .setDescription(profile.bio || 'No bio yet. Use `/profile set bio:` to add one.')
        .addFields(
            {
                name: 'About',
                value: [
                    `Pronouns: ${formatOptional(profile.pronouns)}`,
                    `Location: ${formatOptional(profile.location)}`,
                    `Mood: ${formatOptional(profile.mood)}`,
                    `Favorite: ${formatOptional(profile.favorite)}`
                ].join('\n'),
                inline: false
            },
            {
                name: 'Stats',
                value: [
                    `Messages: ${messageStats.count}`,
                    `Server share: ${formatPercent(messageStats.percentage)}`,
                    `Shots: ${shots}`,
                    `Role: ${roleKey}`
                ].join('\n'),
                inline: true
            },
            {
                name: 'Style',
                value: [
                    `Color: ${formatColor(profile.color)}`,
                    `Website: ${profile.website || 'Not set'}`
                ].join('\n'),
                inline: true
            },
            {
                name: 'Badges',
                value: badges.length ? badges.join('\n') : 'No badges yet.',
                inline: true
            },
            {
                name: 'Socials',
                value: formatSocials(profile.socials),
                inline: false
            }
        )
        .setFooter({
            text: profile.updatedAt
                ? `Last updated: ${profile.updatedAt}`
                : `Account created ${formatDiscordTimestamp(targetUser.createdAt)}`
        });

    if (profile.bannerUrl) {
        embed.setImage(profile.bannerUrl);
    }

    if (profile.website) {
        embed.setURL(profile.website);
    }

    return embed;
}

function getSetUpdates(interaction) {
    const bannerInput = interaction.options.getString('banner-url');
    const websiteInput = interaction.options.getString('website');
    const updates = {};

    const textFields = [
        ['nickname', 80],
        ['bio', 500],
        ['pronouns', 80],
        ['location', 80],
        ['mood', 80],
        ['favorite', 80]
    ];

    for (const [field, maxLength] of textFields) {
        const value = interaction.options.getString(field);

        if (value !== null) {
            updates[field] = normalizeText(value, maxLength);
        }
    }

    if (bannerInput !== null) {
        const bannerUrl = normalizeUrl(bannerInput);

        if (!bannerUrl) {
            throw new Error('Banner URL must be a valid http or https URL.');
        }

        updates.bannerUrl = bannerUrl;
    }

    if (websiteInput !== null) {
        const website = normalizeUrl(websiteInput);

        if (!website) {
            throw new Error('Website must be a valid http or https URL.');
        }

        updates.website = website;
    }

    return updates;
}

async function replyWithProfile(interaction, targetUser, content = null) {
    const embed = await buildProfileEmbed(interaction, targetUser);
    const payload = {
        embeds: [embed]
    };

    if (content) {
        payload.content = content;
        payload.flags = MessageFlags.Ephemeral;
    }

    return interaction.reply(payload);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View and customize global profiles')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View a profile')
                .addUserOption(option =>
                    option.setName('user').setDescription('Profile owner').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Update your profile details')
                .addStringOption(option =>
                    option.setName('nickname').setDescription('Profile display name').setMaxLength(80).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('bio').setDescription('Short profile bio').setMaxLength(500).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('pronouns').setDescription('Pronouns').setMaxLength(80).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('location').setDescription('Location or timezone').setMaxLength(80).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('mood').setDescription('Current mood/status').setMaxLength(80).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('favorite').setDescription('Favorite thing, quote, game, artist, etc.').setMaxLength(80).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('website').setDescription('Website URL').setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('banner-url').setDescription('Image URL shown as your profile banner').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('color')
                .setDescription('Set your profile accent color')
                .addStringOption(option =>
                    option.setName('hex').setDescription('Hex color, for example #1E88E5').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('social')
                .setDescription('Add or update a social link/handle')
                .addStringOption(option =>
                    option
                        .setName('platform')
                        .setDescription('Social platform')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Instagram', value: 'instagram' },
                            { name: 'TikTok', value: 'tiktok' },
                            { name: 'Twitch', value: 'twitch' },
                            { name: 'YouTube', value: 'youtube' },
                            { name: 'GitHub', value: 'github' },
                            { name: 'X/Twitter', value: 'x' },
                            { name: 'Discord', value: 'discord' },
                            { name: 'Website', value: 'website' }
                        )
                )
                .addStringOption(option =>
                    option.setName('handle').setDescription('Handle, username, or URL. Leave empty via clear to remove.').setMaxLength(80).setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear part of your profile')
                .addStringOption(option =>
                    option
                        .setName('field')
                        .setDescription('Profile field to clear')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Nickname', value: 'nickname' },
                            { name: 'Bio', value: 'bio' },
                            { name: 'Pronouns', value: 'pronouns' },
                            { name: 'Location', value: 'location' },
                            { name: 'Mood', value: 'mood' },
                            { name: 'Favorite', value: 'favorite' },
                            { name: 'Website', value: 'website' },
                            { name: 'Banner', value: 'banner' },
                            { name: 'Color', value: 'color' },
                            { name: 'Socials', value: 'socials' }
                        )
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            const targetUser = interaction.options.getUser('user') || interaction.user;
            return replyWithProfile(interaction, targetUser);
        }

        if (subcommand === 'set') {
            let updates;

            try {
                updates = getSetUpdates(interaction);
            } catch (error) {
                return interaction.reply({
                    content: error.message,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (Object.keys(updates).length === 0) {
                return interaction.reply({
                    content: 'Add at least one profile field to update.',
                    flags: MessageFlags.Ephemeral
                });
            }

            updateProfile(interaction.user.id, interaction.guildId, updates);
            return replyWithProfile(interaction, interaction.user, 'Profile updated.');
        }

        if (subcommand === 'color') {
            const color = normalizeColor(interaction.options.getString('hex'));

            if (color === null) {
                return interaction.reply({
                    content: 'Use a valid 6-digit hex color, for example #1E88E5.',
                    flags: MessageFlags.Ephemeral
                });
            }

            updateProfile(interaction.user.id, interaction.guildId, { color });
            return replyWithProfile(interaction, interaction.user, `Profile color set to ${formatColor(color)}.`);
        }

        if (subcommand === 'social') {
            const platform = interaction.options.getString('platform');
            const handle = interaction.options.getString('handle');

            setProfileSocial(interaction.user.id, interaction.guildId, platform, handle);
            return replyWithProfile(interaction, interaction.user, `Updated ${platform}.`);
        }

        if (subcommand === 'clear') {
            const field = interaction.options.getString('field');

            clearProfileField(interaction.user.id, interaction.guildId, field);
            return replyWithProfile(interaction, interaction.user, `Cleared ${field}.`);
        }

        return interaction.reply({
            content: 'Unknown profile action.',
            flags: MessageFlags.Ephemeral
        });
    }
};
