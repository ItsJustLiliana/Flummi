const { ensureGlobalStorage, ensureGuildStorage } = require('../utils/guild-storage');
const { applyConfiguredPresence } = require('../utils/presence');
const { endVoiceSession, getUserVoiceStats, startVoiceSession } = require('../stores/voice-store');

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

function reconcileVoiceSessions(guild) {
    const now = new Date();

    for (const voiceState of guild.voiceStates.cache.values()) {
        const user = voiceState.member?.user;

        if (!user || user.bot || !voiceState.channelId) {
            continue;
        }

        const currentStats = getUserVoiceStats(guild.id, user.id);

        if (currentStats.currentChannelId) {
            endVoiceSession({
                guildId: guild.id,
                userId: user.id,
                at: now,
                reason: 'bot_restart',
                state: currentStats.currentState
            });
        }

        startVoiceSession({
            guildId: guild.id,
            userId: user.id,
            channelId: voiceState.channelId,
            channelName: voiceState.channel?.name || voiceState.channelId,
            at: now,
            reason: 'reconnect',
            state: getVoiceStateData(voiceState)
        });
    }
}

module.exports = {
    name: 'clientReady',
    once: true,

    execute(client) {
        ensureGlobalStorage();

        for (const guild of client.guilds.cache.values()) {
            ensureGuildStorage(guild.id);
            reconcileVoiceSessions(guild);
        }

        applyConfiguredPresence(client);

        console.log('Bot is online');
    }
};
