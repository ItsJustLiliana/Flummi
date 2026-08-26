const analyticsStore = require('../stores/analytics-store');
const communityStore = require('../stores/community-management-store');
const moderationStore = require('../stores/moderation-store');
const operationsStore = require('../stores/operations-store');
const voiceStore = require('../stores/voice-store');

const DAY_MS = 86400000;

function validTime(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
}

function percentageChange(current, previous) {
    if (!previous) return current ? null : 0;
    return Math.round((current - previous) / previous * 100);
}

function inRange(rows, from, to = Infinity) {
    return rows.filter(row => {
        const time = validTime(row.at || row.createdAt);
        return time >= from && time < to;
    });
}

function buildThreatAssessment(guildId, { now = Date.now(), settings = {} } = {}) {
    const windowMs = Math.max(5, Number(settings.joinBurstWindowSeconds) || 30) * 1000;
    const widerWindowStart = now - Math.max(windowMs, 10 * 60000);
    const events = moderationStore.readEvents(guildId, { limit: 1000 });
    const analytics = analyticsStore.readEvents(guildId, 'moderation', widerWindowStart, now);
    const messages = analyticsStore.readEvents(guildId, 'messages', widerWindowStart, now);
    const joins = events.filter(row => row.type === 'member-join' && validTime(row.createdAt) >= widerWindowStart);
    const burstJoins = joins.filter(row => validTime(row.createdAt) >= now - windowMs);
    const minimumAge = Math.max(0, Number(settings.minimumAccountAgeDays) || 3) * DAY_MS;
    const freshAccounts = joins.filter(row => {
        const created = validTime(row.metadata?.accountCreatedAt);
        return created && validTime(row.createdAt) - created < minimumAge;
    });
    const suspiciousNames = joins.filter(row => {
        const name = String(row.summary || '').replace(/ joined$/i, '');
        return /(discord\.gg|nitro|free\W*gift)|([a-z0-9])\1{4,}|[^a-z0-9]{4,}/i.test(name);
    });
    const inviteCounts = new Map();
    for (const row of analytics.filter(entry => entry.action === 'invite-use')) {
        const invite = String(row.code || row.inviteCode || row.inviterId || 'unknown');
        inviteCounts.set(invite, (inviteCounts.get(invite) || 0) + 1);
    }
    const repeatedInvite = Math.max(0, ...inviteCounts.values());
    const joinedAt = new Map(joins.map(row => [String(row.userId), validTime(row.createdAt)]));
    const fastMessages = messages.filter(row => {
        const joined = joinedAt.get(String(row.userId));
        const at = validTime(row.at);
        return joined && at >= joined && at - joined <= 5 * 60000;
    }).length;
    const threshold = Math.max(2, Number(settings.joinBurstLimit) || 10);
    let score = 0;
    if (burstJoins.length >= threshold) score += 50;
    else score += Math.min(30, Math.round(burstJoins.length / threshold * 30));
    if (freshAccounts.length) score += Math.min(25, freshAccounts.length * 6);
    if (repeatedInvite >= 3) score += Math.min(20, repeatedInvite * 3);
    if (suspiciousNames.length) score += Math.min(15, suspiciousNames.length * 5);
    if (fastMessages >= 10) score += Math.min(20, Math.round(fastMessages / 2));
    score = Math.min(100, score);
    const level = score >= 65 ? 'Raid' : score >= 30 ? 'Elevated' : 'Low';
    const signals = [
        { label: 'Join burst', value: burstJoins.length, detail: `${burstJoins.length}/${threshold} in ${Math.round(windowMs / 1000)}s` },
        { label: 'Fresh accounts', value: freshAccounts.length, detail: `${freshAccounts.length} in the last 10m` },
        { label: 'Repeated invite', value: repeatedInvite, detail: repeatedInvite ? `${repeatedInvite} joins through one invite` : 'No repeated invite spike' },
        { label: 'Suspicious names', value: suspiciousNames.length, detail: `${suspiciousNames.length} detected` },
        { label: 'Fast messages', value: fastMessages, detail: `${fastMessages} shortly after joining` }
    ];
    return { level, score, assessedAt: new Date(now).toISOString(), signals };
}

