const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getUserRole } = require('../stores/access-store');
const { getShots } = require('../stores/shot-store');
const { getUserMessageStats } = require('../stores/server-stats-store');
const {
    clearProfileField,
    formatColor,
    formatLanguages,
    getProfile,
    normalizeColor,
    normalizeLanguages,
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
                    `Birthday: ${formatOptional(profile.birthday)}`,
                    `Timezone: ${formatOptional(profile.timezone)}`,
                    `Languages: ${formatLanguages(profile.languages)}`,
                    `Website: ${profile.website || 'Not set'}`
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
                    `Banner: ${profile.bannerUrl ? 'Set' : 'Not set'}`
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
        ['birthday', 20],
        ['timezone', 40]
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

    const languagesInput = interaction.options.getString('languages');

    if (languagesInput !== null) {
        updates.languages = normalizeLanguages(languagesInput);
    }

    return updates;
}

function getClearFields(interaction) {
    const fields = [
        ['nickname', 'nickname'],
        ['bio', 'bio'],
        ['pronouns', 'pronouns'],
        ['birthday', 'birthday'],
        ['timezone', 'timezone'],
        ['languages', 'languages'],
        ['website', 'website'],
        ['banner-url', 'banner'],
        ['color', 'color'],
        ['socials', 'socials']
    ];

    return fields
        .filter(([optionName]) => interaction.options.getBoolean(optionName) === true)
        .map(([, field]) => field);
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
        .setDescription('View your profile')
        .addSubcommand(subcommand =>
            subcommand
                .setName('view')
                .setDescription('View the profile from a specific user')
                .addUserOption(option =>
                    option.setName('user').setDescription('Profile owner').setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Update part of your profile')
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
                    option.setName('birthday').setDescription('Birthday, for example 17-06 or 2006-06-17').setMaxLength(20).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('timezone').setDescription('Timezone, for example UTC+2 or Europe/Amsterdam').setMaxLength(40).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('languages').setDescription('Comma-separated languages, for example Dutch, English, Japanese').setMaxLength(300).setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('website').setDescription('Website URL').setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('banner-url').setDescription('Image URL shown as your profile banner').setRequired(false)
                )
                .addStringOption(option =>
                    option.setName('color').setDescription('Hex color, for example #1E88E5').setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('social-platform')
                        .setDescription('Social platform to add/update')
                        .setRequired(false)
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
                    option.setName('social-handle').setDescription('Handle, username, or URL').setMaxLength(80).setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Clear part of your profile')
                .addBooleanOption(option =>
                    option.setName('nickname').setDescription('Clear profile nickname').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('bio').setDescription('Clear profile bio').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('pronouns').setDescription('Clear pronouns').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('birthday').setDescription('Clear birthday').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('timezone').setDescription('Clear timezone').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('languages').setDescription('Clear languages').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('website').setDescription('Clear website').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('banner-url').setDescription('Clear banner image').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('color').setDescription('Reset profile color').setRequired(false)
                )
                .addBooleanOption(option =>
                    option.setName('socials').setDescription('Clear all socials').setRequired(false)
                )
                .addStringOption(option =>
                    option
                        .setName('social-platform')
                        .setDescription('Clear one social platform')
                        .setRequired(false)
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

            const colorInput = interaction.options.getString('color');

            if (colorInput !== null) {
                const color = normalizeColor(colorInput);

                if (color === null) {
                    return interaction.reply({
                        content: 'Use a valid 6-digit hex color, for example #1E88E5.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                updates.color = color;
            }

            const socialPlatform = interaction.options.getString('social-platform');
            const socialHandle = interaction.options.getString('social-handle');

            if ((socialPlatform && !socialHandle) || (!socialPlatform && socialHandle)) {
                return interaction.reply({
                    content: 'Use both social-platform and social-handle to update a social.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (Object.keys(updates).length > 0) {
                updateProfile(interaction.user.id, interaction.guildId, updates);
            }

            if (socialPlatform && socialHandle) {
                setProfileSocial(interaction.user.id, interaction.guildId, socialPlatform, socialHandle);
            }

            if (Object.keys(updates).length === 0 && !socialPlatform) {
                return interaction.reply({
                    content: 'Add at least one profile field to update.',
                    flags: MessageFlags.Ephemeral
                });
            }

            return replyWithProfile(interaction, interaction.user, 'Profile updated.');
        }

        if (subcommand === 'clear') {
            const fields = getClearFields(interaction);
            const socialPlatform = interaction.options.getString('social-platform');

            if (fields.length === 0 && !socialPlatform) {
                return interaction.reply({
                    content: 'Choose at least one profile field to clear.',
                    flags: MessageFlags.Ephemeral
                });
            }

            for (const field of fields) {
                clearProfileField(interaction.user.id, interaction.guildId, field);
            }

            if (socialPlatform) {
                setProfileSocial(interaction.user.id, interaction.guildId, socialPlatform, null);
            }

            const cleared = [
                ...fields,
                socialPlatform ? `${socialPlatform} social` : null
            ].filter(Boolean);

            return replyWithProfile(interaction, interaction.user, `Cleared ${cleared.join(', ')}.`);
        }

        return interaction.reply({
            content: 'Unknown profile action.',
            flags: MessageFlags.Ephemeral
        });
    }
};
