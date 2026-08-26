const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rootLocalPath = path.join(root, 'config.local.json');
const secretsDir = process.env.FLUMMI_SECRETS_DIR || path.join(root, '.flummi-secrets');
const secureLocalPath = path.join(secretsDir, 'config.local.json');
const secretsMarkerPath = path.join(secretsDir, '.flummi-secrets-verified');
const localPath = fs.existsSync(secretsMarkerPath) ? secureLocalPath : rootLocalPath;
const legacyPath = path.join(root, 'config.json');
const examplePath = path.join(root, 'config.example.json');

function readConfig() {
    const candidates = fs.existsSync(secretsMarkerPath)
        ? [secureLocalPath, rootLocalPath, legacyPath, examplePath]
        : [rootLocalPath, legacyPath, examplePath];
    for (const filePath of candidates) {
        try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { /* try the next safe fallback */ }
    }
    return {};
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, JSON.stringify(config, null, 4));
    return config;
}

module.exports = { localPath, readConfig, rootLocalPath, saveConfig, secureLocalPath };
