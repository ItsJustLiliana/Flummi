const fs = require('fs');
const path = require('path');

function getUsagePath() {
    return process.env.SERPER_USAGE_FILE || path.join(__dirname, '..', 'data', 'runtime', 'serperUsage.json');
}

function todayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function emptyUsage() {
    return {
        requests: {
            total: 0,
            successful: 0,
            failed: 0,
            byDate: {}
        },
        lastRequestAt: '',
        lastStatusCode: null
    };
}

function readJson(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function normalizeUsage(raw) {
    const usage = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const requests = usage.requests && typeof usage.requests === 'object' && !Array.isArray(usage.requests)
        ? usage.requests
        : {};

    return {
        requests: {
            total: Number(requests.total) || 0,
            successful: Number(requests.successful) || 0,
            failed: Number(requests.failed) || 0,
            byDate: requests.byDate && typeof requests.byDate === 'object' && !Array.isArray(requests.byDate)
                ? requests.byDate
                : {}
        },
        lastRequestAt: typeof usage.lastRequestAt === 'string' ? usage.lastRequestAt : '',
        lastStatusCode: Number.isFinite(Number(usage.lastStatusCode)) ? Number(usage.lastStatusCode) : null
    };
}

function readSerperUsage() {
    return normalizeUsage(readJson(getUsagePath(), emptyUsage()));
}

function saveSerperUsage(usage) {
    const normalized = normalizeUsage(usage);
    writeJson(getUsagePath(), normalized);
    return normalized;
}

function recordSerperImageSearch({ statusCode, ok, at = new Date() } = {}) {
    const usage = readSerperUsage();
    const day = todayKey(at);
    const currentDay = usage.requests.byDate[day] && typeof usage.requests.byDate[day] === 'object'
        ? usage.requests.byDate[day]
        : {};

    usage.requests.total += 1;

    if (ok) {
        usage.requests.successful += 1;
    } else {
        usage.requests.failed += 1;
    }

    usage.requests.byDate[day] = {
        total: (Number(currentDay.total) || 0) + 1,
        successful: (Number(currentDay.successful) || 0) + (ok ? 1 : 0),
        failed: (Number(currentDay.failed) || 0) + (ok ? 0 : 1)
    };
    usage.lastRequestAt = at.toISOString();
    usage.lastStatusCode = Number.isFinite(Number(statusCode)) ? Number(statusCode) : null;

    return saveSerperUsage(usage);
}

module.exports = {
    emptyUsage,
    readSerperUsage,
    recordSerperImageSearch,
    saveSerperUsage,
    todayKey
};
