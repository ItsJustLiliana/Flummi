const { MessageFlags, SlashCommandBuilder } = require('discord.js');

const allowedGuildIds = ['752562837284716665'];

module.exports = {
    allowedGuildIds,

    data: new SlashCommandBuilder()
        .setName('tree')
        .setDescription('Shows the family tree'),

    async execute(interaction) {
        if (!allowedGuildIds.includes(interaction.guildId)) {
            await interaction.reply({
                content: 'This command is not available in this server.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.reply('https://cdn.discordapp.com/attachments/741942065956651020/1513969735208014085/image.png?ex=6a29a9b1&is=6a285831&hm=86b9e13bf9a62e55b1eba9df413e26a3f7204ab7f7ead5737641dc20979ca582&');
    }
};
