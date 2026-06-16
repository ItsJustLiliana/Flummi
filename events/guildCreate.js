const { ensureGuildStorage } = require('../utils/guild-storage');

module.exports = {
    name: 'guildCreate',

    execute(guild) {
        ensureGuildStorage(guild.id);
    }
};
