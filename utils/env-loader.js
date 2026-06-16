const fs = require('fs');
const path = require('path');

function unquoteValue(value) {
    const trimmed = String(value || '').trim();

    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function loadEnv(filePath = path.join(__dirname, '..', '.env')) {
    if (!fs.existsSync(filePath)) {
        return;
    }

    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const separatorIndex = trimmed.indexOf('=');

        if (separatorIndex === -1) {
            continue;
        }

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = unquoteValue(trimmed.slice(separatorIndex + 1));

        if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
            continue;
        }

        process.env[key] = value;
    }
}

module.exports = {
    loadEnv
};
