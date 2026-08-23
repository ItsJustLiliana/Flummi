const { recordActivity } = require('../stores/activity-store');

module.exports = {
    name: 'guildDelete',
    execute(guild) {
        recordActivity('guild-remove', `Removed from ${guild.name}`, { source: 'discord', guildId: guild.id, memberCount: guild.memberCount });
    }
};
