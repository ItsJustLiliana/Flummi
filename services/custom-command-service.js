const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const store = require('../stores/custom-command-store');
const cooldowns = new Map();

async function syncCommand(guild, command) {
    const existing = guild.commands.cache.find(item => item.name === command.name) || (await guild.commands.fetch()).find(item => item.name === command.name);
    const data = { name: command.name, description: command.description };
    return existing ? existing.edit(data) : guild.commands.create(data);
}
async function removeSyncedCommand(guild, name) { const commands = await guild.commands.fetch(); const existing = commands.find(item => item.name === name); if (existing) await existing.delete(); }

async function executeCustomCommand(interaction) {
    const command = store.getCommand(interaction.guildId, interaction.commandName);
    if (!command) return false;
    if (!command.enabled) { await interaction.reply({ content: 'This custom command is disabled.', flags: MessageFlags.Ephemeral }); return true; }
    if (command.requiredRoleId && !interaction.member?.roles?.cache?.has(command.requiredRoleId)) { await interaction.reply({ content: 'You do not have the required role.', flags: MessageFlags.Ephemeral }); return true; }
    if (command.allowedChannelIds.length && !command.allowedChannelIds.includes(interaction.channelId)) { await interaction.reply({ content: 'This command is not allowed in this channel.', flags: MessageFlags.Ephemeral }); return true; }
    const key = `${interaction.guildId}:${command.name}:${interaction.user.id}`;
    const remaining = (cooldowns.get(key) || 0) - Date.now();
    if (remaining > 0) { await interaction.reply({ content: `Try again in ${Math.ceil(remaining / 1000)} seconds.`, flags: MessageFlags.Ephemeral }); return true; }
    if (command.cooldownSeconds) cooldowns.set(key, Date.now() + command.cooldownSeconds * 1000);
    const payload = { allowedMentions: { parse: [] }, flags: command.ephemeral ? MessageFlags.Ephemeral : undefined };
    if (command.responseType === 'embed') { const embed = new EmbedBuilder().setDescription(command.content || ' ').setColor(0x7785ff); if (command.imageUrl) embed.setImage(command.imageUrl); payload.embeds = [embed]; }
    else payload.content = command.content || ' '; 
    if (command.buttons.length) payload.components = [new ActionRowBuilder().addComponents(command.buttons.map(button => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(button.label).setURL(button.url)))];
    await interaction.reply(payload);
    return true;
}
module.exports = { executeCustomCommand, removeSyncedCommand, syncCommand };
