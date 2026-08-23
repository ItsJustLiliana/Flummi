const store = require('../stores/community-management-store');

module.exports = {
    name: 'voiceStateUpdate',
    async execute(oldState) {
        const channel = oldState.channel;
        if (!channel || channel.members.size > 0) return;
        const state = store.readState(oldState.guild.id);
        if (!state.temporaryVoiceChannels.includes(channel.id)) return;
        store.removeTemporaryVoiceChannel(oldState.guild.id, channel.id);
        await channel.delete('Temporary voice room became empty').catch(() => {});
    }
};
