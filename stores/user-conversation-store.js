const fs = require('fs');
const path = require('path');
const {
    ensureGlobalUserDir,
    getGlobalUserFilePath,
    getGlobalUsersDir,
    normalizeUserId
} = require('../utils/global-user-storage');

const dataDir = path.join(__dirname, '..', 'data');
const usersDir = getGlobalUsersDir();
const legacyUsersDir = path.join(dataDir, 'users');

const DEFAULT_MAX_HISTORY = 24;
const DEFAULT_MAX_SUMMARY_CHARS = 2000;
const DEFAULT_MAX_PROFILE_CHARS = 900;
const DEFAULT_MAX_PROFILE_NOTES = 12;
const DEFAULT_MAX_PROFILE_TOPICS = 16;
const topicPatterns = [
    { label: 'Brawl Stars', pattern: /\b(?:brawl stars|el primo|spike|shelly|colt|poco)\b/i },
    { label: 'Five Nights at Freddy\'s', pattern: /\b(?:fnaf|five nights at freddy'?s|freddy fazbear|fazbear)\b/i },
    { label: 'Wuthering Waves', pattern: /\b(?:wuthering waves|iuno|jiyan|shorekeeper)\b/i },
    { label: 'Minecraft', pattern: /\bminecraft\b/i },
    { label: 'Roblox', pattern: /\broblox\b/i },
    { label: 'Fortnite', pattern: /\bfortnite\b/i },
    { label: 'Discord bots', pattern: /\b(?:discord bot|bot|openrouter|serper|api)\b/i },
    { label: 'Memes', pattern: /\b(?:meme|memes|keukenrol)\b/i },
    { label: 'Image search', pattern: /\b(?:foto|plaatje|afbeelding|image search|afbeelding zoeken)\b/i }
];

function formatTimestamp(date = new Date()) {
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

function getUserFilePath(userId) {
    return getGlobalUserFilePath(userId, 'aiMemory.json');
}

function getLegacyGlobalUserFilePath(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
        return null;
    }

    return path.join(usersDir, `${normalizedUserId}.json`);
}

function getLegacyUserFilePath(userId) {
    const normalizedUserId = normalizeUserId(userId);

    if (!normalizedUserId) {
        return null;
    }

    return path.join(legacyUsersDir, `${normalizedUserId}.json`);
}

function readRawUserData(filePath) {
    try {
        return ensureUserData(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
        return ensureUserData(null);
    }
}

function shouldPreferLegacyUserData(legacyData, globalData, globalFileExists) {
    if (!globalFileExists) {
        return true;
    }

    if (legacyData.history.length > globalData.history.length && !globalData.updatedAt) {
        return true;
    }

    if (legacyData.updatedAt && (!globalData.updatedAt || legacyData.updatedAt > globalData.updatedAt)) {
        return true;
    }

    return false;
}

function cleanupLegacyUsersDirIfEmpty() {
    try {
        if (fs.existsSync(legacyUsersDir) && fs.readdirSync(legacyUsersDir).length === 0) {
            fs.rmdirSync(legacyUsersDir);
        }
    } catch {
        // Best effort cleanup only.
    }
}

function migrateLegacyUserFile(userId) {
    const userFilePath = getUserFilePath(userId);
    const legacyUserFilePath = getLegacyUserFilePath(userId);
    const legacyGlobalUserFilePath = getLegacyGlobalUserFilePath(userId);
    const legacySources = [legacyGlobalUserFilePath, legacyUserFilePath].filter(Boolean);

    if (!userFilePath || !legacySources.some(filePath => fs.existsSync(filePath))) {
        return;
    }

    ensureGlobalUserDir(userId);

    let globalFileExists = fs.existsSync(userFilePath);
    let globalData = globalFileExists ? readRawUserData(userFilePath) : ensureUserData(null);

    for (const sourcePath of legacySources) {
        if (!fs.existsSync(sourcePath)) {
            continue;
        }

        const legacyData = readRawUserData(sourcePath);

        if (shouldPreferLegacyUserData(legacyData, globalData, globalFileExists)) {
            fs.writeFileSync(userFilePath, JSON.stringify(legacyData, null, 2), 'utf8');
            globalFileExists = true;
            globalData = legacyData;
        }

        try {
            fs.unlinkSync(sourcePath);
        } catch {
            // If cleanup fails, keep using the nested global file path anyway.
        }
    }

    cleanupLegacyUsersDirIfEmpty();
}

function migrateLegacyUsers() {
    const userIds = new Set();

    if (fs.existsSync(usersDir)) {
        for (const file of fs.readdirSync(usersDir)) {
            if (/^\d+\.json$/.test(file)) {
                userIds.add(path.basename(file, '.json'));
            }
        }
    }

    if (fs.existsSync(legacyUsersDir)) {
        for (const file of fs.readdirSync(legacyUsersDir)) {
            if (/^\d+\.json$/.test(file)) {
                userIds.add(path.basename(file, '.json'));
            }
        }
    }

    for (const userId of userIds) {
        migrateLegacyUserFile(userId);
    }

    cleanupLegacyUsersDirIfEmpty();
}

function ensureUserFile(userId) {
    const userFilePath = getUserFilePath(userId);

    if (!userFilePath) {
        return null;
    }

    ensureGlobalUserDir(userId);
    migrateLegacyUserFile(userId);

    if (!fs.existsSync(userFilePath)) {
        fs.writeFileSync(userFilePath, JSON.stringify({ history: [], updatedAt: null }, null, 2), 'utf8');
    }

    return userFilePath;
}

function ensureUserData(userData) {
    const safe = userData && typeof userData === 'object' ? userData : {};

    if (!Array.isArray(safe.history)) {
        safe.history = [];
    }

    if (typeof safe.summary !== 'string') {
        safe.summary = '';
    }

    if (typeof safe.profile !== 'string') {
        safe.profile = '';
    }

    if (!safe.profileSignals || typeof safe.profileSignals !== 'object') {
        safe.profileSignals = {};
    }

    if (!safe.profileSignals.topics || typeof safe.profileSignals.topics !== 'object') {
        safe.profileSignals.topics = {};
    }

    if (!safe.profileSignals.style || typeof safe.profileSignals.style !== 'object') {
        safe.profileSignals.style = {};
    }

    if (typeof safe.updatedAt !== 'string' && safe.updatedAt !== null) {
        safe.updatedAt = null;
    }

    return safe;
}

function readUserData(userId) {
    const userFilePath = ensureUserFile(userId);

    if (!userFilePath) {
        return ensureUserData(null);
    }

    try {
        const raw = fs.readFileSync(userFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        return ensureUserData(parsed);
    } catch {
        return ensureUserData(null);
    }
}

function writeUserData(userId, userData) {
    const userFilePath = ensureUserFile(userId);

    if (!userFilePath) {
        return;
    }

    fs.writeFileSync(userFilePath, JSON.stringify(ensureUserData(userData), null, 2), 'utf8');
}

function getUserHistory(userId) {
    const userData = readUserData(userId);
    return userData.history;
}

function getUserMemory(userId) {
    const userData = readUserData(userId);

    return {
        history: userData.history,
        summary: userData.summary,
        profile: userData.profile
    };
}

function getUserConversationSummary(userId) {
    const userData = readUserData(userId);

    return {
        historyMessages: userData.history.length,
        turns: Math.floor(userData.history.length / 2),
        summaryChars: userData.summary.length,
        profileChars: userData.profile.length,
        updatedAt: userData.updatedAt
    };
}

function compactMemoryText(text, maxLength = 180) {
    return String(text || '')
        .replace(/\[image result:\s*https?:\/\/[^\]\s]+\]/gi, '[image result]')
        .replace(/\[image:\s*https?:\/\/[^\]\s]+\]/gi, '[image]')
        .replace(/https?:\/\/\S+/gi, '[link]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function summarizeHistoryMessages(messages) {
    const lines = [];

    for (let index = 0; index < messages.length; index += 2) {
        const userMessage = messages[index];
        const assistantMessage = messages[index + 1];

        if (userMessage?.role !== 'user') {
            continue;
        }

        const userText = compactMemoryText(userMessage.content);
        const assistantText = assistantMessage?.role === 'assistant'
            ? compactMemoryText(assistantMessage.content)
            : '';

        if (!userText && !assistantText) {
            continue;
        }

        lines.push(`- User: ${userText || '[leeg]'}${assistantText ? ` | Flummi: ${assistantText}` : ''}`);
    }

    return lines.join('\n');
}

function mergeSummary(existingSummary, removedMessages, maxChars = DEFAULT_MAX_SUMMARY_CHARS) {
    const newSummary = summarizeHistoryMessages(removedMessages);

    if (!newSummary) {
        return String(existingSummary || '').slice(-maxChars);
    }

    const combined = [existingSummary, newSummary]
        .filter(Boolean)
        .join('\n');

    if (combined.length <= maxChars) {
        return combined.trim();
    }

    return combined
        .slice(-maxChars)
        .replace(/^[^\n]*\n/, '')
        .trim();
}

function normalizeProfileNote(note) {
    return compactMemoryText(note, 120)
        .replace(/[.?!]+$/g, '')
        .trim();
}

function addProfileNote(notes, note) {
    const normalized = normalizeProfileNote(note);

    if (!normalized) {
        return;
    }

    const lower = normalized.toLowerCase();
    const withoutDuplicate = notes.filter(item => item.toLowerCase() !== lower);

    withoutDuplicate.push(normalized);
    notes.splice(0, notes.length, ...withoutDuplicate);
}

function extractProfileNotes(userMessage, assistantMessage) {
    const text = compactMemoryText(userMessage, 500);
    const lower = text.toLowerCase();
    const notes = [];
    const patterns = [
        {
            regex: /\b(?:ik heet|mijn naam is|noem mij|noem me)\s+([a-z0-9 _.-]{2,40})/i,
            build: value => `Naam/alias: ${value}`
        },
        {
            regex: /\bmijn favoriete\s+([a-z0-9 _.-]{2,30})\s+is\s+(.{2,60})/i,
            build: (kind, value) => `Favoriete ${kind}: ${value}`
        },
        {
            regex: /\bik (?:hou van|houd van)\s+(.{2,70})/i,
            build: value => `Vindt dit leuk: ${value}`
        },
        {
            regex: /\bik vind\s+(.{2,70}?)\s+(?:leuk|tof|nice|grappig)\b/i,
            build: value => `Vindt dit leuk: ${value}`
        },
        {
            regex: /\bik (?:haat|vind)\s+(.{2,70}?)\s+(?:stom|kut|irritant|vervelend)\b/i,
            build: value => `Vindt dit niet leuk: ${value}`
        }
    ];

    for (const item of patterns) {
        const match = text.match(item.regex);

        if (match) {
            notes.push(item.build(...match.slice(1).map(value => value.trim())));
        }
    }

    if (/\b(?:kort|korte antwoorden|hou het kort|niet te lang)\b/.test(lower)) {
        notes.push('Voorkeur: korte antwoorden');
    }

    if (/\b(?:nederlands|praat nederlands|in het nederlands)\b/.test(lower)) {
        notes.push('Voorkeur: Nederlands praten');
    }

    if (/\b(?:foto|plaatje|afbeelding|image)\b/.test(lower) && /\b(?:zoek|geef|stuur|laat zien|laten zien)\b/.test(lower)) {
        notes.push('Gebruikt de bot vaak voor image search');
    }

    if (String(assistantMessage || '').includes('[image result:')) {
        notes.push('Heeft eerder image search gebruikt');
    }

    return notes;
}

function normalizeTopicLabel(topic) {
    const cleaned = compactMemoryText(topic, 50)
        .replace(/^(?:een|de|het|van|over)\s+/i, '')
        .replace(/[.,?!:;]+$/g, '')
        .trim();

    if (
        cleaned.length < 3 ||
        /^(?:foto|plaatje|afbeelding|image|dit|dat|wat|wie|waar|waarom|hoe|mij|me|een foto)$/i.test(cleaned)
    ) {
        return '';
    }

    return cleaned
        .split(/\s+/)
        .slice(0, 5)
        .join(' ');
}

function extractTopicSignals(userMessage) {
    const text = compactMemoryText(userMessage, 500);
    const topics = [];

    for (const item of topicPatterns) {
        if (item.pattern.test(text)) {
            topics.push(item.label);
        }
    }

    const contextualPatterns = [
        /\b(?:foto|plaatje|afbeelding)\s+(?:van\s+)?(.{3,50})/i,
        /\b(?:zoek|laat zien|geef|stuur)\s+(?:een\s+)?(?:foto|plaatje|afbeelding)?\s*(?:van\s+)?(.{3,50})/i,
        /\bover\s+(.{3,50})/i
    ];

    for (const pattern of contextualPatterns) {
        const match = text.match(pattern);
        const topic = normalizeTopicLabel(match?.[1]);

        if (topic) {
            topics.push(topic);
        }
    }

    return Array.from(new Set(topics));
}

function incrementSignalCounter(container, key, amount = 1) {
    const current = Number(container[key]) || 0;
    container[key] = current + amount;
}

function updateProfileSignals(profileSignals, userMessage) {
    const safe = profileSignals && typeof profileSignals === 'object'
        ? profileSignals
        : {};
    const topics = safe.topics && typeof safe.topics === 'object' ? safe.topics : {};
    const style = safe.style && typeof safe.style === 'object' ? safe.style : {};
    const text = compactMemoryText(userMessage, 500);
    const lower = text.toLowerCase();

    incrementSignalCounter(style, 'turns');

    if (text.length > 0 && text.length <= 80) {
        incrementSignalCounter(style, 'shortMessages');
    }

    if (/[?!]$/.test(text) || /\b(?:nee|ja|ok|top|doe maar|fix|haal|zet|waarom|hoezo)\b/i.test(text)) {
        incrementSignalCounter(style, 'directMessages');
    }

    if (/\b(?:lol|lmao|haha|bro|gast|kut|wtf|tf|sarcastisch|droog)\b/i.test(lower)) {
        incrementSignalCounter(style, 'casualMessages');
    }

    for (const topic of extractTopicSignals(text)) {
        incrementSignalCounter(topics, topic);
    }

    const rankedTopics = Object.entries(topics)
        .filter(([, count]) => Number(count) > 0)
        .sort((left, right) => Number(right[1]) - Number(left[1]))
        .slice(0, DEFAULT_MAX_PROFILE_TOPICS);

    return {
        topics: Object.fromEntries(rankedTopics),
        style
    };
}

function getSignalProfileNotes(profileSignals) {
    const notes = [];
    const topics = profileSignals?.topics && typeof profileSignals.topics === 'object'
        ? profileSignals.topics
        : {};
    const style = profileSignals?.style && typeof profileSignals.style === 'object'
        ? profileSignals.style
        : {};
    const turns = Number(style.turns) || 0;

    for (const [topic, count] of Object.entries(topics)) {
        if (Number(count) >= 2) {
            notes.push(`Terugkerend onderwerp: ${topic}`);
        }
    }

    if (turns >= 4 && (Number(style.shortMessages) || 0) / turns >= 0.55) {
        notes.push('Chatstijl: kort en direct');
    }

    if (turns >= 4 && (Number(style.casualMessages) || 0) >= 2) {
        notes.push('Toon: informeel en droog mag');
    }

    return notes;
}

function mergeUserProfile(existingProfile, userMessage, assistantMessage, profileSignals, maxChars = DEFAULT_MAX_PROFILE_CHARS) {
    const notes = String(existingProfile || '')
        .split('\n')
        .map(line => line.replace(/^-\s*/, '').trim())
        .filter(Boolean);
    const nextSignals = updateProfileSignals(profileSignals, userMessage);

    for (const note of [
        ...extractProfileNotes(userMessage, assistantMessage),
        ...getSignalProfileNotes(nextSignals)
    ]) {
        addProfileNote(notes, note);
    }

    const combined = notes
        .slice(-DEFAULT_MAX_PROFILE_NOTES)
        .map(note => `- ${note}`)
        .join('\n');

    return {
        profile: combined.length <= maxChars
            ? combined.trim()
            : combined
                .slice(-maxChars)
                .replace(/^[^\n]*\n/, '')
                .trim(),
        profileSignals: nextSignals
    };
}

function appendConversationTurn(userId, userMessage, assistantMessage, maxHistory = DEFAULT_MAX_HISTORY) {
    const userData = readUserData(userId);

    const now = formatTimestamp();

    userData.history.push({
        role: 'user',
        content: userMessage,
        at: now
    });

    userData.history.push({
        role: 'assistant',
        content: assistantMessage,
        at: now
    });

    const maxTurns = Math.max(2, Number(maxHistory) || DEFAULT_MAX_HISTORY);
    const maxMessages = maxTurns * 2;

    if (userData.history.length > maxMessages) {
        const removedMessages = userData.history.slice(0, userData.history.length - maxMessages);
        userData.summary = mergeSummary(userData.summary, removedMessages);
        userData.history = userData.history.slice(-maxMessages);
    }

    const profileResult = mergeUserProfile(
        userData.profile,
        userMessage,
        assistantMessage,
        userData.profileSignals
    );

    userData.profile = profileResult.profile;
    userData.profileSignals = profileResult.profileSignals;
    userData.updatedAt = now;
    writeUserData(userId, userData);
}

function clearUserHistory(userId) {
    writeUserData(userId, {
        summary: '',
        profile: '',
        profileSignals: {
            topics: {},
            style: {}
        },
        history: [],
        updatedAt: formatTimestamp()
    });
}

module.exports = {
    formatTimestamp,
    getUserFilePath,
    migrateLegacyUsers,
    usersDir,
    getUserHistory,
    getUserMemory,
    getUserConversationSummary,
    appendConversationTurn,
    clearUserHistory
};
