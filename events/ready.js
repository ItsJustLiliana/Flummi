const { ensureGlobalStorage, ensureGuildStorage } = require('../utils/guild-storage');
const { applyConfiguredPresence } = require('../utils/presence');
const { endVoiceSession, getUserVoiceStats, readVoiceStats, startVoiceSession, updateVoiceSession } = require('../stores/voice-store');
const { pruneAnalytics } = require('../stores/analytics-store');
const { readConfig } = require('../utils/config');
const { snapshotGuildInvites } = require('../services/invite-tracker');
const { setGuildOwner } = require('../stores/access-store');
const { processExpiredCases } = require('../services/moderation-service');
const { processAutomation } = require('../services/automation-service');
const { pruneModerationData } = require('../stores/moderation-store');
const { readSettings } = require('../stores/settings-store');
const { processOperations } = require('../services/operations-service');
const { processTicketMaintenance } = require('../services/ticket-maintenance-service');
const customCommandStore = require('../stores/custom-command-store');
const { syncCommand } = require('../services/custom-command-service');

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
    const presentUserIds = new Set();

    for (const voiceState of guild.voiceStates.cache.values()) {
        const user = voiceState.member?.user;

        if (!user || user.bot || !voiceState.channelId) {
            continue;
        }
        presentUserIds.add(user.id);

        const currentStats = getUserVoiceStats(guild.id, user.id);

        // Keep a persisted active session alive across a bot restart when the user is
        // still in the same channel, so the live duration does not reset.
        if (currentStats.currentChannelId === voiceState.channelId) {
            updateVoiceSession({
                guildId: guild.id,
                userId: user.id,
                at: now,
                state: getVoiceStateData(voiceState)
            });
            continue;
        }

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

    // Gateway reconnects can miss a leave event. Explicitly close persisted sessions
    // that Discord no longer reports as being in any voice channel.
    for (const [userId, session] of Object.entries(readVoiceStats(guild.id).activeSessions)) {
        if (!presentUserIds.has(userId)) {
            endVoiceSession({ guildId: guild.id, userId, at: now, reason: 'reconcile_missing', state: session.state });
        }
    }
}

module.exports = {
    name: 'clientReady',
    once: true,
    reconcileVoiceSessions,

    execute(client) {
        ensureGlobalStorage();

        for (const guild of client.guilds.cache.values()) {
            ensureGuildStorage(guild.id);
            setGuildOwner(guild.id, guild.ownerId);
            reconcileVoiceSessions(guild);
            pruneAnalytics(guild.id, readConfig().analytics?.retentionDays || 365);
            snapshotGuildInvites(guild);
            for (const command of customCommandStore.readCommands(guild.id).filter(item => item.enabled !== false)) {
                syncCommand(guild, command).catch(error => console.warn(`Custom command /${command.name} sync failed: ${error.message}`));
            }
        }

        setInterval(() => {
            for (const guild of client.guilds.cache.values()) reconcileVoiceSessions(guild);
        }, 60000).unref();

        setInterval(() => processExpiredCases(client).catch(error => console.warn(`Moderation timer failed: ${error.message}`)), 60000).unref();
        setInterval(() => processAutomation(client).catch(error => console.warn(`Automation timer failed: ${error.message}`)), 60000).unref();
        setInterval(() => processOperations(client).catch(error => console.warn(`Operations timer failed: ${error.message}`)), 60000).unref();
        setInterval(() => processTicketMaintenance(client).catch(error => console.warn(`Ticket maintenance failed: ${error.message}`)), 60 * 60 * 1000).unref();
        processOperations(client).catch(error => console.warn(`Initial operations run failed: ${error.message}`));
        processTicketMaintenance(client).catch(error => console.warn(`Initial ticket maintenance failed: ${error.message}`));

        setInterval(() => {
            const retentionDays = readConfig().analytics?.retentionDays || 365;
            for (const guild of client.guilds.cache.values()) {
                pruneAnalytics(guild.id, retentionDays);
                pruneModerationData(guild.id, readSettings(guild.id).management.cases.retentionDays);
            }
        }, 24 * 60 * 60 * 1000).unref();

        applyConfiguredPresence(client);

        console.log('Bot is online');
    }
};
