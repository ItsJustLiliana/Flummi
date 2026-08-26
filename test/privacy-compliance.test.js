const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectDiscordUserArtifacts, deleteGuildData, deleteUserData, previewUserDeletion } = require('../services/privacy-service');

function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }

test('user deletion removes dedicated data and references from stores and backups', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-privacy-'));
    const userId = '123456789012345678';
    const otherId = '223456789012345678';
    try {
        write(path.join(root, 'global', 'users', userId, 'aiMemory.json'), JSON.stringify({ history: [{ content: 'private' }] }));
        const operationsFile = path.join(root, 'guilds', '333', 'operations.json');
        write(operationsFile, JSON.stringify({ reminders: [{ userId, message: 'mine' }, { userId: otherId, message: `mentions ${userId}` }], levels: { [userId]: { xp: 5 }, [otherId]: { xp: 9 } } }));
        const analyticsFile = path.join(root, 'guilds', '333', 'analytics', 'messages', 'events.ndjson');
        write(analyticsFile, `${JSON.stringify({ userId, count: 1 })}\n${JSON.stringify({ userId: otherId, count: 2 })}\n`);
        const backupFile = path.join(root, 'global', 'backups', '333', 'snapshot', 'operations.json');
        write(backupFile, JSON.stringify({ reports: [{ reporterId: userId }, { reporterId: otherId }] }));

        const preview = previewUserDeletion(userId, { root });
        assert.equal(preview.removedFiles, 1);
        assert.match(fs.readFileSync(operationsFile, 'utf8'), new RegExp(userId));

        const result = deleteUserData(userId, { root });
        assert.equal(fs.existsSync(path.join(root, 'global', 'users', userId)), false);
        assert.ok(result.rewrittenFiles >= 3);
        assert.doesNotMatch(fs.readFileSync(operationsFile, 'utf8'), new RegExp(userId));
        assert.match(fs.readFileSync(operationsFile, 'utf8'), new RegExp(otherId));
        assert.doesNotMatch(fs.readFileSync(analyticsFile, 'utf8'), new RegExp(userId));
        assert.doesNotMatch(fs.readFileSync(backupFile, 'utf8'), new RegExp(userId));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('guild deletion removes only the selected guild and its backups', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-guild-delete-'));
    try {
        write(path.join(root, 'guilds', 'guild-one', 'settings.json'), '{}');
        write(path.join(root, 'guilds', 'guild-two', 'settings.json'), '{}');
        write(path.join(root, 'global', 'backups', 'guild-one', 'one.snapshot', 'settings.json'), '{}');
        deleteGuildData('guild-one', { root });
        assert.equal(fs.existsSync(path.join(root, 'guilds', 'guild-one')), false);
        assert.equal(fs.existsSync(path.join(root, 'global', 'backups', 'guild-one')), false);
        assert.equal(fs.existsSync(path.join(root, 'guilds', 'guild-two')), true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Discord artifact collection finds dedicated user ticket and modmail channels', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-artifacts-'));
    try {
        write(path.join(root, 'guilds', 'guild-one', 'operations.json'), JSON.stringify({ modmail: [{ id: 'm1', userId: 'target-user', channelId: 'channel-one' }, { id: 'm2', userId: 'other', channelId: 'other-channel' }] }));
        write(path.join(root, 'guilds', 'guild-one', 'community-management.json'), JSON.stringify({ tickets: [{ id: 't1', ownerId: 'target-user', channelId: 'channel-two' }] }));
        assert.deepEqual(collectDiscordUserArtifacts('target-user', { root }).map(item => item.channelId).sort(), ['channel-one', 'channel-two']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('privacy commands, consent gate, and abuse reporting are wired into Discord', () => {
    const dataCommand = require('../commands/data').data.toJSON();
    const reportCommand = require('../commands/report').data.toJSON();
    assert.deepEqual(dataCommand.options.map(option => option.name), ['view', 'export', 'delete', 'correct', 'correction-status', 'correction-update', 'ai-consent']);
    assert.deepEqual(reportCommand.options.map(option => option.name), ['submit', 'status', 'update']);
    const modmail = fs.readFileSync(path.join(__dirname, '..', 'services', 'modmail-service.js'), 'utf8');
    const guildDelete = fs.readFileSync(path.join(__dirname, '..', 'events', 'guildDelete.js'), 'utf8');
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    assert.match(modmail, /Nothing is sent until you confirm/);
    assert.match(modmail, /handleModmailConsentInteraction/);
    assert.match(guildDelete, /deleteGuildData\(guild\.id\)/);
    assert.match(index, /GatewayIntentBits\.DirectMessages/);
    const ai = fs.readFileSync(path.join(__dirname, '..', 'services', 'ai-chat.js'), 'utf8');
    const benchmark = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'benchmark-ai-models.js'), 'utf8');
    assert.match(ai, /data_collection: 'deny'/);
    assert.match(ai, /zdr: true/);
    assert.doesNotMatch(ai, /body\.user|body\.session_id/);
    assert.doesNotMatch(ai, /Intern geleerd gebruikersprofiel|userProfile/);
    assert.match(ai, /sanitizeAiMessages\(body\.messages\)/);
    const serverCommand = fs.readFileSync(path.join(__dirname, '..', 'commands', 'server.js'), 'utf8');
    assert.match(serverCommand, /confirmation:SEND TO AI/);
    assert.match(benchmark, /data_collection: 'deny'/);
    assert.match(benchmark, /zdr: true/);
    assert.doesNotMatch(benchmark, /userId|guildId|channelId|session_id/);
    assert.match(index, /MessageManager: 0/);
    assert.match(index, /GuildMemberManager: \{ maxSize: 200/);
    const panel = fs.readFileSync(path.join(__dirname, '..', 'control-panel.js'), 'utf8');
    assert.match(panel, /memberCacheTtlMs = 60 \* 1000/);
    assert.match(panel, /GuildMemberManager: \{ maxSize: 200/);
    const deleted = fs.readFileSync(path.join(__dirname, '..', 'events', 'messageDelete.js'), 'utf8');
    const updated = fs.readFileSync(path.join(__dirname, '..', 'events', 'messageUpdate.js'), 'utf8');
    assert.doesNotMatch(deleted, /message\.content/);
    assert.doesNotMatch(updated, /String\(oldMessage\.content/);
});
