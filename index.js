const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { installTimestampedConsole } = require('./utils/logger');
const { loadEnv } = require('./utils/env-loader');
const { localPath, readConfig } = require('./utils/config');
const { applyConfiguredPresence } = require('./utils/presence');
const { recordSystemPingMetrics } = require('./stores/ping-metrics-store');
const config = readConfig();

installTimestampedConsole();
loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.commands = new Collection();

const DISCORD_HEALTH_CHECK_INTERVAL_MS = 30 * 1000;

async function recordAutomaticDiscordLatency() {
    const gatewayLatency = Number.isFinite(client.ws.ping) ? Math.max(0, Math.round(client.ws.ping)) : null;
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch('https://discord.com/api/v10/gateway', { signal: controller.signal });
        recordSystemPingMetrics({
            gatewayLatency,
            apiLatency: Date.now() - startedAt,
            apiStatus: response.status
        });
    } catch (error) {
        recordSystemPingMetrics({
            gatewayLatency,
            apiLatency: null,
            apiStatus: error?.name === 'AbortError' ? 'Timed out' : 'Unavailable'
        });
    } finally {
        clearTimeout(timeout);
    }
}

client.once('clientReady', () => {
    recordAutomaticDiscordLatency().catch(() => {});
    setInterval(() => recordAutomaticDiscordLatency().catch(() => {}), DISCORD_HEALTH_CHECK_INTERVAL_MS);
});

let presenceReloadTimer = null;
fs.watch(path.dirname(localPath), (_eventType, filename) => {
    if (filename !== path.basename(localPath)) return;

    clearTimeout(presenceReloadTimer);
    presenceReloadTimer = setTimeout(() => {
        applyConfiguredPresence(client);
        console.log('Updated Discord presence from panel configuration.');
    }, 150);
});

const commandFiles = fs
    .readdirSync('./commands')
    .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

const eventFiles = fs
    .readdirSync('./events')
    .filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const event = require(`./events/${file}`);

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

if (!botToken) {
    throw new Error('Missing bot token. Set DISCORD_BOT_TOKEN in .env.');
}

client.login(botToken);
