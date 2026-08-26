const DISCORD_MENTION_PATTERN = /<(@!?|@&|#)\d{17,20}>/g;
const DISCORD_SNOWFLAKE_PATTERN = /\b\d{17,20}\b/g;

function redactDiscordIdentifiers(value) {
    return String(value ?? '')
        .replace(DISCORD_MENTION_PATTERN, '[discord-reference]')
        .replace(DISCORD_SNOWFLAKE_PATTERN, '[discord-id]');
}

function sanitizeAiMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.map(message => {
        if (!message || typeof message !== 'object') return message;
        if (typeof message.content === 'string') {
            return { ...message, content: redactDiscordIdentifiers(message.content) };
        }
        if (!Array.isArray(message.content)) return message;
        return {
            ...message,
            content: message.content.map(part => part?.type === 'text' && typeof part.text === 'string'
                ? { ...part, text: redactDiscordIdentifiers(part.text) }
                : part)
        };
    });
}

module.exports = { redactDiscordIdentifiers, sanitizeAiMessages };
