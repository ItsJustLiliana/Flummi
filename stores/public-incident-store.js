const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'data', 'global', 'public-incidents.json');

function readIncidents() {
    try {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(value) ? value.slice(0, 25) : [];
    } catch { return []; }
}

function addIncident(value = {}) {
    const entry = {
        id: `incident-${Date.now().toString(36)}`,
        title: String(value.title || 'Service incident').trim().slice(0, 100),
        message: String(value.message || '').trim().slice(0, 500),
        status: ['investigating', 'monitoring', 'resolved'].includes(value.status) ? value.status : 'investigating',
        createdAt: new Date().toISOString(), resolvedAt: value.status === 'resolved' ? new Date().toISOString() : null
    };
    const entries = [entry, ...readIncidents()];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entries.slice(0, 25), null, 2));
    return entry;
}

module.exports = { addIncident, readIncidents };
