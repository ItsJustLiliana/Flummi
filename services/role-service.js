const { ActionRowBuilder, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { readSettings } = require('../stores/settings-store');
const { saveMemberRoles, takeMemberRoles } = require('../stores/role-persistence-store');
const { renderTemplate } = require('./moderation-service');

function allowedRoles(guild, roleIds) {
    const botPosition = guild.members.me?.roles.highest.position || 0;
    return roleIds.map(id => guild.roles.cache.get(id)).filter(role => role && !role.managed && role.position < botPosition);
}

async function sendTemplate(guild, channelId, template, member) {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return false;
    const content = renderTemplate(template, { userMention: `<@${member.id}>`, username: member.user.username, serverName: guild.name });
    await channel.send({ content, allowedMentions: { users: [member.id] } });
    return true;
}

async function handleMemberAdd(member) {
    const settings = readSettings(member.guild.id).management;
    if (settings.modules.roles) {
        const roleIds = [];
        if (settings.roles.persistRoles) roleIds.push(...(takeMemberRoles(member.guild.id, member.id)?.roleIds || []));
        if (settings.roles.autoroleId) roleIds.push(settings.roles.autoroleId);
        const roles = allowedRoles(member.guild, [...new Set(roleIds)]);
        if (roles.length) {
            const delay = settings.roles.autoroleDelayMinutes * 60000;
            setTimeout(() => member.roles.add(roles, 'Flummi onboarding roles').catch(error => console.warn(`Could not assign onboarding roles: ${error.message}`)), delay).unref();
        }
    }
    if (settings.modules.automation && settings.automation.welcomeEnabled && settings.automation.welcomeChannelId) {
        await sendTemplate(member.guild, settings.automation.welcomeChannelId, settings.automation.welcomeMessage, member).catch(() => false);
    }
}

async function handleMemberRemove(member) {
    const settings = readSettings(member.guild.id).management;
    if (settings.modules.roles && settings.roles.persistRoles) {
        const allowlist = new Set([settings.roles.autoroleId, ...settings.roles.selfAssignableRoleIds].filter(Boolean));
        saveMemberRoles(member.guild.id, member.id, member.roles.cache.filter(role => allowlist.has(role.id)).map(role => role.id));
    }
    if (settings.modules.automation && settings.automation.goodbyeEnabled && settings.automation.goodbyeChannelId) {
        await sendTemplate(member.guild, settings.automation.goodbyeChannelId, settings.automation.goodbyeMessage, member).catch(() => false);
    }
}

async function publishRoleMenu(guild) {
    const settings = readSettings(guild.id).management;
    if (!settings.modules.roles || !settings.roles.interactiveRoles) throw new Error('Interactive Roles is disabled.');
    const roles = allowedRoles(guild, settings.roles.selfAssignableRoleIds).slice(0, 25);
    if (!roles.length) throw new Error('Configure at least one assignable role below Flummi’s role.');
    const channel = guild.channels.cache.get(settings.roles.onboardingChannelId) || await guild.channels.fetch(settings.roles.onboardingChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error('Choose a valid onboarding text channel.');
    const menu = new StringSelectMenuBuilder().setCustomId('flummi:self-roles').setPlaceholder('Choose your roles').setMinValues(0).setMaxValues(roles.length)
        .addOptions(roles.map(role => ({ label: role.name.slice(0, 100), value: role.id, description: `Toggle ${role.name}`.slice(0, 100) })));
    return channel.send({ embeds: [new EmbedBuilder().setTitle(settings.roles.onboardingTitle).setDescription(settings.roles.onboardingMessage).setColor(0x75cfff)], components: [new ActionRowBuilder().addComponents(menu)] });
}

async function handleRoleSelect(interaction) {
    if (interaction.customId !== 'flummi:self-roles') return false;
    const settings = readSettings(interaction.guildId).management;
    if (!settings.modules.roles || !settings.roles.interactiveRoles) {
        await interaction.reply({ content: 'Self-assignable roles are currently disabled.', flags: MessageFlags.Ephemeral });
        return true;
    }
    const allowed = allowedRoles(interaction.guild, settings.roles.selfAssignableRoleIds);
    const selected = new Set(interaction.values);
    const add = allowed.filter(role => selected.has(role.id) && !interaction.member.roles.cache.has(role.id));
    const remove = allowed.filter(role => !selected.has(role.id) && interaction.member.roles.cache.has(role.id));
    if (add.length) await interaction.member.roles.add(add, 'Self-assignable role menu');
    if (remove.length) await interaction.member.roles.remove(remove, 'Self-assignable role menu');
    await interaction.reply({ content: `Roles updated (${add.length} added, ${remove.length} removed).`, flags: MessageFlags.Ephemeral });
    return true;
}

module.exports = { handleMemberAdd, handleMemberRemove, publishRoleMenu, handleRoleSelect, allowedRoles };
