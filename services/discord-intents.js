const { GatewayIntentBits } = require('discord.js');

const BOT_GATEWAY_INTENTS = Object.freeze([
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
]);

module.exports = { BOT_GATEWAY_INTENTS };
