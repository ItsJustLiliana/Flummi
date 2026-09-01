const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'runtime', 'ping-metrics.json');
const maxSamples = 100;

function readData() {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(data)) return { samples: data, system: null };
        return {
            samples: Array.isArray(data?.samples) ? data.samples : [],
            system: data?.system && typeof data.system === 'object' ? data.system : null
        };
    } catch {
        return { samples: [], system: null };
    }
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
    data.system = {
        at: new Date().toISOString(),
        ready: ready === true,
        gatewayLatency: Number.isFinite(gatewayLatency) ? Math.round(gatewayLatency) : null,
        apiLatency: Number.isFinite(apiLatency) ? Math.round(apiLatency) : null,
        apiStatus: apiStatus || null
    };
    writeData(data);
    return data.system;
}

function getPingMetrics() {
    const data = readData();
    return { latest: data.samples.at(-1) || null, system: data.system };
}

module.exports = { getPingMetrics, recordPingMetrics, recordSystemPingMetrics };
