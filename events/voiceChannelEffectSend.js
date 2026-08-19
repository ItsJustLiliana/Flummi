const { recordSoundboardEvent } = require('../stores/analytics-store');

module.exports = {
    name: 'voiceChannelEffectSend',
    execute(effect) {
        if (effect.guild?.id && effect.soundId) recordSoundboardEvent(effect.guild.id, { soundId: String(effect.soundId), channelId: effect.channelId || null, userId: effect.userId || null });
    }
};
