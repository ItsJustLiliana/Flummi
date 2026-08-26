const { readSettings, isModuleGloballyDisabled } = require('../stores/settings-store');
const { isDue, markRun } = require('../stores/automation-state-store');
const { addEvent } = require('../stores/moderation-store');
const { scheduleMatches } = require('./schedule-service');

async function resolveTextChannel(guild, channelId) {
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
}

async function processAutomation(client, now = new Date()) {
    for (const guild of client.guilds.cache.values()) {
        const management = readSettings(guild.id).management;
        if (!management.modules.automation || isModuleGloballyDisabled('automation')) continue;
        if (management.automation.scheduledMessagesEnabled) {
            for (const schedule of management.automation.schedules.filter(item => item.enabled)) {
                const key = `schedule:${schedule.id}`;
                const previousRun = require('../stores/automation-state-store').readState(guild.id)[key] || schedule.lastRunAt;
                if (!scheduleMatches({ ...schedule, lastRunAt: previousRun }, now)) continue;
                const channel = await resolveTextChannel(guild, schedule.channelId);
                if (!channel) continue;
                await channel.send({ content: schedule.message, allowedMentions: { parse: [] } });
                markRun(guild.id, key, now);
                addEvent(guild.id, { type: 'scheduled-message', channelId: channel.id, summary: `Sent schedule ${schedule.id}` });
            }
        }
        if (management.automation.autoPurgeEnabled) {
            for (const rule of management.automation.purgeRules.filter(item => item.enabled)) {
                const key = `purge:${rule.id}`;
                if (!isDue(guild.id, key, rule.intervalMinutes, now)) continue;
                const channel = await resolveTextChannel(guild, rule.channelId);
                if (!channel?.messages?.fetch || !channel.bulkDelete) continue;
                const messages = await channel.messages.fetch({ limit: 100 });
                const deletable = [...messages.values()].slice(rule.keepMessages).filter(message => !message.pinned);
                if (deletable.length) await channel.bulkDelete(deletable, true);
                markRun(guild.id, key, now);
                addEvent(guild.id, { type: 'auto-purge', channelId: channel.id, summary: `Purged ${deletable.length} messages`, metadata: { ruleId: rule.id } });
            }
        }
    }
}

module.exports = { processAutomation };
