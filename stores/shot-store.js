const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const maxAuditEntries = 200;

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

function resolveGuildFolder(guildId) {
    if (!guildId) {
        return null;
    }

    return path.join(dataDir, 'guilds', String(guildId));
}

function resolveGuildShotsPath(guildId) {
    const folder = resolveGuildFolder(guildId);
    return folder ? path.join(folder, 'shots.json') : null;
}

function resolveGuildShotAuditPath(guildId) {
    const folder = resolveGuildFolder(guildId);
    return folder ? path.join(folder, 'shotAudit.json') : null;
}

function getShotRecord(guildId) {
    const filePath = resolveGuildShotsPath(guildId);

    if (!filePath) {
        return {};
    }

    const record = readJson(filePath, {});
    return record && typeof record === 'object' && !Array.isArray(record)
        ? record
        : {};
}

function saveShotRecord(record, guildId) {
    const filePath = resolveGuildShotsPath(guildId);

    if (!filePath) {
        return {};
    }

    writeJson(filePath, record);
    return record;
}

function readShotAuditLog(guildId) {
    const filePath = resolveGuildShotAuditPath(guildId);

    if (!filePath) {
        return [];
    }

    const audit = readJson(filePath, []);
    return Array.isArray(audit) ? audit : [];
}

function appendShotAuditEntry(entry, guildId) {
    const filePath = resolveGuildShotAuditPath(guildId);

    if (!filePath) {
        return [];
    }

    const audit = readShotAuditLog(guildId);
    audit.unshift(entry);

    if (audit.length > maxAuditEntries) {
        audit.length = maxAuditEntries;
    }

    writeJson(filePath, audit);
    return audit;
}

function normalizeShotEntry(entry) {
    const safeEntry = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? entry
        : {};

    return {
        total: Number.isFinite(safeEntry.total) && safeEntry.total >= 0
            ? Math.floor(safeEntry.total)
            : 0,
        lastUpdatedAt: typeof safeEntry.lastUpdatedAt === 'string'
            ? safeEntry.lastUpdatedAt
            : null,
        lastUpdatedById: typeof safeEntry.lastUpdatedById === 'string'
            ? safeEntry.lastUpdatedById
            : null
    };
}

function formatTimestamp(date) {
    const pad = value => String(value).padStart(2, '0');

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getShots(userId, guildId) {
    const record = getShotRecord(guildId);
    return normalizeShotEntry(record[userId]).total;
}

function setShots(userId, amount, guildId, updatedById, auditContext = null) {
    const record = getShotRecord(guildId);
    const previous = normalizeShotEntry(record[userId]);
    const nextAmount = Number.isFinite(amount) && amount >= 0 ? Math.floor(amount) : 0;

    record[userId] = {
        ...previous,
        total: nextAmount,
        lastUpdatedAt: formatTimestamp(new Date()),
        lastUpdatedById: updatedById || null
    };

    saveShotRecord(record, guildId);

    if (auditContext) {
        appendShotAuditEntry({
            action: auditContext.action || 'set',
            targetUserId: userId,
            byUserId: updatedById || null,
            amount: Number.isFinite(auditContext.amount) ? Math.floor(auditContext.amount) : null,
            previousTotal: previous.total,
            newTotal: record[userId].total,
            maxShots: Number.isFinite(auditContext.maxShots) ? Math.floor(auditContext.maxShots) : null,
            at: record[userId].lastUpdatedAt
        }, guildId);
    }

    return normalizeShotEntry(record[userId]);
}

function addShots(userId, amount, guildId, updatedById) {
    const current = getShots(userId, guildId);
    return setShots(userId, current + amount, guildId, updatedById, {
        action: 'add',
        amount
    });
}

function removeShots(userId, amount, guildId, updatedById) {
    const current = getShots(userId, guildId);
    return setShots(userId, Math.max(0, current - amount), guildId, updatedById, {
        action: 'remove',
        amount
    });
}

function getShotLeaderboard(guildId, limit = 10) {
    const record = getShotRecord(guildId);

    return Object.entries(record)
        .map(([userId, entry]) => ({
            userId,
            ...normalizeShotEntry(entry)
        }))
        .filter(entry => entry.total > 0)
        .sort((left, right) => right.total - left.total)
        .slice(0, limit);
}

function getGlobalShotLeaderboard(limit = 10) {
    const guildsDir = path.join(dataDir, 'guilds');
    const aggregate = {};

    if (!fs.existsSync(guildsDir)) {
        return [];
    }

    for (const entry of fs.readdirSync(guildsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const guildId = entry.name;
        const record = getShotRecord(guildId);

        for (const [userId, value] of Object.entries(record)) {
            const normalized = normalizeShotEntry(value);

            if (!aggregate[userId]) {
                aggregate[userId] = {
                    userId,
                    total: 0,
                    guildCount: 0,
                    lastUpdatedAt: normalized.lastUpdatedAt
                };
            }

            aggregate[userId].total += normalized.total;

            if (normalized.total > 0) {
                aggregate[userId].guildCount += 1;
            }

            if (
                normalized.lastUpdatedAt &&
                (!aggregate[userId].lastUpdatedAt || normalized.lastUpdatedAt > aggregate[userId].lastUpdatedAt)
            ) {
                aggregate[userId].lastUpdatedAt = normalized.lastUpdatedAt;
            }
        }
    }

    return Object.values(aggregate)
        .filter(entry => entry.total > 0)
        .sort((left, right) => right.total - left.total)
        .slice(0, limit);
}

function getShotWeights(maxShots) {
    const safeMax = Number.isFinite(maxShots) && maxShots > 0
        ? Math.floor(maxShots)
        : 5;

    const weights = [];
    let totalWeight = 0;

    for (let shotCount = 1; shotCount <= safeMax; shotCount += 1) {
        const weight = 1 / (2 ** (shotCount - 1));
        totalWeight += weight;
        weights.push({ shotCount, weight });
    }

    return {
        maxShots: safeMax,
        totalWeight,
        weights
    };
}

function rollShotGamble(maxShots) {
    const { maxShots: safeMax, totalWeight, weights } = getShotWeights(maxShots);
    let roll = Math.random() * totalWeight;

    for (const entry of weights) {
        roll -= entry.weight;

        if (roll <= 0) {
            return {
                result: entry.shotCount,
                maxShots: safeMax,
                weights
            };
        }
    }

    return {
        result: safeMax,
        maxShots: safeMax,
        weights
    };
}

function gambleShots(userId, guildId, maxShots, updatedById) {
    const roll = rollShotGamble(maxShots);
    const current = getShots(userId, guildId);
    const updated = setShots(userId, current + roll.result, guildId, updatedById, {
        action: 'gamble',
        amount: roll.result,
        maxShots: roll.maxShots
    });

    return {
        rolledShots: roll.result,
        maxShots: roll.maxShots,
        weights: roll.weights,
        total: updated.total,
        lastUpdatedAt: updated.lastUpdatedAt
    };
}

module.exports = {
    maxAuditEntries,
    getShots,
    setShots,
    addShots,
    removeShots,
    getShotLeaderboard,
    getGlobalShotLeaderboard,
    readShotAuditLog,
    appendShotAuditEntry,
    getShotWeights,
    rollShotGamble,
    gambleShots
};