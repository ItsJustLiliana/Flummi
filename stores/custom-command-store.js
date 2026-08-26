const fs = require('fs');
const path = require('path');

function filePath(guildId) { return path.join(__dirname, '..', 'data', 'guilds', String(guildId), 'custom-commands.json'); }
function normalizeName(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32); }
function readCommands(guildId) { try { const rows = JSON.parse(fs.readFileSync(filePath(guildId), 'utf8')); return Array.isArray(rows) ? rows : []; } catch { return []; } }
function writeCommands(guildId, rows) { const target = filePath(guildId); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(rows.slice(0, 100), null, 2)); return rows; }
function upsertCommand(guildId, input) {
    const name = normalizeName(input.name);
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error('Command names can only contain lowercase letters, numbers, _ and -.');
    const rows = readCommands(guildId);
    const entry = {
        name, description: String(input.description || 'Custom server command').slice(0, 100),
        responseType: input.responseType === 'embed' ? 'embed' : 'text', content: String(input.content || '').slice(0, 4000),
        imageUrl: /^https?:\/\//i.test(input.imageUrl || '') ? String(input.imageUrl).slice(0, 1000) : '',
        buttons: (Array.isArray(input.buttons) ? input.buttons : []).slice(0, 5).map(button => ({ label: String(button.label || 'Open').slice(0, 80), url: String(button.url || '').slice(0, 1000) })).filter(button => /^https?:\/\//i.test(button.url)),
        requiredRoleId: /^\d{16,22}$/.test(String(input.requiredRoleId || '')) ? String(input.requiredRoleId) : '',
        cooldownSeconds: Math.max(0, Math.min(86400, Number(input.cooldownSeconds) || 0)),
        allowedChannelIds: [...new Set((input.allowedChannelIds || []).map(String).filter(id => /^\d{16,22}$/.test(id)))].slice(0, 25),
        ephemeral: input.ephemeral !== false, enabled: input.enabled !== false, updatedAt: new Date().toISOString()
    };
    const index = rows.findIndex(row => row.name === name);
    if (index >= 0) rows[index] = { ...rows[index], ...entry }; else rows.push({ ...entry, createdAt: entry.updatedAt });
    writeCommands(guildId, rows);
    return entry;
}
function removeCommand(guildId, name) { const normalized = normalizeName(name); const rows = readCommands(guildId); const next = rows.filter(row => row.name !== normalized); writeCommands(guildId, next); return next.length !== rows.length; }
function getCommand(guildId, name) { return readCommands(guildId).find(row => row.name === normalizeName(name)) || null; }
module.exports = { getCommand, normalizeName, readCommands, removeCommand, upsertCommand, writeCommands };
