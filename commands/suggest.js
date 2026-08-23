const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { isAdmin } = require('../stores/access-store');
const store = require('../stores/community-management-store');
const { moduleConfig } = require('../services/community-management-service');

module.exports = {
    adminSubcommands: ['review'],
    data: new SlashCommandBuilder().setName('suggest').setDescription('Submit and review server suggestions')
        .addSubcommand(command => command.setName('submit').setDescription('Submit a suggestion').addStringOption(option => option.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1500)))
        .addSubcommand(command => command.setName('review').setDescription('Set a suggestion status').addStringOption(option => option.setName('id').setDescription('Suggestion ID').setRequired(true)).addStringOption(option => option.setName('status').setDescription('New status').setRequired(true).addChoices({ name: 'Planned', value: 'planned' }, { name: 'Accepted', value: 'accepted' }, { name: 'Declined', value: 'declined' })).addStringOption(option => option.setName('note').setDescription('Admin response').setMaxLength(500))),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'suggestions');
        if (!config) return interaction.reply({ content: 'Suggestions are not enabled in this server.', flags: MessageFlags.Ephemeral });
        if (interaction.options.getSubcommand() === 'submit') {
            const channel = interaction.guild.channels.cache.get(config.channelId) || await interaction.guild.channels.fetch(config.channelId).catch(() => null);
            if (!channel?.isTextBased()) return interaction.reply({ content: 'An admin needs to select a suggestions channel first.', flags: MessageFlags.Ephemeral });
            const idea = interaction.options.getString('idea');
            const suggestion = store.addSuggestion(interaction.guildId, { authorId: interaction.user.id, channelId: channel.id, idea });
            const embed = new EmbedBuilder().setTitle(`Suggestion ${suggestion.id}`).setDescription(idea).addFields({ name: 'Voting target', value: `${config.minimumApprovalVotes} approval vote(s)` }).setColor(0x7785ff).setFooter({ text: config.anonymous ? 'Submitted anonymously' : `Submitted by ${interaction.user.tag}` }).setTimestamp();
            const posted = await channel.send({ embeds: [embed] });
            await Promise.all([posted.react('👍'), posted.react('👎')]);
            store.updateSuggestion(interaction.guildId, suggestion.id, { messageId: posted.id });
            if (config.reviewChannelId && config.reviewChannelId !== channel.id) {
                const reviewChannel = interaction.guild.channels.cache.get(config.reviewChannelId) || await interaction.guild.channels.fetch(config.reviewChannelId).catch(() => null);
                await reviewChannel?.send({ content: `New suggestion **${suggestion.id}** from <@${interaction.user.id}>`, embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
            }
            return interaction.reply({ content: `Suggestion submitted in <#${channel.id}> as **${suggestion.id}**.`, flags: MessageFlags.Ephemeral });
        }
        if (!isAdmin(interaction.user.id, interaction.guildId, interaction.memberPermissions)) return interaction.reply({ content: 'Only server admins can review suggestions.', flags: MessageFlags.Ephemeral });
        const id = interaction.options.getString('id');
        const status = interaction.options.getString('status');
        const note = interaction.options.getString('note') || '';
        const record = store.updateSuggestion(interaction.guildId, id, { status, note, reviewedBy: interaction.user.id });
        if (!record) return interaction.reply({ content: 'Suggestion not found.', flags: MessageFlags.Ephemeral });
        const channel = await interaction.guild.channels.fetch(record.channelId).catch(() => null);
        const message = await channel?.messages.fetch(record.messageId).catch(() => null);
        if (message?.embeds[0]) {
            const embed = EmbedBuilder.from(message.embeds[0]).setColor(status === 'accepted' ? 0x44bb77 : status === 'planned' ? 0xf5c542 : 0xdd5566).addFields({ name: `Status: ${status}`, value: note || 'No admin note.' });
            await message.edit({ embeds: [embed] });
        }
        return interaction.reply({ content: `Suggestion **${id}** marked **${status}**.`, flags: MessageFlags.Ephemeral });
    }
};
