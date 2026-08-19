const fs = require('fs');
const path = require('path');
const {
    canSavePingRequests,
    canUseAiChat,
    canUseBotMentions,
    canUseTriggers
} = require('../stores/access-store');
const { incrementTriggerStat, getTriggers } = require('../stores/trigger-store');
const { recordActivity } = require('../stores/activity-store');
const { readSettings } = require('../stores/settings-store');
const { appendPingRequest } = require('../stores/ping-request-store');
const { getUserMemory, appendConversationTurn, clearUserHistory } = require('../stores/user-conversation-store');
const { formatLanguages, getProfile } = require('../stores/profile-store');
const { incrementMessageStats } = require('../stores/server-stats-store');
const { recordMessageEvent } = require('../stores/analytics-store');
const { AiChatError, generateAiReply, stringifyUserInput } = require('../services/ai-chat');
const { ImageSearchError, searchImage } = require('../services/image-search');
const { readConfig } = require('../utils/config');
const { recordAiResult } = require('../stores/ai-health-store');

const pingResponsesPath = path.join(__dirname, '..', 'data', 'botPingResponses.json');
const defaultPingRequestSaveCommands = ['zet dit op pornhub'];
const imageContentTypeExtensions = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

class ImageAttachmentError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ImageAttachmentError';
        this.code = code;
    }
}

function getConfig() {
    return readConfig();
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

function extractDirectImageSearchQuery(input) {
    const text = String(input || '')
        .trim()
        .replace(/\s+/g, ' ');

    if (!text) {
        return '';
    }

    const patterns = [
        /^(?:geef\s+(?:mij|me)\s+)?(?:een\s+)?(?:foto|plaatje|afbeelding)\s+(?:van\s+)?(.+)$/i,
        /^(?:zoek|stuur)\s+(?:een\s+)?(?:foto|plaatje|afbeelding)\s+(?:van\s+)?(.+)$/i,
        /^(.+?)\s+(?:foto|plaatje|afbeelding)$/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        const query = match?.[1]?.trim();

        if (query) {
            return query;
        }
    }

    return '';
}

function cleanImageSearchContext(text) {
    return String(text || '')
        .replace(/\[{1,2}\s*image[\s_-]+search\s*:\s*([^\]\n]{1,160})(?:\]{1,2}|$)/gi, ' ')
        .replace(/\[image result:\s*https?:\/\/[^\]\s]+\]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractImageResultUrls(text) {
    const value = String(text || '');
    const matches = Array.from(value.matchAll(/\[image result:\s*(https?:\/\/[^\]\s]+)\]/gi));

    return matches
        .map(match => match[1])
        .filter(Boolean);
}

function extractRememberedImageUrls(text) {
    const value = String(text || '');
    const patterns = [
        /\[image(?: result)?:\s*(https?:\/\/[^\]\s]+)\]/gi,
        /\battachments?:\s*(https?:\/\/\S+)/gi
    ];
    const urls = [];

    for (const pattern of patterns) {
        for (const match of value.matchAll(pattern)) {
            if (match?.[1]) {
                urls.push(match[1]);
            }
        }
    }

    return Array.from(new Set(urls));
}

function isSimilarImageRequest(input) {
    const text = String(input || '').toLowerCase();

    return (
        /\b(?:soortgelijke|vergelijkbare|zelfde|similar|lijkt|lijken|erop|daarop)\b/.test(text) &&
        /\b(?:foto|plaatje|afbeelding|image|zien|laten zien)\b/.test(text)
    );
}

function findRecentVisualContext(history) {
    const entries = Array.isArray(history) ? history : [];

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];

        if (entry?.role !== 'assistant') {
            continue;
        }

        const content = cleanImageSearchContext(entry.content);

        if (
            content &&
            !/^ik vond geen bruikbare afbeelding hiervoor\.?$/i.test(content) &&
            !/^image search is tijdelijk niet beschikbaar\.?$/i.test(content)
        ) {
            return content;
        }
    }

    return '';
}

