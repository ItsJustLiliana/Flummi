const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'global', 'privacy-requests.json');
function readRequests() { try { const rows = JSON.parse(fs.readFileSync(filePath, 'utf8')); return Array.isArray(rows) ? rows : []; } catch { return []; } }
function writeRequests(rows) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(rows.slice(0, 2000), null, 2)}\n`); }
function addCorrectionRequest(input) {
    const rows = readRequests();
    const entry = { id: `privacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, type: 'correction', status: 'received', createdAt: new Date().toISOString(), ...input };
    rows.unshift(entry); writeRequests(rows); return entry;
}
function getCorrectionRequest(id) { return readRequests().find(entry => entry.id === id) || null; }
function updateCorrectionRequest(id, changes) {
    const rows = readRequests();
    const request = rows.find(entry => entry.id === id);
    if (!request) return null;
    Object.assign(request, changes, { updatedAt: new Date().toISOString() });
    writeRequests(rows);
    return request;
}
module.exports = { addCorrectionRequest, getCorrectionRequest, readRequests, updateCorrectionRequest, writeRequests };