function buildTicketStatistics(tickets, { now = Date.now() } = {}) {
    const closed = tickets.filter(ticket => ticket.status === 'closed');
    const open = tickets.filter(ticket => ticket.status !== 'closed');
    const firstResponseTimes = tickets
        .map(ticket => validTime(ticket.firstResponseAt || ticket.claimedAt) - validTime(ticket.createdAt))
        .filter(value => value >= 0);
    const resolutionTimes = closed
        .map(ticket => validTime(ticket.closedAt || ticket.updatedAt) - validTime(ticket.createdAt))
        .filter(value => value >= 0);
    const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    const unanswered = open.filter(ticket => !ticket.firstResponseAt && !ticket.claimedAt)
        .sort((left, right) => validTime(left.createdAt) - validTime(right.createdAt));
    const byStaff = new Map();
    for (const ticket of tickets) {
        const staffId = ticket.claimedBy || ticket.closedBy;
        if (staffId) byStaff.set(String(staffId), (byStaff.get(String(staffId)) || 0) + 1);
    }
    return {
        total: tickets.length,
        open: open.length,
        closed: closed.length,
        averageFirstResponseMs: average(firstResponseTimes),
        averageResolutionMs: average(resolutionTimes),
        oldestUnanswered: unanswered[0] ? { ...unanswered[0], waitingMs: Math.max(0, now - validTime(unanswered[0].createdAt)) } : null,
        byStaff: [...byStaff.entries()].map(([staffId, count]) => ({ staffId, count })).sort((a, b) => b.count - a.count)
    };
}

function buildOnboardingRetention(guildId, { now = Date.now() } = {}) {
    const joins = analyticsStore.readEvents(guildId, 'moderation', 0, now).filter(row => row.action === 'invite-use' && row.userId);
    const messages = analyticsStore.readEvents(guildId, 'messages', 0, now);
    const activityByUser = new Map();
    for (const row of messages) {
        const list = activityByUser.get(String(row.userId)) || [];
        list.push(validTime(row.at));
        activityByUser.set(String(row.userId), list);
    }
    const invites = new Map();
    for (const join of joins) {
        const label = String(join.code || join.inviteCode || join.inviterTag || join.inviterId || 'Unknown invite');
        const entry = invites.get(label) || { invite: label, joins: 0, eligible1d: 0, active1d: 0, eligible7d: 0, active7d: 0, eligible30d: 0, active30d: 0 };
        entry.joins++;
        const joinedAt = validTime(join.at);
        const activity = activityByUser.get(String(join.userId)) || [];
        for (const [days, eligibleKey, activeKey] of [[1, 'eligible1d', 'active1d'], [7, 'eligible7d', 'active7d'], [30, 'eligible30d', 'active30d']]) {
            if (now - joinedAt < days * DAY_MS) continue;
            entry[eligibleKey]++;
            if (activity.some(time => time >= joinedAt + days * DAY_MS)) entry[activeKey]++;
        }
        invites.set(label, entry);
    }
    const rate = (active, eligible) => eligible ? Math.round(active / eligible * 100) : null;
    return [...invites.values()].map(entry => ({
        invite: entry.invite,
        joins: entry.joins,
        active1d: rate(entry.active1d, entry.eligible1d),
        active7d: rate(entry.active7d, entry.eligible7d),
        active30d: rate(entry.active30d, entry.eligible30d)
    })).sort((a, b) => b.joins - a.joins).slice(0, 25);
}

