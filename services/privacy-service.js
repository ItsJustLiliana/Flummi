const fs = require('fs');
const path = require('path');

const dataRoot = path.resolve(__dirname, '..', 'data');
const identityFields = new Set([
    'userId', 'authorId', 'ownerId', 'targetId', 'memberId', 'openerId', 'reporterId',
    'actorId', 'moderatorId', 'claimedBy', 'assignedTo', 'closedBy', 'reviewedBy',
    'reopenedBy', 'creatorId', 'submittedByUserId', 'byId'
]);
const removableExtensions = new Set(['.json', '.ndjson', '.log', '.txt', '.html']);
const DELETE = Symbol('delete');

function safeIdentifier(value, label) {
    const id = String(value || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`Invalid ${label}.`);
    return id;
}

function assertWithin(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe deletion target.');
    return target;
}

function walkFiles(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(root, entry.name);
        return entry.isDirectory() ? walkFiles(target) : [target];
    });
}

function directIdentityMatch(value, userId) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && [...identityFields].some(field => String(value[field] || '') === userId);
}

function scrubValue(value, userId, arrayEntry = false) {
    if (arrayEntry && directIdentityMatch(value, userId)) return DELETE;
    // Several stores serialize Maps as [key, record] tuples. Remove the full
    // tuple when its record belongs to the user instead of leaving an orphaned
    // key behind.
    if (arrayEntry && Array.isArray(value) && value.some(item => directIdentityMatch(item, userId))) return DELETE;
    if (typeof value === 'string') {
        if (value === userId) return DELETE;
        return value.includes(userId) ? value.split(userId).join('[deleted-user]') : value;
    }
    if (Array.isArray(value)) {
        return value.map(item => scrubValue(item, userId, true)).filter(item => item !== DELETE);
    }
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
        if (key === userId) continue;
        const next = scrubValue(child, userId, false);
        if (next !== DELETE) output[key] = next;
    }
    return output;
}

function atomicWrite(filePath, content) {
    const temporary = `${filePath}.${process.pid}.privacy.tmp`;
    fs.writeFileSync(temporary, content);
    fs.renameSync(temporary, filePath);
}

function rewriteFile(filePath, userId, dryRun) {
    const original = fs.readFileSync(filePath, 'utf8');
    if (!original.includes(userId)) return null;
    const extension = path.extname(filePath).toLowerCase();
    let output;
    if (extension === '.json') {
        try { output = `${JSON.stringify(scrubValue(JSON.parse(original), userId), null, 2)}\n`; }
        catch { output = original.split(userId).join('[deleted-user]'); }
    } else if (extension === '.ndjson') {
        output = original.split('\n').flatMap(line => {
            if (!line.trim()) return [];
            try {
                const parsed = JSON.parse(line);
                if (directIdentityMatch(parsed, userId)) return [];
                return [JSON.stringify(scrubValue(parsed, userId))];
            } catch { return [line.split(userId).join('[deleted-user]')]; }
        }).join('\n');
        if (output) output += '\n';
    } else {
        output = original.split(userId).join('[deleted-user]');
    }
    if (output === original) return null;
    if (!dryRun) atomicWrite(filePath, output);
    return { filePath, bytesBefore: Buffer.byteLength(original), bytesAfter: Buffer.byteLength(output) };
}

function directUserTargets(userId, root = dataRoot) {
    return [
        path.join(root, 'global', 'users', userId),
        path.join(root, 'global', 'users', `${userId}.json`),
        path.join(root, 'users', `${userId}.json`)
    ];
}

function removeTarget(target, dryRun, root = dataRoot) {
    if (!fs.existsSync(target)) return null;
    assertWithin(root, target);
    const files = fs.statSync(target).isDirectory() ? walkFiles(target) : [target];
    const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
    if (!dryRun) fs.rmSync(target, { recursive: true, force: true });
    return { target, files: files.length, bytes };
}

