const { SlashCommandBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const { moduleConfig } = require('../services/community-management-service');

module.exports = {
    data: new SlashCommandBuilder().setName('form').setDescription('Send an application or moderation appeal')
        .addSubcommand(command => command.setName('apply').setDescription('Open the server application form'))
        .addSubcommand(command => command.setName('appeal').setDescription('Open a moderation appeal form')),
    async execute(interaction) {
        const config = moduleConfig(interaction.guildId, 'forms');
        if (!config) return interaction.reply({ content: 'Forms & Appeals are not enabled in this server.', flags: MessageFlags.Ephemeral });
        const type = interaction.options.getSubcommand();
        if (type === 'appeal' && !config.appealsEnabled) return interaction.reply({ content: 'Appeals are not currently accepted.', flags: MessageFlags.Ephemeral });
        const modal = new ModalBuilder().setCustomId(`community-form:${type}`).setTitle(type === 'appeal' ? 'Moderation appeal' : config.applicationTitle);
        const prompts = type === 'appeal' ? ['What action are you appealing?', 'Why should it be reconsidered?'] : config.applicationQuestions;
        prompts.slice(0, 5).forEach((prompt, index) => modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(`answer-${index}`).setLabel(prompt.slice(0, 45)).setPlaceholder(prompt.slice(0, 100)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000))));
        return interaction.showModal(modal);
    }
};
