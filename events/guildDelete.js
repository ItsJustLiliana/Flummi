const { deleteGuildData } = require('../services/privacy-service');

module.exports = {
    name: 'guildDelete',
    execute(guild) {
        const result = deleteGuildData(guild.id);
        console.log(`Removed from a Discord server; deleted ${result.removedFiles} local guild data file(s), including stored backups.`);
    }
};
