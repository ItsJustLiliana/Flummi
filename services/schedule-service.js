function zonedParts(date, timezone = 'UTC') {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
        }).formatToParts(date);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return {
            year: Number(values.year), month: Number(values.month), day: Number(values.day),
            hour: Number(values.hour), minute: Number(values.minute),
            weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
        };
    } catch {
        return zonedParts(date, 'UTC');
    }
}

function cronFieldMatches(field, value, minimum, maximum) {
    return String(field).split(',').some(part => {
        const [range, stepText] = part.split('/');
        const step = Math.max(1, Number(stepText) || 1);
        if (range === '*') return (value - minimum) % step === 0;
        const [startText, endText] = range.split('-');
        const start = Number(startText);
        const end = endText === undefined ? start : Number(endText);
        return Number.isInteger(start) && Number.isInteger(end) && start >= minimum && end <= maximum && value >= start && value <= end && (value - start) % step === 0;
    });
}

function cronMatches(expression, parts) {
    const fields = String(expression || '').trim().split(/\s+/);
    if (fields.length !== 5) return false;
    return cronFieldMatches(fields[0], parts.minute, 0, 59)
        && cronFieldMatches(fields[1], parts.hour, 0, 23)
        && cronFieldMatches(fields[2], parts.day, 1, 31)
        && cronFieldMatches(fields[3], parts.month, 1, 12)
        && cronFieldMatches(fields[4], parts.weekday, 0, 6);
}

function scheduleMatches(schedule, at) {
    const now = at instanceof Date ? at : new Date(at);
    if (!Number.isFinite(now.getTime()) || schedule.enabled === false) return false;
    if (schedule.startAt && now < new Date(schedule.startAt)) return false;
    if (schedule.endAt && now > new Date(schedule.endAt)) return false;
    const last = Date.parse(schedule.lastRunAt || '') || 0;
    if (now.getTime() - last < 59000) return false;
    if (schedule.scheduleType === 'once') {
        const runAt = Date.parse(schedule.runAt || '');
        return Number.isFinite(runAt) && last < runAt && now.getTime() >= runAt;
    }
    if (schedule.scheduleType === 'weekly') {
        const parts = zonedParts(now, schedule.timezone);
        const [hour, minute] = String(schedule.time || '09:00').split(':').map(Number);
        return (schedule.weekdays || []).includes(parts.weekday) && parts.hour === hour && parts.minute === minute;
    }
    if (schedule.scheduleType === 'cron') return cronMatches(schedule.cron, zonedParts(now, schedule.timezone));
    return now.getTime() - last >= Math.max(5, Number(schedule.intervalMinutes) || 1440) * 60000;
}

function nextExecutions(schedule, from = new Date(), count = 5) {
    const results = [];
    const cursor = new Date(from);
    cursor.setSeconds(0, 0);
    for (let index = 0; index < 525600 && results.length < Math.max(1, Math.min(20, count)); index += 1) {
        cursor.setMinutes(cursor.getMinutes() + 1);
        if (scheduleMatches({ ...schedule, lastRunAt: null }, cursor)) results.push(cursor.toISOString());
        if (schedule.scheduleType === 'once' && cursor > new Date(schedule.runAt || 0)) break;
    }
    return results;
}

module.exports = { cronMatches, nextExecutions, scheduleMatches, zonedParts };
