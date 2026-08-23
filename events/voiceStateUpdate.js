const { startVoiceSession, endVoiceSession, updateVoiceSession } = require('../stores/voice-store');
const { handleVoiceRole } = require('../services/operations-service');

function getVoiceStateData(voiceState) {
    return {
        channelType: voiceState.channel?.type || null,
        serverDeaf: voiceState.serverDeaf,
        serverMute: voiceState.serverMute,
        selfDeaf: voiceState.selfDeaf,
        selfMute: voiceState.selfMute,
        streaming: voiceState.streaming,
        video: voiceState.selfVideo
    };
}

module.exports = {
    name: 'voiceStateUpdate',

    async execute(oldState, newState) {
        const guildId = newState.guild?.id || oldState.guild?.id;
        const user = newState.member?.user || oldState.member?.user;

        if (!guildId || !user || user.bot) {
            return;
        }

        const oldChannelId = oldState.channelId;
        const newChannelId = newState.channelId;

        if (oldChannelId !== newChannelId) await handleVoiceRole(oldState, newState);

        const now = new Date();

        if (oldChannelId === newChannelId) {
            if (newChannelId) {
                updateVoiceSession({
                    guildId,
                    userId: user.id,
                    at: now,
                    state: getVoiceStateData(newState)
                });
            }

            return;
        }

        if (oldChannelId) {
            endVoiceSession({
                guildId,
                userId: user.id,
                at: now,
                reason: newChannelId ? 'move' : 'leave',
                state: getVoiceStateData(oldState)
            });
        }

        if (newChannelId) {
            startVoiceSession({
                guildId,
                userId: user.id,
                channelId: newChannelId,
                channelName: newState.channel?.name || newChannelId,
                at: now,
                reason: newChannelId && oldChannelId ? 'move' : 'join',
                state: getVoiceStateData(newState)
            });
        }
    }
};
