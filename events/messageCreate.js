const fs = require('fs');
const path = require('path');
const { canUseTriggers } = require('../stores/access-store');
const { incrementTriggerStat, getTriggers } = require('../stores/trigger-store');
const { readSettings } = require('../stores/settings-store');
const { appendPingRequest } = require('../stores/ping-request-store');
const { getUserHistory, appendConversationTurn, clearUserHistory } = require('../stores/user-conversation-store');
const { AiChatError, generateAiReply } = require('../services/ai-chat');

const pingResponsesPath = path.join(__dirname, '..', 'data', 'botPingResponses.json');
const defaultPingRequestSaveCommands = ['zet dit op pornhub'];

function getConfig() {
    const configPath = path.join(__dirname, '..', 'config.json');

    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
        return require('../config.json');
    }
}

async function getReferencedMessage(message) {
    const referencedMessageId = message.reference?.messageId;

    if (!referencedMessageId) {
        return null;
    }

    if (message.channel?.messages?.cache?.has(referencedMessageId)) {
        return message.channel.messages.cache.get(referencedMessageId);
    }

    try {
        return await message.channel.messages.fetch(referencedMessageId);
    } catch {
        return null;
    }
}

function stripBotMentions(content) {
    return (content || '').replace(/<@!?\d+>/g, '').trim();
}

function normalizeMentionCommand(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function getPingRequestSaveCommands(config) {
    const configured = config.features?.pingRequestSaveCommands;

    if (!Array.isArray(configured)) {
        return defaultPingRequestSaveCommands;
    }

    const commands = configured
        .filter(command => typeof command === 'string' && command.trim())
        .map(normalizeMentionCommand);

    return commands.length > 0 ? commands : defaultPingRequestSaveCommands;
}

function isPingRequestSaveCommand(input, config) {
    const command = normalizeMentionCommand(input);

    if (!command) {
        return false;
    }

    return getPingRequestSaveCommands(config).includes(command);
}

function readPingResponses() {
    try {
        const responses = JSON.parse(fs.readFileSync(pingResponsesPath, 'utf8'));
        return Array.isArray(responses) ? responses : [];
    } catch {
        return [];
    }
}

function buildPingResponsePayload(response) {
    const payload = {
        allowedMentions: {
            repliedUser: false
        }
    };

    if (typeof response === 'string') {
        payload.content = response;
    } else if (response && typeof response === 'object') {
        if (typeof response.message === 'string' && response.message.trim()) {
            payload.content = response.message.trim();
        }

        if (typeof response.image === 'string' && response.image.trim()) {
            payload.content = [payload.content, response.image.trim()]
                .filter(Boolean)
                .join('\n');
        }
    }

    if (!payload.content) {
        return null;
    }

    return payload;
}

function randomItem(items) {
    if (!items.length) {
        return null;
    }

    return items[Math.floor(Math.random() * items.length)];
}

function formatTimestamp(date) {
    const value = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(value.getTime())) {
        return '';
    }

    const pad = number => String(number).padStart(2, '0');

    return [
        value.getFullYear(),
        pad(value.getMonth() + 1),
        pad(value.getDate())
    ].join('-') + ' ' + [
        pad(value.getHours()),
        pad(value.getMinutes()),
        pad(value.getSeconds())
    ].join(':');
}

function getAttachmentUrls(message) {
    if (!message?.attachments?.size) {
        return '';
    }

    return Array.from(message.attachments.values())
        .map(attachment => attachment.url)
        .filter(Boolean)
        .join('\n');
}

function getAttachmentSummaries(message) {
    if (!message?.attachments?.size) {
        return [];
    }

    return Array.from(message.attachments.values())
        .map(attachment => ({
            name: attachment.name || attachment.filename || 'attachment',
            url: attachment.url || '',
            contentType: attachment.contentType || '',
            size: attachment.size || 0
        }))
        .filter(attachment => attachment.url);
}

function buildPingRequestEntry(message, referencedMessage) {
    return {
        byId: message.author.id,
        byTag: message.author.tag || message.author.username || '',
        at: formatTimestamp(new Date()),
        content: [
            {
                sendById: referencedMessage.author?.id || '',
                sendByTag: referencedMessage.author?.tag || referencedMessage.author?.username || '',
                at: formatTimestamp(referencedMessage.createdAt),
                message: referencedMessage.content || '',
                attachments: getAttachmentUrls(referencedMessage)
            }
        ]
    };
}

function buildReferencedMessageContext(referencedMessage) {
    if (!referencedMessage) {
        return '';
    }

    const lines = [
        'Context: de gebruiker replyt op dit bericht en wil dat je daarop reageert.',
        `Auteur: ${referencedMessage.author?.tag || referencedMessage.author?.username || 'onbekend'}`,
        `Bericht: ${referencedMessage.content || '[geen tekst]'}`
    ];

    const attachments = getAttachmentSummaries(referencedMessage);

    if (attachments.length > 0) {
        lines.push('Attachments:');

        for (const attachment of attachments) {
            const details = [
                attachment.name,
                attachment.contentType,
                `${attachment.size} bytes`
            ].filter(Boolean).join(' | ');

            lines.push(`- ${details}: ${attachment.url}`);
        }
    }

    return lines.join('\n');
}

