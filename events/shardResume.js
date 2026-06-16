const { applyConfiguredPresence } = require('../utils/presence');

module.exports = {
    name: 'shardResume',

    execute(_shardId, _replayedEvents, client) {
        applyConfiguredPresence(client);
    }
};
