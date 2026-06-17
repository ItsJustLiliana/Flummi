const { ensureGlobalStorage, ensureGuildStorage } = require('../utils/guild-storage');
const { applyConfiguredPresence } = require('../utils/presence');

module.exports = {
    name: 'clientReady',
    once: true,

    execute(client) {
        ensureGlobalStorage();

        for (const guild of client.guilds.cache.values()) {
            ensureGuildStorage(guild.id);
        }

        applyConfiguredPresence(client);

        console.log('Bot is online');
    }
};
