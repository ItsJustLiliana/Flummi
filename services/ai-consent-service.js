const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { hasAiConsent, setAiConsent } = require('../stores/ai-consent-store');
const { privacyUrl, termsUrl } = require('../utils/public-links');

const disclosure = `By enabling Flummi AI, you agree to the [Terms of Service](${termsUrl()}) and confirm that you have read the [Privacy Policy](${privacyUrl()}).`;

function consentButtons(userId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai-consent:allow:${userId}`).setLabel('Enable AI').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ai-consent:decline:${userId}`).setLabel('Keep AI off').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setURL(termsUrl()).setLabel('Terms').setStyle(ButtonStyle.Link),
        new ButtonBuilder().setURL(privacyUrl()).setLabel('Privacy').setStyle(ButtonStyle.Link)
    );
}
async function promptForAiConsent(message) {
    return message.reply({ content: disclosure, components: [consentButtons(message.author.id)], allowedMentions: { repliedUser: false } });
}
function canSendAiContent(userId, consentCheck = hasAiConsent) {
    return Boolean(consentCheck(userId));
}
async function handleAiConsentInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId.startsWith('ai-consent:')) return false;
    const [, action, userId] = interaction.customId.split(':');
    if (interaction.user.id !== userId) { await interaction.reply({ content: 'This AI privacy choice belongs to another user.', flags: MessageFlags.Ephemeral }); return true; }
    const granted = action === 'allow';
    setAiConsent(userId, granted);
    await interaction.update({ content: granted ? 'AI is enabled. Mention Flummi again with your request. You can turn it off at any time with `/data ai-consent action:withdraw`.' : 'AI remains disabled. Nothing was sent to an AI provider.', components: [] });
    return true;
}

module.exports = { canSendAiContent, consentButtons, disclosure, handleAiConsentInteraction, hasAiConsent, promptForAiConsent, setAiConsent };