function findRecentImageResultUrls(history) {
    const entries = Array.isArray(history) ? history : [];

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];

        const urls = extractRememberedImageUrls(entry?.content);

        if (urls.length > 0) {
            return urls;
        }
    }

    return [];
}

function getImageAttachmentUrls(message) {
    if (!message?.attachments?.size) {
        return [];
    }

    return Array.from(message.attachments.values())
        .filter(attachment => attachment.url && isImageAttachment(attachment))
        .map(attachment => attachment.url);
}

function getReferencedImageUrls(referencedMessage) {
    return getImageAttachmentUrls(referencedMessage);
}

function extractSimilarImageSearchQuery(input, history, referencedMessage) {
    if (!isSimilarImageRequest(input)) {
        return '';
    }

    const referencedContent = cleanImageSearchContext(referencedMessage?.content);

    if (referencedContent && referencedContent !== '[geen tekst]') {
        return referencedContent;
    }

    return findRecentVisualContext(history);
}

function extractSimilarImageSearchContext(input, history, referencedMessage) {
    const query = extractSimilarImageSearchQuery(input, history, referencedMessage);

    if (!query) {
        return null;
    }

    return {
        query,
        excludeUrls: Array.from(new Set([
            ...getReferencedImageUrls(referencedMessage),
            ...findRecentImageResultUrls(history)
        ]))
    };
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

function getImageExtensionFromContentType(contentType) {
    const cleanType = String(contentType || '').split(';')[0].trim().toLowerCase();
    return imageContentTypeExtensions[cleanType] || '';
}

function getImageExtensionFromUrl(url) {
    try {
        const parsed = new URL(url);
        const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
        const ext = match?.[1]?.toLowerCase() || '';

        return ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)
            ? (ext === 'jpeg' ? 'jpg' : ext)
            : '';
    } catch {
        return '';
    }
}

