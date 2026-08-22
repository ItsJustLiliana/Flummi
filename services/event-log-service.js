const { readSettings } = require('../stores/settings-store');
const { addEvent } = require('../stores/moderation-store');

function logConfiguredEvent(guildId, category, event) {
    const management = readSettings(guildId).management;
    if (!management.modules.cases) return null;
    if (category === 'message' && !management.cases.logMessageChanges) return null;
    if (category === 'member' && !management.cases.logMemberChanges) return null;
    return addEvent(guildId, event);
}

module.exports = { logConfiguredEvent };
