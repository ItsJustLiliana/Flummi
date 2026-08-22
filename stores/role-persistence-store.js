const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data', 'guilds');

function filePath(guildId) {
    return path.join(dataDir, String(guildId), 'management', 'persistent-roles.json');
}

function readAll(guildId) {
    try {
        const value = JSON.parse(fs.readFileSync(filePath(guildId), 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

function writeAll(guildId, value) {
    const target = filePath(guildId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function saveMemberRoles(guildId, userId, roleIds) {
    const records = readAll(guildId);
    records[String(userId)] = { roleIds: [...new Set((roleIds || []).map(String))], savedAt: new Date().toISOString() };
    writeAll(guildId, records);
    return records[String(userId)];
}

function takeMemberRoles(guildId, userId) {
    const records = readAll(guildId);
    const result = records[String(userId)] || null;
    delete records[String(userId)];
    writeAll(guildId, records);
    return result;
}

module.exports = { saveMemberRoles, takeMemberRoles };
