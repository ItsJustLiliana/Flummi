const { ensureGuildStorage } = require('../utils/guild-storage');
const { setGuildOwner } = require('../stores/access-store');
const { recordActivity } = require('../stores/activity-store');

module.exports = {
    name: 'guildCreate',

    execute(guild) {
        ensureGuildStorage(guild.id);
        setGuildOwner(guild.id, guild.ownerId);
        recordActivity('guild-install', `Installed in ${guild.name}`, { source: 'discord', guildId: guild.id, memberCount: guild.memberCount });
    }
};