function buildAiUserInput(userInput, referencedMessage) {
    const referencedContext = buildReferencedMessageContext(referencedMessage);

    if (!referencedContext) {
        return userInput;
    }

    return [
        referencedContext,
        '',
        `Gebruiker zegt tegen jou: ${userInput}`
    ].join('\n');
}

async function replyWithRandomPingResponse(message) {
    const response = randomItem(readPingResponses());
    const payload = buildPingResponsePayload(response);

    if (!payload) {
        return false;
    }

    try {
        await message.reply(payload);
        return true;
    } catch (error) {
        console.error('Failed to send ping response:', error);
    }

    return false;
}

module.exports = {
    name: 'messageCreate',

    async execute(message, client) {
        const guildId = message.guildId;

        if (!guildId) return;

        if (message.author.bot) return;

        const content = message.content.trim();

        if (/@(?:everyone|here)\b/i.test(content)) {
            return;
        }

        const config = getConfig();
        const features = config.features || {};
        const conversationEnabled = features.aiConversationsEnabled !== false;
        const isMentioningBot = Boolean(client?.user) && message.mentions.has(client.user);
        const mentionInput = stripBotMentions(content);

        let isReplyToBot = false;
        let referencedMessage = null;

        if (message.reference?.messageId) {
            referencedMessage = await getReferencedMessage(message);
            isReplyToBot = Boolean(referencedMessage?.author?.id && client?.user?.id && referencedMessage.author.id === client.user.id);
        }

        if (
            isMentioningBot &&
            features.pingRequestSaveEnabled !== false &&
            message.reference?.messageId &&
            referencedMessage &&
            isPingRequestSaveCommand(mentionInput, config)
        ) {
            appendPingRequest(buildPingRequestEntry(message, referencedMessage), guildId);

            await message.reply({
                content: 'Opgeslagen.',
                allowedMentions: {
                    repliedUser: false
                }
            });

            return;
        }

        if (conversationEnabled && (isMentioningBot || isReplyToBot)) {
            const userInput = mentionInput;

            if (!userInput) {
                if (!isMentioningBot) {
                    return;
                }
            } else {
                try {
                    await message.channel.sendTyping();
                    const history = getUserHistory(message.author.id);
                    const aiInput = buildAiUserInput(userInput, referencedMessage);
                    const ai = await generateAiReply({ userInput: aiInput, history });

                    await message.reply({ content: ai.text });

                    if (ai.resetHistory) {
                        clearUserHistory(message.author.id);
                    }

                    appendConversationTurn(
                        message.author.id,
                        aiInput,
                        ai.text,
                        ai.maxHistoryTurns
                    );
                } catch (error) {
                    console.error('Failed to generate AI conversation reply:', error);

                    try {
                        const failureMessage = error instanceof AiChatError && error.code === 'CONTENT_BLOCKED'
                            ? 'I cannot answer that wording. Rephrase it and we can keep going.'
                            : 'I had trouble reaching the AI service. Try again in a moment.';

                        await message.reply({
                            content: failureMessage
                        });
                    } catch (replyError) {
                        console.error('Failed to send AI failure reply:', replyError);
                    }
                }

                return;
            }
        }

        if (isMentioningBot) {
            const userInput = mentionInput;

            if (
                features.pingRequestSaveEnabled !== false &&
                message.reference?.messageId &&
                referencedMessage &&
                userInput
            ) {
                appendPingRequest(buildPingRequestEntry(message, referencedMessage), guildId);
            }

            if (features.pingResponsesEnabled !== false) {
                await replyWithRandomPingResponse(message);
                return;
            }
        }

        if (!canUseTriggers(message.author.id, guildId)) return;

        const settings = readSettings(guildId);

        if (!settings.triggersEnabled) return;

        const triggers = getTriggers(guildId);

        if (message.reference) {
            const lowerContent = content.toLowerCase();
            const exactMatch = settings.exactTriggerMatch;
            const hasTriggerMatch = triggers.some(trigger => {
                if (!trigger.trigger) return false;

                const triggerText = trigger.trigger.toLowerCase();
                return exactMatch
                    ? lowerContent === triggerText
                    : lowerContent.includes(triggerText);
            });

            if (!message.mentions.has(client?.user) && !hasTriggerMatch) {
                return;
            }
        }

        // =========================
        // Trigger checking
        // =========================

        const lowerContent = content.toLowerCase();
        const exactMatch = settings.exactTriggerMatch;

        for (const trigger of triggers) {

            if (
                trigger.trigger &&
                (
                    exactMatch
                        ? lowerContent === trigger.trigger.toLowerCase()
                        : lowerContent.includes(trigger.trigger.toLowerCase())
                )
            ) {

                const payload = {};

                if (trigger.response) {
                    payload.content = trigger.response;
                }

                if (trigger.image) {
                    payload.files = [trigger.image];
                }

                try {
                    await message.reply(payload);
                    incrementTriggerStat(trigger.trigger, guildId);
                } catch (err) {
                    console.error(
                        'Failed to send trigger response:',
                        err
                    );
                }

                return;
            }
        }
    }
};
