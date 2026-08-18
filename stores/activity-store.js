const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'runtime', 'activity.json');
const maxEntries = 500;

function readActivity() {
    try {
        const entries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(entries) ? entries : [];
    } catch { return []; }
}

function recordActivity(type, message, details = {}) {
    const entries = readActivity();
    entries.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), type, message, ...details });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entries.slice(0, maxEntries), null, 2));
}

module.exports = { readActivity, recordActivity };
