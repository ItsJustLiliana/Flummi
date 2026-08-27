const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const COLORS = {
    primary: 0x5865F2,
    success: 0x40D981,
    warning: 0xFFBF5B,
    danger: 0xFF4D6D,
    staff: 0x75CFFF
};

function createCommandEmbed(interaction, { title, description = null, tone = 'primary', footer = null }) {
    const avatarUrl = interaction.client?.user?.displayAvatarURL?.({ size: 128 });
    const embed = new EmbedBuilder()
        .setColor(COLORS[tone] || COLORS.primary)
        .setAuthor({ name: 'Flummi', iconURL: avatarUrl })
        .setTitle(title)
        .setTimestamp()
        .setFooter({ text: footer || `/${interaction.commandName || 'flummi'} • Flummi` });

    if (description) embed.setDescription(description);
    return embed;
}

function createLinkRow(links) {
    return new ActionRowBuilder().addComponents(links.slice(0, 5).map(link => new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(String(link.label).slice(0, 80))
        .setURL(link.url)));
}

module.exports = { COLORS, createCommandEmbed, createLinkRow };
