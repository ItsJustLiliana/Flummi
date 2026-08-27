const feedbackStore = require('../stores/feedback-store');

async function handleWebsiteMailDirectMessage(message) {
    if (message.guildId || message.author?.bot) return false;
    const thread = feedbackStore.findOpenThreadForUser(message.author.id);
    if (!thread) return false;

    const attachmentUrls = [...(message.attachments?.values?.() || [])].map(attachment => attachment.url);
    const content = [message.content, ...attachmentUrls].filter(Boolean).join('\n');
    if (!content) return true;

    feedbackStore.appendMessage(thread.id, {
        direction: 'in',
        content,
        authorId: message.author.id,
        source: 'discord-dm'
    });
    await message.react('✅').catch(() => {});
    return true;
}

module.exports = { handleWebsiteMailDirectMessage };
