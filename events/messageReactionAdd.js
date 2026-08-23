const { handleStarReaction } = require('../services/community-management-service');

module.exports = {
    name: 'messageReactionAdd',
    async execute(reaction, user) {
        await handleStarReaction(reaction, user).catch(error => console.warn(`Starboard update failed: ${error.message}`));
    }
};
