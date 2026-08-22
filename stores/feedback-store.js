const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'global', 'feedback.json');

function readFeedback() {
    try {
        const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(rows) ? rows : [];
    } catch {
        return [];
    }
}

function addFeedback({ userId, username, message }) {
    const cleanMessage = String(message || '').trim().slice(0, 2000);
    if (!cleanMessage) throw new Error('Feedback cannot be empty.');
    const rows = readFeedback();
    const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: String(userId),
        username: String(username || userId),
        message: cleanMessage,
        status: 'new',
        createdAt: new Date().toISOString()
    };
    rows.unshift(row);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(rows.slice(0, 1000), null, 2)}\n`);
    return row;
}

module.exports = { addFeedback, readFeedback };