async function buildImageFileAttachment(imageUrl) {
    const response = await fetch(imageUrl, {
        headers: {
            Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5',
            'User-Agent': 'Flummi/1.0'
        }
    });

    if (!response.ok) {
        throw new ImageAttachmentError(`Image download failed: ${response.status}`, 'DOWNLOAD_FAILED');
    }

    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length')) || 0;

    if (!String(contentType).toLowerCase().startsWith('image/')) {
        throw new ImageAttachmentError(`Image download returned non-image content type: ${contentType || 'unknown'}`, 'INVALID_CONTENT_TYPE');
    }

    if (contentLength > 8 * 1024 * 1024) {
        throw new ImageAttachmentError(`Image download is too large: ${contentLength} bytes`, 'IMAGE_TOO_LARGE');
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length > 8 * 1024 * 1024) {
        throw new ImageAttachmentError(`Image download is too large: ${buffer.length} bytes`, 'IMAGE_TOO_LARGE');
    }

    const ext = getImageExtensionFromContentType(contentType) || getImageExtensionFromUrl(imageUrl) || 'jpg';

    return {
        attachment: buffer,
        name: `image-search.${ext}`
    };
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

function buildReferencedMessageContext(referencedMessage, includeAttachments = true) {
    if (!referencedMessage) {
        return '';
    }

    const lines = [
        'Context: de gebruiker replyt op dit bericht en wil dat je daarop reageert.',
        `Auteur: ${referencedMessage.author?.tag || referencedMessage.author?.username || 'onbekend'}`,
        `Bericht: ${referencedMessage.content || '[geen tekst]'}`
    ];

    if (includeAttachments) {
        lines.push(...buildAttachmentContext('Gereplyde bericht', referencedMessage));
    }

    return lines.join('\n');
}

function buildAiUserInput(userInput, message, referencedMessage, config) {
    const imageParts = getAiImageParts([referencedMessage, message], config);
    const includeAttachmentUrls = imageParts.length === 0;
    const referencedContext = buildReferencedMessageContext(referencedMessage, includeAttachmentUrls);
    const currentAttachmentContext = includeAttachmentUrls
        ? buildAttachmentContext('Huidige bericht', message).join('\n')
        : '';
    const textInput = [
        referencedContext,
        currentAttachmentContext,
        `Gebruiker zegt tegen jou: ${userInput || '[geen tekst]'}`
    ].filter(Boolean).join('\n\n');

    if (imageParts.length === 0) {
        return textInput;
    }

    return [
        {
            type: 'text',
            text: `${textInput}\n\nEr is minstens één afbeelding meegestuurd. Bekijk de afbeelding daadwerkelijk en beschrijf of beantwoord concreet wat je ziet. Doe niet alsof je de afbeelding niet kunt zien tenzij de afbeelding zelf onleesbaar is.`
        },
        ...imageParts
    ];
}

function buildExternalUserProfileContext(profile) {
    if (!profile || typeof profile !== 'object') {
        return '';
    }

    const lines = [];

    if (profile.nickname) {
        lines.push(`Naam/nickname: ${profile.nickname}`);
    }

    if (profile.bio) {
        lines.push(`Bio: ${profile.bio}`);
    }

    if (profile.pronouns) {
        lines.push(`Pronouns: ${profile.pronouns}`);
    }

    if (profile.birthday) {
        lines.push(`Birthday: ${profile.birthday}`);
    }

    if (profile.timezone) {
        lines.push(`Timezone: ${profile.timezone}`);
    }

    if (Array.isArray(profile.languages) && profile.languages.length > 0) {
        lines.push(`Languages: ${formatLanguages(profile.languages)}`);
    }

    const socials = Object.entries(profile.socials || {})
        .filter(([, handle]) => handle)
        .map(([platform, handle]) => `${platform}: ${handle}`)
        .slice(0, 5);

    if (socials.length > 0) {
        lines.push(`Socials: ${socials.join(', ')}`);
    }

    return lines.join('\n').slice(0, 900);
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

async function buildAiReplyPayload(ai) {
    const cleanText = String(ai.text || '').trim();
    const payload = {
        content: cleanText && !/^hier\.?$/i.test(cleanText) ? cleanText : '',
        allowedMentions: {
            repliedUser: false
        }
    };

    if (!ai.imageSearch?.query) {
        return payload;
    }

    try {
        const result = await searchImage(ai.imageSearch.query, {
            excludeUrls: ai.imageSearch.excludeUrls
        });

        if (result?.imageUrl) {
            payload.files = [await buildImageFileAttachment(result.imageUrl)];
            payload.imageResult = result;
        } else if (!payload.content) {
            payload.content = 'Ik vond geen bruikbare afbeelding hiervoor.';
        }
    } catch (error) {
        if (error instanceof ImageSearchError && error.code === 'UNSUPPORTED_PROVIDER') {
            console.warn('Image search provider is not supported:', error.message);
        } else if (error instanceof ImageSearchError && error.code === 'IMAGE_SEARCH_UNAVAILABLE') {
            payload.content = 'Image search is tijdelijk niet beschikbaar.';
        } else if (error instanceof ImageAttachmentError) {
            console.warn(`Image search attachment failed: ${error.message}`);
        } else {
            console.error('Failed to search image for AI reply:', error);
        }
    }

    if (!payload.content && !payload.embeds?.length && !payload.files?.length) {
        payload.content = 'Ik vond geen bruikbare afbeelding hiervoor.';
    }

    return payload;
}

module.exports = {
    buildImageFileAttachment,
    buildAiUserInput,
    buildExternalUserProfileContext,
    cleanImageSearchContext,
    extractDirectImageSearchQuery,
    extractSimilarImageSearchQuery,
    extractSimilarImageSearchContext,
    extractImageResultUrls,
    extractRememberedImageUrls,
    findRecentVisualContext,
    findRecentImageResultUrls,
    getImageAttachmentUrls,
    getImageExtensionFromContentType,
    getImageExtensionFromUrl,
    ImageAttachmentError,
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
            recordMessageEvent({
                guildId, channelId: message.channelId, channelName: message.channel?.name || message.channelId,
                userId: message.author.id, userTag: message.author.tag || message.author.username || message.author.id, message
            });
        } catch (error) {
            console.warn('Failed to update server stats:', error);
        }

        const content = message.content.trim();

        if (/@(?:everyone|here)\b/i.test(content)) {
            return;
        }

        const config = getConfig();
        const globalFeatures = config.features || {};
        const guildFeatureOverrides = readSettings(guildId).features || {};
        const features = Object.fromEntries(Object.keys({ ...globalFeatures, ...guildFeatureOverrides }).map(key => [
            key,
            globalFeatures[key] === false ? false : (guildFeatureOverrides[key] ?? globalFeatures[key])
        ]));
        const conversationEnabled = features.aiConversationsEnabled !== false;
        // A role shared by Flummi can be mentioned too. That must not be treated as a direct bot ping.
        const isMentioningBot = Boolean(client?.user) && message.mentions.has(client.user, {
            ignoreRoles: true,
            ignoreEveryone: true
        });
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
                    const aiStartedAt = Date.now();
                    const memory = getUserMemory(message.author.id);
                    const externalUserProfile = buildExternalUserProfileContext(getProfile(message.author.id));
                    const history = memory.history;
                    const directImageSearchQuery = extractDirectImageSearchQuery(userInput);
                    const similarImageSearchContext = extractSimilarImageSearchContext(userInput, history, referencedMessage);
                    const imageSearchQuery = directImageSearchQuery || similarImageSearchContext?.query;

                    if (imageSearchQuery) {
                        const replyPayload = await buildAiReplyPayload({
                            text: '',
                            imageSearch: {
                                query: imageSearchQuery,
                                excludeUrls: directImageSearchQuery ? [] : similarImageSearchContext?.excludeUrls
                            }
                        });

                        await message.reply(replyPayload);
                        appendConversationTurn(
                            message.author.id,
                            userInput,
                            [
                                `[image search: ${imageSearchQuery}]`,
                                replyPayload.imageResult?.imageUrl ? `[image result: ${replyPayload.imageResult.imageUrl}]` : ''
                            ].filter(Boolean).join('\n'),
                            config.ai?.maxHistoryTurns
                        );
                        return;
                    }

                    const aiInput = buildAiUserInput(userInput, message, referencedMessage, { ...config, features });
                    const ai = await generateAiReply({
                        userInput: aiInput,
                        history,
                        memorySummary: memory.summary,
                        userProfile: memory.profile,
                        externalUserProfile,
                        userId: message.author.id,
                        guildId,
                        channelId: message.channelId
                    });
                    recordAiResult({ ok: true, latencyMs: Date.now() - aiStartedAt, model: readConfig().ai?.model || null });
                    const replyPayload = await buildAiReplyPayload(ai);

                    await message.reply(replyPayload);

                    if (ai.resetHistory) {
                        clearUserHistory(message.author.id);
                    }

                    appendConversationTurn(
                        message.author.id,
                        stringifyUserInput(aiInput),
                        [
                            ai.text,
                            ai.imageSearch?.query ? `[image search: ${ai.imageSearch.query}]` : '',
                            replyPayload.imageResult?.imageUrl ? `[image result: ${replyPayload.imageResult.imageUrl}]` : ''
                        ]
                            .filter(Boolean)
                            .join('\n'),
                        ai.maxHistoryTurns
                    );
                } catch (error) {
                    recordAiResult({ ok: false, model: readConfig().ai?.model || null, code: error instanceof AiChatError ? error.code : 'REQUEST_FAILED' });
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

            if (!message.mentions.has(client?.user, { ignoreRoles: true, ignoreEveryone: true }) && !hasTriggerMatch) {
                return;
            }
        }

        // =========================
        // Trigger checking
        // =========================

        const lowerContent = content.toLowerCase();
        const exactMatch = settings.exactTriggerMatch;

        for (const trigger of triggers) {
            if (trigger.enabled === false) continue;

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
                    recordActivity('trigger-fired', `Trigger "${trigger.trigger}" activated`, { guildId, userId: message.author.id });
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
