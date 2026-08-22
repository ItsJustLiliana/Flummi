#!/usr/bin/env node
// Called by update.sh and the Windows force-update script. Runtime state stays
// out of Git, but remains available to the local admin panel.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const action = process.argv[2];
const runtimeFile = path.join(__dirname, '..', 'data', 'runtime', 'update-status.json');

if (!['checked', 'updated', 'promoted'].includes(action)) {
    console.error('Usage: node scripts/record-update-status.js <checked|updated|promoted>');
    process.exit(1);
}

let status = {};
try { status = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')); } catch { /* first run */ }
const now = new Date().toISOString();
if (action !== 'promoted') status.lastCheckedAt = now;
if (action === 'updated') {
    status.lastUpdatedAt = now;
    status.lastUpdatedCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
}
if (action === 'promoted') {
    status.lastPromotedAt = now;
    status.lastPromotedCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
    status.lastPromotedShortCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
}
fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
fs.writeFileSync(runtimeFile, JSON.stringify(status, null, 2));
