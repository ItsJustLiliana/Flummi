const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAiConsent, setAiConsent } = require('../stores/ai-consent-store');

const disclosure = '**AI privacy choice**\nIf you enable AI, Flummi sends your prompt, supported attachments, recent AI conversation context, and any profile information you explicitly entered to OpenRouter and a downstream model provider to generate a reply. Flummi enforces zero data retention and denies provider data collection. Discord account, server, and channel IDs are not sent. Flummi still stores its local conversation memory until you use `/resetmemory` or `/data delete`. Nothing is sent to AI until you agree.';

function consentButtons(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai-consent:allow:${userId}`).setLabel('Enable AI').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ai-consent:decline:${userId}`).setLabel('Keep AI off').setStyle(ButtonStyle.Secondary)
    );
}
async function promptForAiConsent(message) {
    return message.reply({ content: disclosure, components: [consentButtons(message.author.id)], allowedMentions: { repliedUser: false } });
}
async function handleAiConsentInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId.startsWith('ai-consent:')) return false;
    const [, action, userId] = interaction.customId.split(':');
    if (interaction.user.id !== userId) { await interaction.reply({ content: 'This AI privacy choice belongs to another user.', flags: MessageFlags.Ephemeral }); return true; }
    const granted = action === 'allow';
    setAiConsent(userId, granted);
    await interaction.update({ content: granted ? 'AI is enabled. Mention Flummi again with your request. You can withdraw this at any time with `/data ai-consent action:withdraw`.' : 'AI remains disabled. Nothing was sent to OpenRouter.', components: [] });
    return true;
}

module.exports = { consentButtons, disclosure, handleAiConsentInteraction, hasAiConsent, promptForAiConsent, setAiConsent };
