const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GatewayIntentBits } = require('discord.js');
const { BOT_GATEWAY_INTENTS } = require('../services/discord-intents');
const { canSendAiContent } = require('../services/ai-consent-service');
const { deleteGuildData, deleteUserData } = require('../services/privacy-service');
const { formatLogArgument } = require('../utils/logger');
const { recordMessageEvent } = require('../stores/analytics-store');
const { incrementMessageStats } = require('../stores/server-stats-store');
const { appendPingRequest, readPingRequests } = require('../stores/ping-request-store');

const repositoryRoot = path.join(__dirname, '..');
function guildRoot(guildId) { return path.join(repositoryRoot, 'data', 'guilds', guildId); }
function cleanupGuild(guildId) { fs.rmSync(guildRoot(guildId), { recursive: true, force: true }); }
function readTree(root) {
    if (!fs.existsSync(root)) return '';
    return fs.readdirSync(root, { withFileTypes: true }).map(entry => {
        const target = path.join(root, entry.name);
        return entry.isDirectory() ? readTree(target) : fs.readFileSync(target, 'utf8');
    }).join('\n');
}
function write(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

test('general analytics derive metadata without persisting raw Discord message content', () => {
    const guildId = `test-content-analytics-${process.pid}`;
    const secret = 'ordinary guild text that must not be retained';
    cleanupGuild(guildId);
    try {
        recordMessageEvent({
            guildId, channelId: 'channel', channelName: 'general', userId: 'user', userTag: 'Member',
            message: { id: 'message', content: secret, attachments: new Map(), embeds: [], stickers: new Map(), reactions: { cache: new Map() }, reference: null, channel: { isThread: () => false } }
        });
        const stored = readTree(path.join(guildRoot(guildId), 'analytics'));
        assert.doesNotMatch(stored, new RegExp(secret));
        assert.equal(JSON.parse(stored.trim()).characters, secret.length);
    } finally { cleanupGuild(guildId); }
});

test('normal message-stat tracking ignores unexpected message text', () => {
    const guildId = `test-content-stats-${process.pid}`;
    const secret = 'message text passed by mistake';
    cleanupGuild(guildId);
    try {
        incrementMessageStats({ guildId, channelId: 'channel', channelName: 'general', userId: 'user', userTag: 'Member', messageId: 'message', content: secret });
        assert.doesNotMatch(readTree(guildRoot(guildId)), new RegExp(secret));
    } finally { cleanupGuild(guildId); }
});

test('an explicit saved-ping feature can still retain the requested message', () => {
    const guildId = `test-content-ping-${process.pid}`;
    cleanupGuild(guildId);
    try {
        appendPingRequest({ byId: 'requester', at: new Date().toISOString(), content: [{ sendById: 'author', message: 'save this requested text' }] }, guildId);
        assert.equal(readPingRequests(guildId)[0].content[0].message, 'save this requested text');
    } finally { cleanupGuild(guildId); }
});

test('the external AI gate rejects content unless consent exists', () => {
    let checks = 0;
    assert.equal(canSendAiContent('user', () => { checks++; return false; }), false);
    assert.equal(canSendAiContent('user', () => { checks++; return true; }), true);
    assert.equal(checks, 2);
});

test('user deletion removes shared references, backups, AI memory, and matching ticket transcripts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-content-delete-'));
    const userId = '123456789012345678';
    try {
        write(path.join(root, 'global', 'users', userId, 'aiMemory.json'), { history: [{ content: 'private prompt' }] });
        write(path.join(root, 'guilds', 'guild', 'operations.json'), { modmail: [{ userId, messages: [{ content: 'private modmail' }] }] });
        write(path.join(root, 'global', 'backups', 'guild', 'copy.snapshot', 'operations.json'), { reports: [{ reporterId: userId, reason: 'private report' }] });
        const transcript = path.join(root, 'guilds', 'guild', 'tickets', 'transcripts', 'ticket', 'ticket.txt');
        const backupTranscript = path.join(root, 'global', 'backups', 'guild', 'copy.snapshot', 'tickets', 'transcripts', 'ticket', 'ticket.json');
        write(transcript, `${userId}: private ticket content`);
        write(backupTranscript, { messages: [{ author: { id: userId }, content: 'private backed-up ticket content' }] });
        const result = deleteUserData(userId, { root });
        assert.equal(result.removedTranscriptFiles, 2);
        assert.equal(result.backupsIncluded, true);
        assert.equal(fs.existsSync(path.join(root, 'global', 'users', userId)), false);
        assert.equal(fs.existsSync(transcript), false);
        assert.equal(fs.existsSync(backupTranscript), false);
        assert.doesNotMatch(readTree(root), new RegExp(userId));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('guild removal deletes guild data, backups, and guild-scoped activity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-content-guild-delete-'));
    try {
        write(path.join(root, 'guilds', 'guild-one', 'settings.json'), {});
        write(path.join(root, 'global', 'backups', 'guild-one', 'copy.snapshot', 'settings.json'), {});
        write(path.join(root, 'runtime', 'activity.json'), [{ guildId: 'guild-one', message: 'remove' }, { guildId: 'guild-two', message: 'keep' }]);
        const result = deleteGuildData('guild-one', { root });
        assert.equal(result.removedActivityEntries, 1);
        assert.equal(fs.existsSync(path.join(root, 'guilds', 'guild-one')), false);
        assert.equal(fs.existsSync(path.join(root, 'global', 'backups', 'guild-one')), false);
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'runtime', 'activity.json'))).map(row => row.guildId), ['guild-two']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('persistent log formatting redacts message-content fields recursively', () => {
    const secret = 'raw Discord message content';
    const formatted = formatLogArgument({ event: 'messageCreate', content: secret, referencedMessage: { content: secret }, metadata: { prompt: secret } });
    assert.doesNotMatch(formatted, new RegExp(secret));
    assert.match(formatted, /\[redacted\]/);
});

test('the bot requests exactly the gateway intents required by current functionality', () => {
    assert.deepEqual(BOT_GATEWAY_INTENTS, [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ]);
    assert.equal(BOT_GATEWAY_INTENTS.includes(GatewayIntentBits.GuildPresences), false);
});
