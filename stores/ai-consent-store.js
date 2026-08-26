const fs = require('fs');
const { ensureGlobalUserDir, getGlobalUserFilePath } = require('../utils/global-user-storage');

function filePath(userId) { return getGlobalUserFilePath(userId, 'aiConsent.json'); }
function readAiConsent(userId) {
    try {
        const value = JSON.parse(fs.readFileSync(filePath(userId), 'utf8'));
        return value?.status === 'granted' ? value : { status: 'withdrawn', updatedAt: value?.updatedAt || null };
    } catch { return { status: 'unknown', updatedAt: null }; }
}
function setAiConsent(userId, granted) {
    const target = filePath(userId);
    if (!target) return null;
    ensureGlobalUserDir(userId);
    const value = { status: granted ? 'granted' : 'withdrawn', updatedAt: new Date().toISOString(), version: 1 };
    fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
    return value;
}
function hasAiConsent(userId) { return readAiConsent(userId).status === 'granted'; }

module.exports = { hasAiConsent, readAiConsent, setAiConsent };
