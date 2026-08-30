const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const panelPreferences = require('./panel-preference-store');
const notificationEvents = new EventEmitter();

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
    const type = String(notification.type || 'general').slice(0, 50);
    const category = /privacy|consent|data/i.test(type) ? 'privacy'
        : /ticket|modmail|support|feedback|report/i.test(type) ? 'support'
            : /moderation|case|incident|automod/i.test(type) ? 'moderation'
                : /workflow|automation/i.test(type) ? 'workflow' : 'general';
    const requestedDelivery = String(notification.delivery || '');
    const delivery = ['dashboard', 'dm', 'both', 'off'].includes(requestedDelivery)
        ? requestedDelivery
        : panelPreferences.readPreferences(userId).notificationDelivery?.[category] || 'dashboard';
    const entry = {
        id: `notification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        category,
        title: String(notification.title || 'Flummi notification').slice(0, 100),
        message: String(notification.message || '').slice(0, 1000),
        guildId: notification.guildId ? String(notification.guildId) : null,
        channelId: notification.channelId ? String(notification.channelId) : null,
        referenceId: notification.referenceId ? String(notification.referenceId) : null,
        href: String(notification.href || '').startsWith('/') ? String(notification.href).slice(0, 500) : null,
        delivery,
        dmDeliveredAt: null,
        createdAt: new Date().toISOString(), readAt: null
    };
    if (delivery !== 'off') writeNotifications(userId, [entry, ...readNotifications(userId)]);
    if (delivery !== 'off') notificationEvents.emit('notification', { userId: String(userId), entry, delivery });
    return entry;
}

function markRead(userId, id = null) {
    const entries = readNotifications(userId);
    const at = new Date().toISOString();
    for (const entry of entries) if (!id || entry.id === id) entry.readAt ||= at;
    writeNotifications(userId, entries);
    return entries;
}

function onNotification(listener) { notificationEvents.on('notification', listener); return () => notificationEvents.off('notification', listener); }

function markDmDelivered(userId, id) {
    const entries = readNotifications(userId);
    const entry = entries.find(row => row.id === id);
    if (entry) entry.dmDeliveredAt = new Date().toISOString();
    writeNotifications(userId, entries);
    return entry || null;
}

function pendingDmNotifications(root = path.join(__dirname, '..', 'data', 'global', 'users')) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).flatMap(entry => readNotifications(entry.name).filter(row => ['dm', 'both'].includes(row.delivery) && !row.dmDeliveredAt).map(row => ({ userId: entry.name, entry: row })));
}

module.exports = { addNotification, markDmDelivered, markRead, onNotification, pendingDmNotifications, readNotifications, writeNotifications };
