const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};
const fs = require('fs');
const path = require('path');
const logFile = path.join(__dirname, '..', 'data', 'runtime', 'bot.log');
const maxEntries = 1000;

let installed = false;

function formatLogTimestamp(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);

    if (Number.isNaN(value.getTime())) {
        return '';
    }

    const pad = number => String(number).padStart(2, '0');

    return [
        value.getFullYear(),
        pad(value.getMonth() + 1),
        pad(value.getDate())
    ].join('-') + ' ' + [
        pad(value.getHours()),
        pad(value.getMinutes()),
        pad(value.getSeconds())
    ].join(':');
}

function withTimestamp(level, args) {
    return [`[${formatLogTimestamp()}]`, `[${level}]`, ...args];
}

function installTimestampedConsole() {
    if (installed) {
        return;
    }

    installed = true;

    const write = (level, args) => {
        const entry = { at: new Date().toISOString(), level: level.toLowerCase(), message: args.map(value => value instanceof Error ? value.stack || value.message : typeof value === 'string' ? value : JSON.stringify(value)).join(' ') };
        try {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
            const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
            if (lines.length > maxEntries) fs.writeFileSync(logFile, lines.slice(-maxEntries).join('\n') + '\n');
        } catch { /* Logging must never stop the bot. */ }
    };
    console.log = (...args) => { write('INFO', args); originalConsole.log(...withTimestamp('INFO', args)); };
    console.info = (...args) => { write('INFO', args); originalConsole.info(...withTimestamp('INFO', args)); };
    console.warn = (...args) => { write('WARN', args); originalConsole.warn(...withTimestamp('WARN', args)); };
    console.error = (...args) => { write('ERROR', args); originalConsole.error(...withTimestamp('ERROR', args)); };
}

function readRecentLogs(level = null, limit = 200) {
    try {
        const rows = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        return rows.filter(row => !level || row.level === level).slice(-Math.max(1, Math.min(1000, Number(limit) || 200))).reverse();
    } catch { return []; }
}

module.exports = {
    formatLogTimestamp,
    installTimestampedConsole,
    readRecentLogs
};
