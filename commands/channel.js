const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { moduleConfig, sendConfiguredLog } = require('../services/community-management-service');
const store = require('../stores/community-management-store');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder().setName('channel').setDescription('Manage server channels')
        .addSubcommand(command => command.setName('lock').setDescription('Stop members from sending messages here'))
        .addSubcommand(command => command.setName('unlock').setDescription('Allow members to send messages here again'))
        .addSubcommand(command => command.setName('slowmode').setDescription('Set slowmode in this channel').addIntegerOption(option => option.setName('seconds').setDescription('0 disables slowmode').setMinValue(0).setMaxValue(21600)))
        .addSubcommand(command => command.setName('temporary-voice').setDescription('Create a temporary voice room').addStringOption(option => option.setName('name').setDescription('Room name').setRequired(true).setMaxLength(80)).addIntegerOption(option => option.setName('member-limit').setDescription('Maximum members; 0 means unlimited').setMinValue(0).setMaxValue(99))),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'channels');
        if (!config) return interaction.reply({ content: 'Channel Management is not enabled in this server.', flags: MessageFlags.Ephemeral });
        const action = interaction.options.getSubcommand();
        if (action === 'temporary-voice') {
            const channel = await interaction.guild.channels.create({ name: interaction.options.getString('name'), type: ChannelType.GuildVoice, parent: config.temporaryVoiceCategoryId || undefined, userLimit: interaction.options.getInteger('member-limit') || 0, reason: `Temporary room created by ${interaction.user.tag}` });
            store.addTemporaryVoiceChannel(interaction.guildId, channel.id);
            await sendConfiguredLog(interaction.guild, config.logChannelId, `Temporary voice room **${channel.name}** created by <@${interaction.user.id}>.`);
            return interaction.reply({ content: `Created ${channel}. It will be removed automatically after everyone leaves.`, flags: MessageFlags.Ephemeral });
        }
        if (!interaction.channel?.isTextBased() || typeof interaction.channel.setRateLimitPerUser !== 'function') return interaction.reply({ content: 'Use this command in a text channel.', flags: MessageFlags.Ephemeral });
        if (action === 'slowmode') {
            const seconds = interaction.options.getInteger('seconds') ?? config.defaultSlowmodeSeconds;
            await interaction.channel.setRateLimitPerUser(seconds, `Changed by ${interaction.user.tag}`);
            return interaction.reply({ content: seconds ? `Slowmode set to **${seconds} seconds**.` : 'Slowmode disabled.', flags: MessageFlags.Ephemeral });
        }
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: action === 'unlock' ? null : false }, { reason: `Channel ${action} by ${interaction.user.tag}` });
        await sendConfiguredLog(interaction.guild, config.logChannelId, `<#${interaction.channelId}> was ${action}ed by <@${interaction.user.id}>.`);
        return interaction.reply(action === 'lock' ? '🔒 Channel locked.' : '🔓 Channel unlocked.');
    }
};
