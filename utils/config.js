const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localPath = path.join(root, 'config.local.json');
const legacyPath = path.join(root, 'config.json');
const examplePath = path.join(root, 'config.example.json');

function readConfig() {
    for (const filePath of [localPath, legacyPath, examplePath]) {
        try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { /* try the next safe fallback */ }
    }
    return {};
}

function saveConfig(config) {
    fs.writeFileSync(localPath, JSON.stringify(config, null, 4));
    return config;
}

module.exports = { localPath, readConfig, saveConfig };
