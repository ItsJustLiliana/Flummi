const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCommandEmbed } = require('../utils/command-ui');
const { getUserPermissions, getUserRole, isDeveloper, isAdmin } = require('../stores/access-store');
const { readSettings } = require('../stores/settings-store');
const { readConfig } = require('../utils/config');

function featureEnabled(source, key) {
    return source?.[key] !== false;
}

function formatFeature(name, checks) {
    const blocked = checks.find(check => !check.enabled);

    if (!blocked) {
        return `🟢 **${name}** — Running`;
    }

    return `${blocked.state === 'stopped' ? '🔴' : '🟡'} **${name}** — ${blocked.state === 'stopped' ? 'Stopped' : 'Disabled'}\n> ${blocked.reason}`;
}

function botRunningCheck(settings) {
    return {
        enabled: settings.botEnabled !== false,
        state: 'stopped',
        reason: 'The bot is disabled for this server.'
    };
}

function globalFeatureCheck(config, key) {
    return {
        enabled: featureEnabled(config.features, key),
        state: 'stopped',
        reason: 'Disabled globally by the developer.'
    };
}

function guildFeatureCheck(settings, key) {
    return {
        enabled: featureEnabled(settings.features, key),
        state: 'disabled',
        reason: 'Disabled in this server’s settings.'
    };
}

function userAccessCheck(enabled) {
    return {
        enabled,
        state: 'disabled',
        reason: 'Your access to this feature is turned off.'
    };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Show the Flummi features available to you'),

    async execute(interaction) {
        const guildId = interaction.guildId;
        const config = readConfig();
        const settings = readSettings(guildId);
        const permissions = getUserPermissions(interaction.user.id, guildId);
        const developer = isDeveloper(interaction.user.id);
        const admin = isAdmin(interaction.user.id, guildId, interaction.memberPermissions);
        const role = getUserRole(interaction.user.id, guildId, interaction.memberPermissions);
        const discordConnected = interaction.client.isReady();
        const gatewayLatency = Number.isFinite(interaction.client.ws.ping)
            ? Math.max(0, Math.round(interaction.client.ws.ping))
            : null;
        const serverName = interaction.guild?.name || 'Current server';
        const memberCount = Number.isFinite(interaction.guild?.memberCount)
            ? interaction.guild.memberCount.toLocaleString('en-US')
            : 'Unknown';
        const base = [botRunningCheck(settings)];
        const triggerChecks = [
            ...base,
            globalFeatureCheck(config, 'triggersEnabled'),
            { enabled: settings.triggersEnabled !== false, state: 'disabled', reason: 'Triggers are disabled for this server.' },
            userAccessCheck(permissions.useTriggers)
        ];

        const memberFeatures = [
            formatFeature('Normal triggers', triggerChecks),
            formatFeature('AI conversations', [...base, globalFeatureCheck(config, 'aiConversationsEnabled'), guildFeatureCheck(settings, 'aiConversationsEnabled'), userAccessCheck(permissions.useAiChat)]),
            formatFeature('@bot responses', [...base, globalFeatureCheck(config, 'aiConversationsEnabled'), globalFeatureCheck(config, 'pingResponsesEnabled'), guildFeatureCheck(settings, 'aiConversationsEnabled'), guildFeatureCheck(settings, 'pingResponsesEnabled'), userAccessCheck(permissions.useAiChat), userAccessCheck(permissions.useBotMentions)]),
            formatFeature('Ping request saving', [...base, globalFeatureCheck(config, 'pingRequestSaveEnabled'), guildFeatureCheck(settings, 'pingRequestSaveEnabled'), userAccessCheck(permissions.savePingRequests)])
        ];

        const embed = createCommandEmbed(interaction, {
            title: 'Your Flummi Status',
            description: settings.botEnabled !== false
                ? 'Only features relevant to your access level are shown.'
                : 'Flummi is currently disabled for this server. Status remains available to help diagnose it.',
            tone: developer ? 'danger' : admin ? 'staff' : 'primary',
            footer: 'Flummi • Live configuration status'
        })
            .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
            .addFields(
                { name: 'Your role', value: role[0].toUpperCase() + role.slice(1), inline: true },
                { name: 'Server', value: serverName, inline: true },
                {
                    name: 'Server status',
                    value: [
                        `${settings.botEnabled !== false ? '🟢' : '🔴'} **Flummi** — ${settings.botEnabled !== false ? 'Enabled' : 'Paused for this server'}`,
                        `${discordConnected ? '🟢' : '🔴'} **Discord connection** — ${discordConnected ? 'Connected' : 'Connecting'}`,
                        `📡 **Gateway latency** — ${gatewayLatency === null ? 'Unavailable' : `${gatewayLatency} ms`}`,
                        `👥 **Members** — ${memberCount}`
                    ].join('\n'),
                    inline: false
                }
            )
            .addFields({ name: 'Member features', value: memberFeatures.join('\n\n'), inline: false });

        if (admin) {
            embed.addFields({
                name: 'Admin services',
                value: [
                    formatFeature('Trigger management', [...triggerChecks.slice(0, 3), userAccessCheck(permissions.addTriggers)]),
                    formatFeature('Server analytics', base),
                    formatFeature('Voice analytics', base),
                    '🟢 **Member permissions** — Running'
                ].join('\n\n'),
                inline: false
            });
        }

        if (developer) {
            embed.addFields({
                name: 'Developer services',
                value: [
                    `🟢 **Global feature controls** — Running`,
                    `🟢 **Panel and bot configuration** — Running`,
                    `🟢 **Update and reliability controls** — Running`
                ].join('\n'),
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
