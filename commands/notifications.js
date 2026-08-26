const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const store = require('../stores/notification-store');

module.exports = {
    public: true,
    data: new SlashCommandBuilder().setName('notifications').setDescription('View your Flummi notification inbox')
        .addSubcommand(command => command.setName('list').setDescription('Show your latest notifications'))
        .addSubcommand(command => command.setName('read').setDescription('Mark a notification as read').addStringOption(option => option.setName('id').setDescription('Notification ID; omit to mark all read'))),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === 'read') {
            const id = interaction.options.getString('id');
            store.markRead(interaction.user.id, id);
            return interaction.reply({ content: id ? `Marked **${id}** as read.` : 'Marked all notifications as read.', flags: MessageFlags.Ephemeral });
        }
        const rows = store.readNotifications(interaction.user.id).slice(0, 10);
        const embed = new EmbedBuilder().setTitle('Your notifications').setColor(0x7785ff)
            .setDescription(rows.length ? rows.map(row => `${row.readAt ? 'â—‹' : 'â—'} **${row.title}**\n${row.message}\n\`${row.id}\` â€¢ <t:${Math.floor(new Date(row.createdAt).getTime() / 1000)}:R>`).join('\n\n') : 'Your inbox is empty.');
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
};
