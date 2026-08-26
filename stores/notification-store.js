const fs = require('fs');
const path = require('path');

function filePath(userId) {
    return path.join(__dirname, '..', 'data', 'global', 'users', String(userId), 'notifications.json');
}

function readNotifications(userId) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath(userId), 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function writeNotifications(userId, entries) {
    const target = filePath(userId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(entries.slice(0, 500), null, 2));
    return entries;
}

function addNotification(userId, notification) {
    const entry = {
        id: `notification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type: String(notification.type || 'general').slice(0, 50),
        title: String(notification.title || 'Flummi notification').slice(0, 100),
        message: String(notification.message || '').slice(0, 1000),
        guildId: notification.guildId ? String(notification.guildId) : null,
        channelId: notification.channelId ? String(notification.channelId) : null,
        referenceId: notification.referenceId ? String(notification.referenceId) : null,
        createdAt: new Date().toISOString(), readAt: null
    };
    writeNotifications(userId, [entry, ...readNotifications(userId)]);
    return entry;
}

function markRead(userId, id = null) {
    const entries = readNotifications(userId);
    const at = new Date().toISOString();
    for (const entry of entries) if (!id || entry.id === id) entry.readAt ||= at;
    writeNotifications(userId, entries);
    return entries;
}

module.exports = { addNotification, markRead, readNotifications, writeNotifications };
