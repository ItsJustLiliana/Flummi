const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'runtime', 'ping-metrics.json');
const maxSamples = 100;

function readSamples() {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function recordPingMetrics({ commandLatency, gatewayLatency, acknowledgementLatency }) {
    const sample = {
        at: new Date().toISOString(),
        commandLatency: Number.isFinite(commandLatency) ? Math.round(commandLatency) : null,
        gatewayLatency: Number.isFinite(gatewayLatency) ? Math.round(gatewayLatency) : null,
        acknowledgementLatency: Number.isFinite(acknowledgementLatency) ? Math.round(acknowledgementLatency) : null
    };
    const samples = [...readSamples(), sample].slice(-maxSamples);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(samples, null, 2));
    return sample;
}

function getLatestPingMetrics() {
    const samples = readSamples();
    return samples.at(-1) || null;
}

module.exports = { getLatestPingMetrics, recordPingMetrics };