function processUserData(userId, { dryRun = false, root = dataRoot } = {}) {
    const id = safeIdentifier(userId, 'user ID');
    const resolvedRoot = path.resolve(root);
    const removedTargets = directUserTargets(id, resolvedRoot).map(target => removeTarget(target, dryRun, resolvedRoot)).filter(Boolean);
    const directFiles = new Set(removedTargets.flatMap(entry => fs.existsSync(entry.target) && fs.statSync(entry.target).isDirectory() ? walkFiles(entry.target) : [entry.target]));
    const rewritten = walkFiles(resolvedRoot)
        .filter(file => removableExtensions.has(path.extname(file).toLowerCase()) && !directFiles.has(file))
        .map(file => rewriteFile(file, id, dryRun))
        .filter(Boolean);
    return {
        dryRun,
        removedFiles: removedTargets.reduce((total, entry) => total + entry.files, 0),
        removedBytes: removedTargets.reduce((total, entry) => total + entry.bytes, 0),
        rewrittenFiles: rewritten.length,
        backupsIncluded: rewritten.some(entry => entry.filePath.includes(`${path.sep}global${path.sep}backups${path.sep}`))
    };
}

function previewUserDeletion(userId, options = {}) { return processUserData(userId, { ...options, dryRun: true }); }
function deleteUserData(userId, options = {}) { return processUserData(userId, { ...options, dryRun: false }); }

function collectDiscordUserArtifacts(userId, { root = dataRoot } = {}) {
    const id = safeIdentifier(userId, 'user ID');
    const guildsRoot = path.join(path.resolve(root), 'guilds');
    if (!fs.existsSync(guildsRoot)) return [];
    const artifacts = [];
    for (const guildEntry of fs.readdirSync(guildsRoot, { withFileTypes: true })) {
        if (!guildEntry.isDirectory()) continue;
        const guildId = guildEntry.name;
        const sources = [
            { file: 'operations.json', collection: 'modmail', identity: 'userId', kind: 'modmail' },
            { file: 'community-management.json', collection: 'tickets', identity: 'ownerId', kind: 'ticket' }
        ];
        for (const source of sources) {
            try {
                const state = JSON.parse(fs.readFileSync(path.join(guildsRoot, guildId, source.file), 'utf8'));
                for (const record of Array.isArray(state[source.collection]) ? state[source.collection] : []) {
                    if (String(record[source.identity] || '') === id && record.channelId) artifacts.push({ guildId, channelId: String(record.channelId), kind: source.kind, recordId: record.id || null });
                }
            } catch {
                // Missing or unreadable stores contain no actionable locator.
            }
        }
    }
    return [...new Map(artifacts.map(item => [`${item.guildId}:${item.channelId}`, item])).values()];
}

async function deleteDiscordUserArtifacts(client, userId, options = {}) {
    const artifacts = collectDiscordUserArtifacts(userId, options);
    let deletedChannels = 0;
    const failures = [];
    for (const artifact of artifacts) {
        try {
            const guild = client.guilds.cache.get(artifact.guildId) || await client.guilds.fetch(artifact.guildId).catch(() => null);
            const channel = guild && (guild.channels.cache.get(artifact.channelId) || await guild.channels.fetch(artifact.channelId).catch(() => null));
            if (!channel) continue;
            await channel.delete(`Flummi user data deletion (${artifact.kind})`);
            deletedChannels += 1;
        } catch (error) {
            failures.push({ ...artifact, error: error?.message || 'Deletion failed' });
        }
    }
    return { locatedChannels: artifacts.length, deletedChannels, failures };
}

function deleteGuildData(guildId, { root = dataRoot } = {}) {
    const id = safeIdentifier(guildId, 'guild ID');
    const resolvedRoot = path.resolve(root);
    const targets = [path.join(resolvedRoot, 'guilds', id), path.join(resolvedRoot, 'global', 'backups', id)];
    const removed = targets.map(target => removeTarget(target, false, resolvedRoot)).filter(Boolean);
    return { guildId: id, removedFiles: removed.reduce((total, entry) => total + entry.files, 0), removedBytes: removed.reduce((total, entry) => total + entry.bytes, 0) };
}

module.exports = { collectDiscordUserArtifacts, dataRoot, deleteDiscordUserArtifacts, deleteGuildData, deleteUserData, previewUserDeletion, scrubValue };
