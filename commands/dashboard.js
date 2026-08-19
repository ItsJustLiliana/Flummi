const http = require('http');
const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isDeveloper } = require('../stores/access-store');

const panelHost = '100.111.62.126';
const panelPort = 3789;
const panelUrl = `http://${panelHost}:${panelPort}`;

function isPanelRunning() {
    return new Promise(resolve => {
        const request = http.get(panelUrl, response => {
            response.resume();
            resolve(true);
        });

        request.setTimeout(1500, () => {
            request.destroy();
            resolve(false);
        });

        request.on('error', () => resolve(false));
    });
}

module.exports = {
    devOnly: true,

    data: new SlashCommandBuilder()
        .setName('dashboard')
        .setDescription('[Dev] Open the local admin dashboard in your browser'),

    async execute(interaction) {
        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: 'Only developers can open the dashboard.',
                flags: MessageFlags.Ephemeral
            });
        }

        const running = await isPanelRunning();

        if (!running) {
            return interaction.reply({
                content: `The admin panel isn't running yet. Start it with \`npm run panel\` on the machine hosting the bot, then run this command again.\nURL: ${panelUrl}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const targetUrl = interaction.guildId
            ? `${panelUrl}/?guildId=${interaction.guildId}`
            : panelUrl;

        return interaction.reply({
            content: `Admin dashboard: ${targetUrl}`,
            flags: MessageFlags.Ephemeral
        });
    }
};
