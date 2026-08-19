const { ensureGuildStorage } = require('../utils/guild-storage');
const { setGuildOwner } = require('../stores/access-store');

module.exports = {
    name: 'guildCreate',

    execute(guild) {
        ensureGuildStorage(guild.id);
        setGuildOwner(guild.id, guild.ownerId);
    }
};
