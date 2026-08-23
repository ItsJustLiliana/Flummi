const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const crypto = require('crypto');
const operationsStore = require('../stores/operations-store');
const { moduleConfig } = require('../services/operations-service');

module.exports = {
    public: true,
    data: new SlashCommandBuilder()
        .setName('community')
        .setDescription('Community reports, reminders, AFK status, and levels')
        .addSubcommand(command => command.setName('report').setDescription('Report something privately to the server staff')
            .addStringOption(option => option.setName('reason').setDescription('What should staff know?').setRequired(true).setMaxLength(1000))
            .addStringOption(option => option.setName('message-link').setDescription('Optional Discord message link').setRequired(false)))
        .addSubcommand(command => command.setName('remind').setDescription('Ask Flummi to remind you here')
            .addIntegerOption(option => option.setName('minutes').setDescription('Minutes from now').setRequired(true).setMinValue(1).setMaxValue(43200))
            .addStringOption(option => option.setName('message').setDescription('Reminder text').setRequired(true).setMaxLength(1000)))
        .addSubcommand(command => command.setName('afk').setDescription('Set your AFK status')
            .addStringOption(option => option.setName('message').setDescription('Why you are away').setRequired(false).setMaxLength(200)))
        .addSubcommand(command => command.setName('rank').setDescription('View a community level')
            .addUserOption(option => option.setName('member').setDescription('Member to view').setRequired(false)))
        .addSubcommand(command => command.setName('pulse').setDescription('Send an anonymous community health rating')
            .addIntegerOption(option => option.setName('rating').setDescription('How is the community doing?').setRequired(true).setMinValue(1).setMaxValue(5))
            .addStringOption(option => option.setName('comment').setDescription('Optional anonymous feedback').setRequired(false).setMaxLength(500))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'report') {
            const config = moduleConfig(interaction.guildId, 'reports');
            if (!config) return interaction.reply({ content: 'Member reports are not enabled in this server.', flags: MessageFlags.Ephemeral });
            if (!config.channelId) return interaction.reply({ content: 'An admin needs to select the staff reports channel first.', flags: MessageFlags.Ephemeral });
            const reason = interaction.options.getString('reason', true);
            const messageLink = interaction.options.getString('message-link') || '';
            if (messageLink && !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/\d+\/\d+\/\d+$/i.test(messageLink)) {
                return interaction.reply({ content: 'That does not look like a Discord message link.', flags: MessageFlags.Ephemeral });
            }
            let messageContext = null;
            if (messageLink && config.includeMessageContext) {
                const [, linkedGuildId, linkedChannelId, linkedMessageId] = messageLink.match(/\/channels\/(\d+)\/(\d+)\/(\d+)$/) || [];
                if (linkedGuildId !== interaction.guildId) return interaction.reply({ content: 'The reported message must be from this server.', flags: MessageFlags.Ephemeral });
                const linkedChannel = interaction.guild.channels.cache.get(linkedChannelId) || await interaction.guild.channels.fetch(linkedChannelId).catch(() => null);
                const linkedMessage = linkedChannel?.isTextBased() ? await linkedChannel.messages.fetch(linkedMessageId).catch(() => null) : null;
                if (linkedMessage) messageContext = { authorId: linkedMessage.author.id, authorTag: linkedMessage.author.tag, channelId: linkedChannelId, content: linkedMessage.content.slice(0, 1000), attachmentUrls: [...linkedMessage.attachments.values()].map(file => file.url).slice(0, 5) };
            }
            const report = operationsStore.addReport(interaction.guildId, { reporterId: interaction.user.id, reason, messageLink, messageContext, anonymous: config.allowAnonymous });
            const channel = interaction.guild.channels.cache.get(config.channelId) || await interaction.guild.channels.fetch(config.channelId).catch(() => null);
            if (!channel?.isTextBased()) return interaction.reply({ content: 'The configured reports channel is unavailable.', flags: MessageFlags.Ephemeral });
            const embed = new EmbedBuilder().setTitle(`Member report ${report.id}`).setDescription(reason).setColor(0xf59e42).setTimestamp();
            embed.addFields({ name: 'Reporter', value: config.allowAnonymous ? 'Anonymous to the public; identity available to staff' : `<@${interaction.user.id}>` });
            if (messageLink) embed.addFields({ name: 'Reported message', value: `[Open message](${messageLink})` });
            if (messageContext) embed.addFields({ name: `Message by ${messageContext.authorTag}`, value: messageContext.content || '*No text content*' });
            await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
            return interaction.reply({ content: `Your report was sent privately as **${report.id}**.`, flags: MessageFlags.Ephemeral });
        }

        if (subcommand === 'pulse') {
            const config = moduleConfig(interaction.guildId, 'communityHealth');
            if (!config?.pulseSurveys) return interaction.reply({ content: 'Community pulse surveys are not open right now.', flags: MessageFlags.Ephemeral });
            const anonymousKey = crypto.createHash('sha256').update(`${interaction.guildId}:${interaction.user.id}`).digest('hex').slice(0, 16);
            const recent = operationsStore.readState(interaction.guildId).pulseResponses.find(entry => entry.anonymousKey === anonymousKey && Date.now() - new Date(entry.createdAt).getTime() < 7 * 86400000);
            if (recent) return interaction.reply({ content: 'You already sent a pulse response in the last seven days.', flags: MessageFlags.Ephemeral });
            operationsStore.addPulseResponse(interaction.guildId, { anonymousKey, rating: interaction.options.getInteger('rating', true), comment: interaction.options.getString('comment') || '' });
            return interaction.reply({ content: 'Thanks — your anonymous community pulse was recorded.', flags: MessageFlags.Ephemeral });
        }
        const engagement = moduleConfig(interaction.guildId, 'engagement');
        if (!engagement) return interaction.reply({ content: 'Engagement & Utilities is not enabled in this server.', flags: MessageFlags.Ephemeral });
        if (subcommand === 'remind') {
            if (!engagement.reminders) return interaction.reply({ content: 'Reminders are turned off in this server.', flags: MessageFlags.Ephemeral });
            const minutes = interaction.options.getInteger('minutes', true);
            operationsStore.addReminder(interaction.guildId, { userId: interaction.user.id, channelId: interaction.channelId, message: interaction.options.getString('message', true), dueAt: new Date(Date.now() + minutes * 60000).toISOString() });
            return interaction.reply({ content: `I’ll remind you here in ${minutes} minute${minutes === 1 ? '' : 's'}.`, flags: MessageFlags.Ephemeral });
        }
        if (subcommand === 'afk') {
            if (!engagement.afk) return interaction.reply({ content: 'AFK statuses are turned off in this server.', flags: MessageFlags.Ephemeral });
            operationsStore.setAfk(interaction.guildId, interaction.user.id, interaction.options.getString('message') || 'Away');
            return interaction.reply({ content: 'Your AFK status is set and will clear when you next send a message.', flags: MessageFlags.Ephemeral });
        }
        if (!engagement.levels) return interaction.reply({ content: 'Levels are turned off in this server.', flags: MessageFlags.Ephemeral });
        const member = interaction.options.getUser('member') || interaction.user;
        const level = operationsStore.readState(interaction.guildId).levels[member.id] || { xp: 0, messages: 0 };
        return interaction.reply({ content: `**${member.username}** is level **${Math.floor(Math.sqrt(level.xp / 25))}** with ${level.xp} XP from ${level.messages} messages.` });
    }
};