function buildCommunityHealth(guildId, { now = Date.now() } = {}) {
    const currentStart = now - 30 * DAY_MS;
    const previousStart = now - 60 * DAY_MS;
    const messages = analyticsStore.readEvents(guildId, 'messages', previousStart, now);
    const voice = analyticsStore.readEvents(guildId, 'voice', previousStart, now).filter(row => row.action === 'session-ended');
    const moderation = analyticsStore.readEvents(guildId, 'moderation', previousStart, now);
    const community = communityStore.readState(guildId);
    const countPeriod = (rows, from, to) => inRange(rows, from, to).length;
    const currentMessages = countPeriod(messages, currentStart, now);
    const previousMessages = countPeriod(messages, previousStart, currentStart);
    const currentVoice = inRange(voice, currentStart, now).reduce((sum, row) => sum + Math.max(0, Number(row.durationMs) || 0), 0);
    const previousVoice = inRange(voice, previousStart, currentStart).reduce((sum, row) => sum + Math.max(0, Number(row.durationMs) || 0), 0);
    const currentModeration = inRange(moderation, currentStart, now);
    const previousModeration = inRange(moderation, previousStart, currentStart);
    const joins = currentModeration.filter(row => row.action === 'member-join').length;
    const leaves = currentModeration.filter(row => row.action === 'member-leave').length;
    const incidents = currentModeration.filter(row => !['member-join', 'member-leave', 'invite-use', 'role-change'].includes(row.action)).length;
    const previousIncidents = previousModeration.filter(row => !['member-join', 'member-leave', 'invite-use', 'role-change'].includes(row.action)).length;
    const tickets = buildTicketStatistics(community.tickets, { now });
    const unansweredPenalty = Math.min(15, community.tickets.filter(ticket => ticket.status !== 'closed' && !ticket.claimedAt && now - validTime(ticket.createdAt) > 8 * 3600000).length * 5);
    const joinBalance = joins + leaves ? Math.round((joins - leaves) / Math.max(1, joins + leaves) * 10) : 0;
    let score = 70 + Math.max(-10, Math.min(10, joinBalance));
    if (currentMessages > previousMessages) score += 8;
    else if (currentMessages < previousMessages) score -= 8;
    if (currentVoice > previousVoice) score += 7;
    else if (currentVoice < previousVoice) score -= 7;
    score -= Math.min(15, incidents * 2);
    score -= unansweredPenalty;
    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
        score,
        assessedAt: new Date(now).toISOString(),
        factors: [
            { label: 'Message activity', current: currentMessages, previous: previousMessages, changePercent: percentageChange(currentMessages, previousMessages), impact: currentMessages >= previousMessages ? 'positive' : 'negative' },
            { label: 'Voice activity', current: currentVoice, previous: previousVoice, changePercent: percentageChange(currentVoice, previousVoice), impact: currentVoice >= previousVoice ? 'positive' : 'negative', unit: 'ms' },
            { label: 'Join / leave balance', current: joins - leaves, previous: null, changePercent: null, impact: joins >= leaves ? 'positive' : 'negative' },
            { label: 'Moderation incidents', current: incidents, previous: previousIncidents, changePercent: percentageChange(incidents, previousIncidents), impact: incidents <= previousIncidents ? 'positive' : 'negative' },
            { label: 'Unanswered tickets', current: tickets.oldestUnanswered ? 1 : 0, previous: null, changePercent: null, impact: tickets.oldestUnanswered ? 'negative' : 'positive' }
        ],
        onboarding: buildOnboardingRetention(guildId, { now }),
        tickets
    };
}

function activityProfile(guildId, userId) {
    const messages = analyticsStore.readEvents(guildId, 'messages', 0).filter(row => String(row.userId) === String(userId));
    const allMessages = analyticsStore.readEvents(guildId, 'messages', 0);
    const counts = new Map();
    for (const row of allMessages) counts.set(String(row.userId), (counts.get(String(row.userId)) || 0) + 1);
    const memberCount = counts.get(String(userId)) || 0;
    const percentile = counts.size ? Math.round([...counts.values()].filter(count => count <= memberCount).length / counts.size * 100) : null;
    const voice = voiceStore.getUserVoiceStats(guildId, userId);
    return {
        messages: messages.length,
        activeDays: new Set(messages.map(row => String(row.at).slice(0, 10))).size,
        voiceMinutes: Math.round((voice.totalMs || 0) / 60000),
        lastMessageAt: messages.at(-1)?.at || null,
        lastVoiceAt: voice.lastSeenAt || null,
        activityPercentile: percentile,
        reputation: memberCount >= 1000 ? 'Veteran' : memberCount >= 250 ? 'Active' : memberCount >= 50 ? 'Regular' : 'Newcomer'
    };
}

function buildMemberDossier(guildId, userId) {
    const id = String(userId);
    const cases = moderationStore.getMemberCases(guildId, id, { limit: 500 });
    const events = moderationStore.readEvents(guildId, { limit: 1000 }).filter(row => String(row.userId || '') === id);
    const community = communityStore.readState(guildId);
    const timeline = [
        ...events.map(row => ({ id: row.id, at: row.createdAt, type: row.type, label: /^message-(delete|update)$/.test(row.type) ? 'Message metadata changed' : row.summary, channelId: row.channelId, actorId: row.actorId, source: 'event' })),
        ...cases.map(row => ({ id: row.id, at: row.createdAt, type: `case-${row.action}`, label: `${row.action}: ${row.reason}`, channelId: row.channelId, actorId: row.moderatorId, source: 'case', status: row.status })),
        ...community.tickets.filter(row => String(row.ownerId) === id).map(row => ({ id: row.id, at: row.createdAt, type: 'ticket', label: `Ticket created: ${row.topic}`, channelId: row.channelId, source: 'ticket', status: row.status })),
        ...community.suggestions.filter(row => String(row.authorId) === id).map(row => ({ id: row.id, at: row.createdAt, type: 'suggestion', label: `Suggestion submitted`, channelId: row.channelId, source: 'suggestion', status: row.status })),
        ...community.submissions.filter(row => String(row.userId || row.authorId) === id).map(row => ({ id: row.id, at: row.createdAt, type: row.kind || 'form', label: row.kind === 'appeal' ? 'Moderation appeal submitted' : 'Form submitted', source: 'form', status: row.status }))
    ].filter(row => row.at).sort((a, b) => validTime(b.at) - validTime(a.at)).slice(0, 250);
    return { userId: id, profile: activityProfile(guildId, id), cases, timeline };
}

