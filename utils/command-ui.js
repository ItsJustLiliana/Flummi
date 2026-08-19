const { EmbedBuilder } = require('discord.js');

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
        .setFooter({ text: footer || `/${interaction.commandName} • Flummi` });

    if (description) embed.setDescription(description);
    return embed;
}

module.exports = { COLORS, createCommandEmbed };
