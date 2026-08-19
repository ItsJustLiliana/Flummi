const fs = require('fs');
const path = require('path');
const filePath = path.join(__dirname, '..', 'data', 'runtime', 'ai-health.json');

function read() { try { const data = JSON.parse(fs.readFileSync(filePath, 'utf8')); return Array.isArray(data) ? data : []; } catch { return []; } }
function recordAiResult(entry) { const data = [...read(), { at: new Date().toISOString(), ...entry }].slice(-500); fs.mkdirSync(path.dirname(filePath), { recursive: true }); fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); }
function getAiHealth() { const data = read(); const successes = data.filter(x => x.ok); return { total: data.length, successes: successes.length, successRate: data.length ? Math.round(successes.length / data.length * 100) : null, timeouts: data.filter(x => x.code === 'REQUEST_TIMEOUT').length, rateLimits: data.filter(x => x.code === 'RATE_LIMITED').length, failures: data.filter(x => !x.ok).length, lastReply: successes.at(-1) || null }; }
module.exports = { getAiHealth, recordAiResult };
