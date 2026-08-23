const { logConfiguredEvent } = require('../services/event-log-service');
const { recordAdministrativeAction } = require('../services/operations-service');

module.exports = {
    name: 'channelUpdate',
    async execute(oldChannel, newChannel) {
        const changed = oldChannel.name !== newChannel.name
            || oldChannel.parentId !== newChannel.parentId
            || oldChannel.permissionOverwrites?.cache?.size !== newChannel.permissionOverwrites?.cache?.size;
        if (!newChannel.guildId || !changed) return;
        logConfiguredEvent(newChannel.guildId, 'member', { type: 'channel-update', channelId: newChannel.id, summary: `Channel updated: ${oldChannel.name} → ${newChannel.name}` });
        await recordAdministrativeAction(newChannel.guild, 'channel-update', newChannel);
    }
};
