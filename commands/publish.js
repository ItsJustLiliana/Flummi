const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder().setName('publish').setDescription('Publish an announcement with the webhook builder').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(o => o.setName('channel').setDescription('Destination channel').setRequired(true))
        .addStringOption(o => o.setName('description').setDescription('Announcement body').setRequired(true).setMaxLength(4000))
        .addStringOption(o => o.setName('title').setDescription('Embed title').setMaxLength(256))
        .addStringOption(o => o.setName('username').setDescription('Webhook display name').setMaxLength(80))
        .addStringOption(o => o.setName('avatar').setDescription('Webhook avatar URL'))
        .addStringOption(o => o.setName('image').setDescription('Large image URL'))
        .addStringOption(o => o.setName('thumbnail').setDescription('Thumbnail URL'))
        .addStringOption(o => o.setName('fields').setDescription('JSON array of {name,value,inline}'))
        .addStringOption(o => o.setName('buttons').setDescription('JSON array of {label,url}'))
        .addRoleOption(o => o.setName('mention').setDescription('Role to mention'))
        .addBooleanOption(o => o.setName('timestamp').setDescription('Show current timestamp')),
    async execute(interaction) {
        const channel = interaction.options.getChannel('channel', true);
        if (!channel?.isTextBased() || !channel.createWebhook) return interaction.reply({ content: 'Choose a webhook-capable text channel.', flags: MessageFlags.Ephemeral });
        let fields = [], buttons = [];
        try { fields = JSON.parse(interaction.options.getString('fields') || '[]'); buttons = JSON.parse(interaction.options.getString('buttons') || '[]'); } catch { return interaction.reply({ content: 'Fields and buttons must be valid JSON arrays.', flags: MessageFlags.Ephemeral }); }
        const embed = new EmbedBuilder().setDescription(interaction.options.getString('description', true)).setColor(0x7785ff);
        const title = interaction.options.getString('title'); if (title) embed.setTitle(title);
        const image = interaction.options.getString('image'); if (image) embed.setImage(image);
        const thumbnail = interaction.options.getString('thumbnail'); if (thumbnail) embed.setThumbnail(thumbnail);
        if (interaction.options.getBoolean('timestamp')) embed.setTimestamp();
        if (Array.isArray(fields) && fields.length) embed.addFields(fields.slice(0, 25).map(field => ({ name: String(field.name || 'Field').slice(0, 256), value: String(field.value || '-').slice(0, 1024), inline: Boolean(field.inline) })));
        const validButtons = Array.isArray(buttons) ? buttons.slice(0, 5).filter(button => /^https?:\/\//i.test(button.url || '')) : [];
        const components = validButtons.length ? [new ActionRowBuilder().addComponents(validButtons.map(button => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(String(button.label || 'Open').slice(0, 80)).setURL(button.url)))] : [];
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const hooks = await channel.fetchWebhooks();
        const webhook = hooks.find(hook => hook.owner?.id === interaction.client.user.id && hook.name === 'Flummi Publisher') || await channel.createWebhook({ name: 'Flummi Publisher', reason: `Announcement builder used by ${interaction.user.tag}` });
        const mention = interaction.options.getRole('mention');
        await webhook.send({ username: interaction.options.getString('username') || 'Flummi', avatarURL: interaction.options.getString('avatar') || undefined, content: mention ? `<@&${mention.id}>` : undefined, embeds: [embed], components, allowedMentions: mention ? { roles: [mention.id] } : { parse: [] } });
        return interaction.editReply(`Published in <#${channel.id}>.`);
    }
};
