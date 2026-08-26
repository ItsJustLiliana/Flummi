const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'data', 'global', 'abuse-reports.json');
function readReports() { try { const rows = JSON.parse(fs.readFileSync(filePath, 'utf8')); return Array.isArray(rows) ? rows : []; } catch { return []; } }
function writeReports(rows) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, `${JSON.stringify(rows.slice(0, 2000), null, 2)}\n`); }
function addReport(input) { const rows = readReports(); const report = { id: `abuse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, status: 'received', createdAt: new Date().toISOString(), updates: [], ...input }; rows.unshift(report); writeReports(rows); return report; }
function getReport(id) { return readReports().find(report => report.id === id) || null; }
function updateReport(id, changes) { const rows = readReports(); const report = rows.find(entry => entry.id === id); if (!report) return null; Object.assign(report, changes, { updatedAt: new Date().toISOString() }); writeReports(rows); return report; }
module.exports = { addReport, getReport, readReports, updateReport, writeReports };
