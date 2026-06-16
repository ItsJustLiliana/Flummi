const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { loadEnv } = require('./utils/env-loader');
const config = require('./config.json');

loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

const host = '127.0.0.1';
const port = 3789;
const openBrowserOnStart = true;
const indexPath = path.join(__dirname, 'panel', 'index.html');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

let server = null;

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
}

function openBrowser(url) {
    const escapedUrl = `"${url}"`;

    if (process.platform === 'win32') {
        exec(`start "" ${escapedUrl}`);
        return;
    }

    if (process.platform === 'darwin') {
        exec(`open ${escapedUrl}`);
        return;
    }

    exec(`xdg-open ${escapedUrl}`);
}

function isSendableGuildTextChannel(channel) {
    return channel && (
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.GuildAnnouncement
    );
}

async function listGuilds() {
    await client.guilds.fetch();

    return Array.from(client.guilds.cache.values())
        .map(guild => ({ id: guild.id, name: guild.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

async function listChannels(guildId) {
    const guild = await client.guilds.fetch(guildId);

    if (!guild) {
        return [];
    }

    await guild.channels.fetch();

    const me = guild.members.me || await guild.members.fetchMe();

    return Array.from(guild.channels.cache.values())
        .filter(channel => isSendableGuildTextChannel(channel))
        .filter(channel => channel.viewable)
        .filter(channel => {
            const permissions = channel.permissionsFor(me);
            return permissions && permissions.has('SendMessages');
        })
        .map(channel => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;

            if (body.length > 20000) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function normalizeImageUrls(imageUrls) {
    if (!imageUrls) {
        return [];
    }

    if (!Array.isArray(imageUrls)) {
        throw new Error('imageUrls must be an array.');
    }

    const normalized = imageUrls
        .map(value => String(value || '').trim())
        .filter(Boolean);

    if (normalized.length > 4) {
        throw new Error('You can send up to 4 image URLs at once.');
    }

    for (const imageUrl of normalized) {
        let parsed;

        try {
            parsed = new URL(imageUrl);
        } catch {
            throw new Error(`Invalid image URL: ${imageUrl}`);
        }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error(`Image URL must use http or https: ${imageUrl}`);
        }
    }

    return normalized;
}

function buildAllowedMentions(allowEveryoneMentions) {
    const parse = ['users', 'roles'];

    if (allowEveryoneMentions) {
        parse.push('everyone');
    }

    return {
        parse,
        repliedUser: false
    };
}

async function sendComposedMessage(guildId, channelId, content, imageUrls, allowEveryoneMentions) {
    const trimmed = typeof content === 'string' ? content.trim() : '';
    const files = normalizeImageUrls(imageUrls);

    if (!trimmed && files.length === 0) {
        throw new Error('Add message text or at least one image URL.');
    }

    if (trimmed.length > 2000) {
        throw new Error('Message exceeds Discord limit of 2000 characters.');
    }

    const channel = await client.channels.fetch(channelId);

    if (!channel || !isSendableGuildTextChannel(channel)) {
        throw new Error('Selected channel is not a guild text channel.');
    }

    if (channel.guildId !== guildId) {
        throw new Error('Channel does not belong to the selected guild.');
    }

    const sent = await channel.send({
        content: trimmed || undefined,
        files,
        allowedMentions: buildAllowedMentions(Boolean(allowEveryoneMentions))
    });

    return {
        id: sent.id,
        url: sent.url
    };
}

function createServer() {
    return http.createServer(async (req, res) => {
        try {
            const requestUrl = new URL(req.url, `http://${req.headers.host}`);

            if (req.method === 'GET' && requestUrl.pathname === '/') {
                const html = fs.readFileSync(indexPath, 'utf8');
                sendHtml(res, html);
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/guilds') {
                const guilds = await listGuilds();
                sendJson(res, 200, { guilds });
                return;
            }

            if (req.method === 'GET' && requestUrl.pathname === '/api/channels') {
                const guildId = requestUrl.searchParams.get('guildId');

                if (!guildId) {
                    sendJson(res, 400, { error: 'guildId is required.' });
                    return;
                }

                const channels = await listChannels(guildId);
                sendJson(res, 200, { channels });
                return;
            }

            if (req.method === 'POST' && requestUrl.pathname === '/api/send') {
                const rawBody = await readBody(req);
                const parsed = JSON.parse(rawBody || '{}');

                const guildId = parsed.guildId;
                const channelId = parsed.channelId;
                const content = parsed.content;
                const imageUrls = parsed.imageUrls;
                const allowEveryoneMentions = parsed.allowEveryoneMentions;

                if (!guildId || !channelId) {
                    sendJson(res, 400, { error: 'guildId and channelId are required.' });
                    return;
                }

                const result = await sendComposedMessage(
                    guildId,
                    channelId,
                    content,
                    imageUrls,
                    allowEveryoneMentions
                );
                sendJson(res, 200, { ok: true, message: result });
                return;
            }

            sendJson(res, 404, { error: 'Not found.' });
        } catch (error) {
            sendJson(res, 500, { error: error.message || 'Internal server error.' });
        }
    });
}

async function start() {
    if (!botToken) {
        throw new Error('Missing bot token. Set DISCORD_BOT_TOKEN in .env.');
    }

    await client.login(botToken);

    const url = `http://${host}:${port}`;

    server = createServer();
    server.listen(port, host, () => {
        console.log(`Bot control panel running at ${url}`);

        if (openBrowserOnStart) {
            openBrowser(url);
        }
    });
}

function shutdown() {
    if (server) {
        server.close();
    }

    client.destroy();
}

process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
});

start().catch(error => {
    console.error('Failed to start control panel:', error);
    process.exit(1);
});
