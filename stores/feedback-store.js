const fs = require('fs');
const path = require('path');

const defaultFeedbackFilePath = path.join(__dirname, '..', 'data', 'global', 'feedback.json');
const defaultRateLimitFilePath = path.join(__dirname, '..', 'data', 'global', 'feedback-rate-limits.json');
const feedbackCooldownMs = 60 * 1000;
const feedbackHourlyWindowMs = 60 * 60 * 1000;
const feedbackHourlyLimit = 5;

class FeedbackRateLimitError extends Error {
    constructor(retryAfterMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        super(`Please wait ${formatWait(retryAfterSeconds)} before sending more feedback.`);
        this.name = 'FeedbackRateLimitError';
        this.code = 'FEEDBACK_RATE_LIMITED';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

function formatWait(seconds) {
    if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFeedbackStore({
    feedbackFilePath = defaultFeedbackFilePath,
    rateLimitFilePath = defaultRateLimitFilePath,
    now = () => Date.now()
} = {}) {
    function readFeedback() {
        const rows = readJson(feedbackFilePath, []);
        return Array.isArray(rows) ? rows : [];
    }

    function readRecentSubmissions(currentTime) {
        const rows = readJson(rateLimitFilePath, []);
        if (!Array.isArray(rows)) return [];
        return rows.filter(row => Number.isFinite(row?.submittedAt) && currentTime - row.submittedAt < feedbackHourlyWindowMs);
    }

    function getRateLimit(userId, currentTime = now()) {
        const recentRows = readRecentSubmissions(currentTime);
        const userRows = recentRows
            .filter(row => String(row.userId) === String(userId))
            .sort((a, b) => a.submittedAt - b.submittedAt);
        const latestSubmission = userRows.at(-1)?.submittedAt || 0;
        const cooldownUntil = latestSubmission + feedbackCooldownMs;
        const hourlyLimitUntil = userRows.length >= feedbackHourlyLimit
            ? userRows[userRows.length - feedbackHourlyLimit].submittedAt + feedbackHourlyWindowMs
            : 0;
        const retryAt = Math.max(cooldownUntil, hourlyLimitUntil);

        return {
            allowed: retryAt <= currentTime,
            retryAfterMs: Math.max(0, retryAt - currentTime),
            remainingThisHour: Math.max(0, feedbackHourlyLimit - userRows.length),
            recentRows
        };
    }

    function addFeedback({ userId, username, message, type = 'feedback' }) {
        const cleanMessage = String(message || '').trim().slice(0, 2000);
        if (!cleanMessage) throw new Error('Feedback cannot be empty.');

        const cleanType = type === 'support' ? 'support' : 'feedback';

        const currentTime = now();
        const rateLimit = getRateLimit(userId, currentTime);
        if (!rateLimit.allowed) throw new FeedbackRateLimitError(rateLimit.retryAfterMs);

        const rows = readFeedback();
        const row = {
            id: `${currentTime}-${Math.random().toString(36).slice(2, 8)}`,
            userId: String(userId),
            username: String(username || userId),
            type: cleanType,
            message: cleanMessage,
            messages: [{ direction: 'in', content: cleanMessage, at: new Date(currentTime).toISOString(), source: 'website' }],
            status: 'new',
            createdAt: new Date(currentTime).toISOString()
        };
        rows.unshift(row);
        writeJson(feedbackFilePath, rows.slice(0, 1000));
        writeJson(rateLimitFilePath, [
            ...rateLimit.recentRows,
            { userId: String(userId), submittedAt: currentTime }
        ].slice(-10000));
        return row;
    }

    function updateFeedback(feedbackId, updater) {
        const rows = readFeedback();
        const row = rows.find(entry => String(entry.id) === String(feedbackId));
        if (!row) return null;
        const changes = typeof updater === 'function' ? updater(row) : updater;
        Object.assign(row, changes || {}, { updatedAt: new Date(now()).toISOString() });
        writeJson(feedbackFilePath, rows);
        return row;
    }

    function appendMessage(feedbackId, { direction, content, authorId = null, source = 'discord' }) {
        const cleanContent = String(content || '').trim().slice(0, 2000);
        if (!cleanContent) throw new Error('Message cannot be empty.');
        return updateFeedback(feedbackId, row => ({
            messages: [
                ...(Array.isArray(row.messages) ? row.messages : [{ direction: 'in', content: row.message, at: row.createdAt, source: 'website' }]),
                { direction: direction === 'out' ? 'out' : 'in', content: cleanContent, authorId, source, at: new Date(now()).toISOString() }
            ].slice(-250),
            status: direction === 'out' ? 'answered' : 'new'
        }));
    }

    function findOpenThreadForUser(userId) {
        return readFeedback().find(row => String(row.userId) === String(userId) && row.status !== 'closed') || null;
    }

    function deleteFeedback(feedbackId) {
        const rows = readFeedback();
        const index = rows.findIndex(row => String(row.id) === String(feedbackId));
        if (index < 0) return null;
        const [deleted] = rows.splice(index, 1);
        writeJson(feedbackFilePath, rows);
        return deleted;
    }

    return { addFeedback, appendMessage, deleteFeedback, findOpenThreadForUser, getRateLimit, readFeedback, updateFeedback };
}

const feedbackStore = createFeedbackStore();

module.exports = {
    ...feedbackStore,
    createFeedbackStore,
    FeedbackRateLimitError,
    feedbackCooldownMs,
    feedbackHourlyLimit,
    feedbackHourlyWindowMs
};
