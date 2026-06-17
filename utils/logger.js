const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
};

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

    console.log = (...args) => originalConsole.log(...withTimestamp('INFO', args));
    console.info = (...args) => originalConsole.info(...withTimestamp('INFO', args));
    console.warn = (...args) => originalConsole.warn(...withTimestamp('WARN', args));
    console.error = (...args) => originalConsole.error(...withTimestamp('ERROR', args));
}

module.exports = {
    formatLogTimestamp,
    installTimestampedConsole
};
