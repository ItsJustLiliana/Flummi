const { applyConfiguredPresence } = require('../utils/presence');

module.exports = {
    name: 'shardReady',

    execute(_shardId, _unavailableGuilds, client) {
        applyConfiguredPresence(client);
    }
};