function queryAuditLog(guildId, filters = {}, panelActivity = []) {
    const cases = moderationStore.readCases(guildId).map(row => ({ id: row.id, at: row.createdAt, memberId: row.targetId, moderatorId: row.moderatorId, action: row.action, channelId: row.channelId, summary: row.reason, source: 'Moderation case' }));
    const events = moderationStore.readEvents(guildId, { limit: 1000 }).map(row => ({ id: row.id, at: row.createdAt, memberId: row.userId, moderatorId: row.actorId, action: row.type, channelId: row.channelId, summary: row.summary, source: 'Server event' }));
    const panel = panelActivity.filter(row => String(row.guildId || '') === String(guildId) && row.source === 'panel').map(row => ({ id: row.id, at: row.at, memberId: row.targetId || null, moderatorId: row.actorId, action: row.type, channelId: row.channelId || null, summary: row.message, source: 'Panel change' }));
    const community = communityStore.readState(guildId);
    const ticketActions = community.tickets.flatMap(row => [
        { id: `${row.id}-created`, at: row.createdAt, memberId: row.ownerId, moderatorId: null, action: 'ticket-created', channelId: row.channelId, summary: row.topic, source: 'Ticket' },
        row.claimedAt ? { id: `${row.id}-claimed`, at: row.claimedAt, memberId: row.ownerId, moderatorId: row.claimedBy, action: 'ticket-claimed', channelId: row.channelId, summary: `Ticket ${row.id} claimed`, source: 'Ticket' } : null,
        row.closedAt ? { id: `${row.id}-closed`, at: row.closedAt, memberId: row.ownerId, moderatorId: row.closedBy, action: 'ticket-closed', channelId: row.channelId, summary: row.closeReason || `Ticket ${row.id} closed`, source: 'Ticket' } : null
    ]).filter(Boolean);
    const suggestionActions = community.suggestions.map(row => ({ id: row.id, at: row.updatedAt || row.createdAt, memberId: row.authorId, moderatorId: row.reviewedBy || null, action: `suggestion-${row.status || 'submitted'}`, channelId: row.channelId, summary: row.staffResponse || row.note || 'Suggestion submitted', source: 'Suggestion' }));
    const from = filters.from ? validTime(filters.from) : 0;
    const to = filters.to ? validTime(filters.to) + DAY_MS : Infinity;
    return [...cases, ...events, ...ticketActions, ...suggestionActions, ...panel]
        .filter(row => !filters.memberId || String(row.memberId || '') === String(filters.memberId))
        .filter(row => !filters.moderatorId || String(row.moderatorId || '') === String(filters.moderatorId))
        .filter(row => !filters.action || String(row.action).toLowerCase().includes(String(filters.action).toLowerCase()))
        .filter(row => !filters.channelId || String(row.channelId || '') === String(filters.channelId))
        .filter(row => validTime(row.at) >= from && validTime(row.at) < to)
        .sort((a, b) => validTime(b.at) - validTime(a.at))
        .slice(0, 500);
}

function activePunishments(guildId, { now = Date.now() } = {}) {
    const cases = moderationStore.readCases(guildId)
        .filter(row => row.status === 'active' && row.expiresAt && validTime(row.expiresAt) > now)
        .map(row => ({ id: row.id, kind: 'case', action: row.action, targetId: row.targetId, moderatorId: row.moderatorId, reason: row.reason, expiresAt: row.expiresAt, remainingMs: validTime(row.expiresAt) - now }));
    const roles = operationsStore.readState(guildId).temporaryRoles
        .filter(row => row.status === 'open' && validTime(row.removeAt) > now)
        .map(row => ({ id: row.id, kind: 'temporary-role', action: 'temprole', targetId: row.userId, moderatorId: row.moderatorId || null, reason: row.reason || 'Temporary role', roleId: row.roleId, expiresAt: row.removeAt, remainingMs: validTime(row.removeAt) - now }));
    return [...cases, ...roles].sort((a, b) => a.remainingMs - b.remainingMs);
}

module.exports = {
    activePunishments,
    activityProfile,
    buildCommunityHealth,
    buildMemberDossier,
    buildOnboardingRetention,
    buildThreatAssessment,
    buildTicketStatistics,
    queryAuditLog
};
