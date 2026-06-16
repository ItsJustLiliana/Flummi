const fs = require('fs');
const path = require('path');
const { readSettings } = require('./settings-store');

const dataDir = path.join(__dirname, '..', 'data');

const defaultTriggerLimit = 500;
const maxAuditEntries = 200;

function readJson(filePath, fallbackValue) {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return raw;
    } catch {
        return fallbackValue;
    }
}

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 4));
}

function resolveGuildPaths(guildId) {
    if (!guildId) {
        return null;
    }

    const base = path.join(dataDir, 'guilds', String(guildId));

    return {
        triggers: path.join(base, 'triggers.json'),
        stats: path.join(base, 'triggerStats.json'),
        audit: path.join(base, 'triggerAudit.json')
    };
}

function getPaths(guildId) {
    return resolveGuildPaths(guildId);
}

function getTriggerLimit(guildId) {
    const settings = readSettings(guildId);
    const limit = Number(settings.maxTriggers);

    if (Number.isFinite(limit) && limit > 0) {
        return Math.floor(limit);
    }

    return defaultTriggerLimit;
}

function getTriggers(guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return [];
    }

    const triggers = readJson(paths.triggers, []);
    return Array.isArray(triggers) ? triggers : [];
}

function saveTriggers(triggers, guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return triggers;
    }

    writeJson(paths.triggers, triggers);
    return triggers;
}

function findTriggerIndex(triggers, phrase) {
    return triggers.findIndex(trigger =>
        typeof trigger.trigger === 'string' &&
        trigger.trigger.toLowerCase() === phrase.toLowerCase()
    );
}

function addTrigger(triggerEntry, guildId) {
    const triggers = getTriggers(guildId);

    if (triggers.length >= getTriggerLimit(guildId)) {
        return { ok: false, reason: 'limit-reached' };
    }

    if (findTriggerIndex(triggers, triggerEntry.trigger) !== -1) {
        return { ok: false, reason: 'duplicate' };
    }

    triggers.push(triggerEntry);
    saveTriggers(triggers, guildId);
    return { ok: true, trigger: triggerEntry };
}

function updateTrigger(phrase, updates, guildId) {
    const triggers = getTriggers(guildId);
    const index = findTriggerIndex(triggers, phrase);

    if (index === -1) {
        return { ok: false, reason: 'not-found' };
    }

    triggers[index] = {
        ...triggers[index],
        ...updates
    };

    saveTriggers(triggers, guildId);
    return { ok: true, trigger: triggers[index] };
}

function removeTrigger(phrase, guildId) {
    const triggers = getTriggers(guildId);
    const index = findTriggerIndex(triggers, phrase);

    if (index === -1) {
        return { ok: false, reason: 'not-found' };
    }

    const removed = triggers.splice(index, 1)[0];
    saveTriggers(triggers, guildId);
    return { ok: true, trigger: removed };
}

function setTriggerStats(phrase, count, guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return;
    }

    const stats = readJson(paths.stats, {});
    stats[phrase.toLowerCase()] = count;
    writeJson(paths.stats, stats);
}

function incrementTriggerStat(phrase, guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return 0;
    }

    const stats = readJson(paths.stats, {});
    const key = phrase.toLowerCase();
    stats[key] = (Number(stats[key]) || 0) + 1;
    writeJson(paths.stats, stats);
    return stats[key];
}

function getTriggerStats(phrase, guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return 0;
    }

    const stats = readJson(paths.stats, {});
    return Number(stats[phrase.toLowerCase()]) || 0;
}

function getAllTriggerStats(guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return {};
    }

    const stats = readJson(paths.stats, {});
    return stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
}

function readAuditLog(guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return [];
    }

    const audit = readJson(paths.audit, []);
    return Array.isArray(audit) ? audit : [];
}

function appendAuditEntry(entry, guildId) {
    const paths = getPaths(guildId);

    if (!paths) {
        return [];
    }

    const audit = readAuditLog(guildId);
    audit.unshift(entry);

    if (audit.length > maxAuditEntries) {
        audit.length = maxAuditEntries;
    }

    writeJson(paths.audit, audit);
    return audit;
}

module.exports = {
    defaultTriggerLimit,
    maxAuditEntries,
    getTriggerLimit,
    getTriggers,
    saveTriggers,
    findTriggerIndex,
    addTrigger,
    updateTrigger,
    removeTrigger,
    incrementTriggerStat,
    getTriggerStats,
    getAllTriggerStats,
    readAuditLog,
    appendAuditEntry
};
