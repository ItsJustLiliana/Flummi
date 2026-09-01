function bucketRange(row) {
    const hourly = row?.granularity === 'hour' || /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row?.date || ''));
    const start = new Date(`${row?.date}${hourly ? ':00:00.000Z' : 'T00:00:00.000Z'}`).getTime();
    if (!Number.isFinite(start)) return null;
    return { start, end: start + (hourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000) };
}

function overlapMs(start, end, interval) {
    const intervalStart = new Date(interval?.startedAt).getTime();
    const intervalEnd = new Date(interval?.endedAt).getTime();
    if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd)) return 0;
    return Math.max(0, Math.min(end, intervalEnd) - Math.max(start, intervalStart));
}

function addDataCoverage(rows, availability, now = Date.now()) {
    if (!Array.isArray(rows) || !availability?.trackingStartedAt) return rows;
    const trackingStartedAt = new Date(availability.trackingStartedAt).getTime();
    if (!Number.isFinite(trackingStartedAt)) return rows;

    return rows.map(row => {
        const range = bucketRange(row);
        if (!range || range.end <= trackingStartedAt) return row;
        const end = Math.min(range.end, now);
        if (end <= range.start) return row;
        if (range.start < trackingStartedAt) {
            return { ...row, coveragePercent: null, coverageStatus: 'unknown', coverageReason: 'Coverage tracking started during this period.' };
        }
        const durationMs = end - range.start;
        const offlineMs = Math.min(durationMs, (availability.downtimes || []).reduce((total, interval) => total + overlapMs(range.start, end, interval), 0));
        const coveragePercent = Math.max(0, Math.min(100, Math.round((durationMs - offlineMs) / durationMs * 100)));
        return {
            ...row,
            coveragePercent,
            coverageStatus: coveragePercent >= 99 ? 'complete' : coveragePercent > 0 ? 'partial' : 'missing',
            coverageOfflineMs: offlineMs,
            coverageReason: offlineMs ? 'Bot heartbeat or Discord connection unavailable.' : 'Bot observed for this entire period.'
        };
    });
}

module.exports = { addDataCoverage, bucketRange, overlapMs };
