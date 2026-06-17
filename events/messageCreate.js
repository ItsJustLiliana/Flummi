const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const {
    canSavePingRequests,
    canUseAiChat,
    canUseBotMentions,
    canUseTriggers
} = require('../stores/access-store');
const { incrementTriggerStat, getTriggers } = require('../stores/trigger-store');
const { readSettings } = require('../stores/settings-store');
const { appendPingRequest } = require('../stores/ping-request-store');
const { getUserHistory, appendConversationTurn, clearUserHistory } = require('../stores/user-conversation-store');
const { incrementMessageStats } = require('../stores/server-stats-store');
const { AiChatError, generateAiReply, stringifyUserInput } = require('../services/ai-chat');
const { ImageSearchError, searchImage } = require('../services/image-search');

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

function isImageAttachment(attachment) {
    const contentType = String(attachment.contentType || '').toLowerCase();
    const url = String(attachment.url || '').toLowerCase();

    return (
        contentType.startsWith('image/') ||
        /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/.test(url)
    );
}

function getAiImageParts(messages, config) {
    if (config.features?.aiAttachmentsEnabled === false) {
        return [];
    }

    const maxImages = Math.max(0, Number(config.ai?.maxImageAttachments) || 4);

    return messages
        .filter(Boolean)
        .flatMap(message => Array.from(message.attachments?.values?.() || []))
        .filter(attachment => attachment.url && isImageAttachment(attachment))
        .slice(0, maxImages)
        .map(attachment => ({
            type: 'image_url',
            image_url: {
                url: attachment.url
            }
        }));
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

function buildAttachmentContext(label, message) {
    const attachments = getAttachmentSummaries(message);

    if (attachments.length === 0) {
        return [];
    }

    const lines = [`${label} attachments:`];

    for (const attachment of attachments) {
        const details = [
            attachment.name,
            attachment.contentType,
            `${attachment.size} bytes`
        ].filter(Boolean).join(' | ');

        lines.push(`- ${details}: ${attachment.url}`);
    }

    return lines;
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

    lines.push(...buildAttachmentContext('Gereplyde bericht', referencedMessage));

    return lines.join('\n');
}

function buildAiUserInput(userInput, message, referencedMessage, config) {
    const referencedContext = buildReferencedMessageContext(referencedMessage);
    const currentAttachmentContext = buildAttachmentContext('Huidige bericht', message).join('\n');
    const textInput = [
        referencedContext,
        currentAttachmentContext,
        `Gebruiker zegt tegen jou: ${userInput || '[geen tekst]'}`
    ].filter(Boolean).join('\n\n');
    const imageParts = getAiImageParts([referencedMessage, message], config);

    if (imageParts.length === 0) {
        return textInput;
    }

    return [
        {
            type: 'text',
            text: textInput
        },
        ...imageParts
    ];
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

function truncateEmbedText(text, maxLength) {
    const value = String(text || '').trim();

    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildImageSearchEmbed(result, query) {
    const embed = new EmbedBuilder()
        .setColor(0x1E88E5)
        .setTitle(truncateEmbedText(result.title || query || 'Image result', 256))
        .setImage(result.imageUrl)
        .setFooter({ text: truncateEmbedText(`Image search: ${query}`, 2048) });

    if (result.sourceUrl && /^https?:\/\//i.test(result.sourceUrl)) {
        embed.setURL(result.sourceUrl);
    }

    return embed;
}

async function buildAiReplyPayload(ai) {
    const payload = {
        content: ai.text || 'Hier.',
        allowedMentions: {
            repliedUser: false
        }
    };

    if (!ai.imageSearch?.query) {
        return payload;
    }

    try {
        const result = await searchImage(ai.imageSearch.query);

        if (result?.imageUrl) {
            payload.embeds = [buildImageSearchEmbed(result, ai.imageSearch.query)];
        } else if (!ai.text || /^hier\.?$/i.test(ai.text.trim())) {
            payload.content = 'Ik vond geen bruikbare afbeelding hiervoor.';
        }
    } catch (error) {
        if (error instanceof ImageSearchError && error.code === 'UNSUPPORTED_PROVIDER') {
            console.warn('Image search provider is not supported:', error.message);
        } else {
            console.error('Failed to search image for AI reply:', error);
        }
    }

    return payload;
}

module.exports = {
    name: 'messageCreate',

    async execute(message, client) {
        const guildId = message.guildId;

        if (!guildId) return;

        if (message.author.bot) return;

        try {
            incrementMessageStats({
                guildId,
                channelId: message.channelId,
                channelName: message.channel?.name || message.channelId,
                userId: message.author.id,
                userTag: message.author.tag || message.author.username || message.author.id
            });
        } catch (error) {
            console.warn('Failed to update server stats:', error);
        }

        const content = message.content.trim();

        if (/@(?:everyone|here)\b/i.test(content)) {
            return;
        }

        const config = getConfig();
        const features = config.features || {};
        const conversationEnabled = features.aiConversationsEnabled !== false;
        const isMentioningBot = Boolean(client?.user) && message.mentions.has(client.user);
        const mentionInput = stripBotMentions(content);
        const canUseAi = canUseAiChat(message.author.id, guildId);
        const canUseMentionResponses = canUseBotMentions(message.author.id, guildId);
        const canSavePingRequest = canSavePingRequests(message.author.id, guildId);

        let isReplyToBot = false;
        let referencedMessage = null;

        if (message.reference?.messageId) {
            referencedMessage = await getReferencedMessage(message);
            isReplyToBot = Boolean(referencedMessage?.author?.id && client?.user?.id && referencedMessage.author.id === client.user.id);
        }

        if (
            isMentioningBot &&
            features.pingRequestSaveEnabled !== false &&
            canSavePingRequest &&
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

        if (conversationEnabled && canUseAi && (isMentioningBot || isReplyToBot)) {
            const userInput = mentionInput;
            const hasAttachments = Boolean(
                message.attachments?.size ||
                referencedMessage?.attachments?.size
            );

            if (!userInput && !hasAttachments) {
                if (!isMentioningBot) {
                    return;
                }
            } else {
                try {
                    await message.channel.sendTyping();
                    const history = getUserHistory(message.author.id);
                    const aiInput = buildAiUserInput(userInput, message, referencedMessage, config);
                    const ai = await generateAiReply({ userInput: aiInput, history });
                    const replyPayload = await buildAiReplyPayload(ai);

                    await message.reply(replyPayload);

                    if (ai.resetHistory) {
                        clearUserHistory(message.author.id);
                    }

                    appendConversationTurn(
                        message.author.id,
                        stringifyUserInput(aiInput),
                        [ai.text, ai.imageSearch?.query ? `[image search: ${ai.imageSearch.query}]` : '']
                            .filter(Boolean)
                            .join('\n'),
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
                canSavePingRequest &&
                message.reference?.messageId &&
                referencedMessage &&
                userInput
            ) {
                appendPingRequest(buildPingRequestEntry(message, referencedMessage), guildId);
            }

            if (features.pingResponsesEnabled !== false && canUseMentionResponses) {
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
