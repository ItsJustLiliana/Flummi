const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'runtime', 'ping-metrics.json');
const maxSamples = 100;
const availabilityRetentionMs = 366 * 24 * 60 * 60 * 1000;
const heartbeatGraceMs = 90 * 1000;

function readData() {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data)) return { samples: data, system: null };
        return {
            samples: Array.isArray(data?.samples) ? data.samples : [],
            system: data?.system && typeof data.system === 'object' ? data.system : null,
            availability: data?.availability && typeof data.availability === 'object' ? data.availability : null
        };
    } catch {
        return { samples: [], system: null };
    }
}

function mergeDowntime(rows, interval) {
    const start = new Date(interval?.startedAt).getTime();
    const end = new Date(interval?.endedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return rows;
    const next = { startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), reason: interval.reason || 'Bot unavailable' };
    const previous = rows.at(-1);
    if (previous && new Date(previous.endedAt).getTime() >= start - 1000) {
        previous.endedAt = new Date(Math.max(end, new Date(previous.endedAt).getTime())).toISOString();
        if (previous.reason !== next.reason) previous.reason = 'Bot heartbeat or Discord connection unavailable';
    } else rows.push(next);
    return rows;
}

function updateAvailabilityData(data, sample, now = Date.now()) {
    const previous = data.system;
    const previousAt = new Date(previous?.at).getTime();
    const currentAt = new Date(sample.at).getTime();
    const availability = data.availability && typeof data.availability === 'object'
        ? data.availability
        : { trackingStartedAt: previous?.at || sample.at, downtimes: [] };
    availability.downtimes = Array.isArray(availability.downtimes) ? availability.downtimes : [];

    if (Number.isFinite(previousAt) && Number.isFinite(currentAt) && currentAt > previousAt) {
        if (previous.ready !== true) {
            mergeDowntime(availability.downtimes, { startedAt: previous.at, endedAt: sample.at, reason: 'Discord gateway unavailable' });
        } else if (currentAt - previousAt > heartbeatGraceMs) {
            mergeDowntime(availability.downtimes, { startedAt: new Date(previousAt + heartbeatGraceMs), endedAt: sample.at, reason: 'Bot heartbeat missing' });
        }
    }

    const cutoff = now - availabilityRetentionMs;
    availability.downtimes = availability.downtimes
        .filter(row => new Date(row.endedAt).getTime() >= cutoff)
        .map(row => new Date(row.startedAt).getTime() < cutoff ? { ...row, startedAt: new Date(cutoff).toISOString() } : row);
    data.availability = availability;
    return data;
}

function availabilityFromData(data, now = Date.now()) {
    const availability = data.availability;
    if (!availability?.trackingStartedAt) return null;
    const downtimes = (availability.downtimes || []).map(row => ({ ...row }));
    const lastAt = new Date(data.system?.at).getTime();
    if (Number.isFinite(lastAt)) {
        if (data.system.ready !== true) {
            mergeDowntime(downtimes, { startedAt: data.system.at, endedAt: new Date(now), reason: 'Discord gateway unavailable' });
        } else if (now - lastAt > heartbeatGraceMs) {
            mergeDowntime(downtimes, { startedAt: new Date(lastAt + heartbeatGraceMs), endedAt: new Date(now), reason: 'Bot heartbeat missing' });
        }
    }
    return { trackingStartedAt: availability.trackingStartedAt, downtimes };
}

function writeData(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function recordPingMetrics({ commandLatency, gatewayLatency, acknowledgementLatency }) {
    const sample = {
        at: new Date().toISOString(),
        commandLatency: Number.isFinite(commandLatency) ? Math.round(commandLatency) : null,
        gatewayLatency: Number.isFinite(gatewayLatency) ? Math.round(gatewayLatency) : null,
        acknowledgementLatency: Number.isFinite(acknowledgementLatency) ? Math.round(acknowledgementLatency) : null
    };
    const data = readData();
    data.samples = [...data.samples, sample].slice(-maxSamples);
    writeData(data);
    return sample;
}

function recordSystemPingMetrics({ gatewayLatency, apiLatency, apiStatus, ready }) {
    const data = readData();
    const sample = {
        at: new Date().toISOString(),
        ready: ready === true,
        gatewayLatency: Number.isFinite(gatewayLatency) ? Math.round(gatewayLatency) : null,
        apiLatency: Number.isFinite(apiLatency) ? Math.round(apiLatency) : null,
        apiStatus: apiStatus || null
    };
    updateAvailabilityData(data, sample);
    data.system = sample;
    writeData(data);
    return sample;
}

function getPingMetrics() {
    const data = readData();
    return { latest: data.samples.at(-1) || null, system: data.system };
}

function getAvailability() {
    return availabilityFromData(readData());
}

module.exports = { availabilityFromData, getAvailability, getPingMetrics, recordPingMetrics, recordSystemPingMetrics, updateAvailabilityData };
