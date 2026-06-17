const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { installTimestampedConsole } = require('./utils/logger');
const { loadEnv } = require('./utils/env-loader');
const config = require('./config.json');

installTimestampedConsole();
loadEnv();

const botToken = process.env.DISCORD_BOT_TOKEN || config.token;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

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
