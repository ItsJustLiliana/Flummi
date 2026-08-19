const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { installTimestampedConsole } = require('./utils/logger');
const { readConfig } = require('./utils/config');
const config = readConfig();
const deployCommands = require('./deploy-commands');

installTimestampedConsole();

const runtimeDir = path.join(__dirname, 'data', 'runtime');
const runtimeFile = path.join(runtimeDir, 'runtime.json');
const legacyRuntimeFile = path.join(runtimeDir, 'bots.json');
const maxRuntimeEntries = 50;

function ensureRuntimeDir() {
    fs.mkdirSync(runtimeDir, { recursive: true });
}

let panelProcess = null;

function startPanelProcess() {
    if (config.panel?.enabledOnStart === false) {
        console.log('Admin panel autostart disabled in config.');
        return;
    }

    console.log('Starting admin panel...');

    panelProcess = spawn(process.execPath, [path.join(__dirname, 'control-panel.js')], {
        stdio: 'inherit'
    });

    panelProcess.on('exit', (code, signal) => {
        panelProcess = null;
        console.warn(`Admin panel exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`);
    });

    panelProcess.on('error', error => {
        panelProcess = null;
        console.error(`Failed to start admin panel: ${error.message}`);
    });
}

function stopPanelProcess() {
    if (!panelProcess) {
        return;
    }

    panelProcess.removeAllListeners('exit');
    panelProcess.kill();
    panelProcess = null;
}

function formatTimestamp(date) {
    const value = date instanceof Date ? date : new Date(date);
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

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }

    if (minutes > 0 || hours > 0) {
        parts.push(`${minutes}m`);
    }

    parts.push(`${seconds}s`);
    return parts.join(' ');
}

function parseRuntimeFile(filePath) {
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (Array.isArray(raw)) {
            return raw;
        }

        if (Array.isArray(raw.instances)) {
            return raw.instances;
        }

        if (raw && typeof raw === 'object' && Number.isInteger(Number(raw.pid))) {
            return [raw];
        }
    } catch {
        return [];
    }

    return [];
}

function readRuntimeInstances() {
    const current = parseRuntimeFile(runtimeFile);

    if (current.length > 0 || fs.existsSync(runtimeFile)) {
        return current;
    }

    return parseRuntimeFile(legacyRuntimeFile);
}

function writeRuntimeInstances(instances) {
    ensureRuntimeDir();
    const limited = instances.slice(-maxRuntimeEntries);
    fs.writeFileSync(runtimeFile, JSON.stringify(limited, null, 2));
}

function markStaleRuntimeInstances(instances) {
    return instances.map(instance => {
        const pid = Number(instance?.pid);

        if (instance?.status !== 'running' || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
            return instance;
        }

        try {
            process.kill(pid, 0);
            return instance;
        } catch {
            const now = new Date();
            const stoppedAtMs = now.getTime();
            const startedAtMs = Number(instance.startedAtMs) || stoppedAtMs;

            return {
                ...instance,
                status: 'stale',
                stoppedAt: formatTimestamp(now),
                stoppedAtMs,
                totalRuntime: formatDuration(stoppedAtMs - startedAtMs),
                totalRuntimeMs: stoppedAtMs - startedAtMs
            };
        }
    });
}

function writeRuntimeFile() {
    const now = new Date();
    const instances = markStaleRuntimeInstances(readRuntimeInstances())
        .filter(instance => Number(instance?.pid) !== process.pid || instance?.status === 'stopped');

    instances.push({
        pid: process.pid,
        entry: 'start.js',
        status: 'running',
        startedAt: formatTimestamp(now),
        startedAtMs: now.getTime()
    });

    writeRuntimeInstances(instances);
}

function removeRuntimeFile() {
    try {
        const now = new Date();
        const instances = readRuntimeInstances()
            .map(instance => {
                if (Number(instance?.pid) !== process.pid || instance?.status === 'stopped') {
                    return instance;
                }

                const startedAtMs = Number(instance.startedAtMs) || now.getTime();

                return {
                    ...instance,
                    status: 'stopped',
                    stoppedAt: formatTimestamp(now),
                    stoppedAtMs: now.getTime(),
                    totalRuntime: formatDuration(now.getTime() - startedAtMs),
                    totalRuntimeMs: now.getTime() - startedAtMs
                };
            });
        writeRuntimeInstances(instances);
    } catch (error) {
        console.warn(`Failed to update runtime file ${runtimeFile}: ${error.message}`);
    }
}

function registerCleanupHandlers() {
    let cleanedUp = false;

    const cleanup = reason => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        removeRuntimeFile();
        stopPanelProcess();

        if (reason) {
            console.log(`Runtime marked stopped (${reason}).`);
        }
    };

    const stopFromSignal = signal => {
        cleanup(signal);
        process.exit(0);
    };

    process.on('exit', () => cleanup('exit'));
    process.on('SIGINT', () => {
        stopFromSignal('SIGINT');
    });
    process.on('SIGTERM', () => {
        stopFromSignal('SIGTERM');
    });
    process.on('SIGHUP', () => {
        stopFromSignal('SIGHUP');
    });

    if (process.platform === 'win32') {
        process.on('SIGBREAK', () => {
            stopFromSignal('SIGBREAK');
        });
    }

    process.on('uncaughtException', error => {
        cleanup('uncaughtException');
        console.error('Bot crashed:', error);
        process.exit(1);
    });

    process.on('unhandledRejection', reason => {
        cleanup('unhandledRejection');
        console.error('Unhandled rejection:', reason);
        process.exit(1);
    });
}

async function start() {
    writeRuntimeFile();
    registerCleanupHandlers();

    const shouldDeployCommands = config.deployCommandsOnStart !== false;

    if (shouldDeployCommands) {
        console.log('Deploy step enabled. Deploying slash commands...');
        try {
            await deployCommands();
        } catch (error) {
            console.warn(`Command deployment failed, continuing startup: ${error.message}`);
        }
    } else {
        console.log('Deploy step disabled. Skipping command deployment.');
    }

    startPanelProcess();

    console.log('Starting bot...');
    require('./index');
}

start().catch(error => {
    console.error('Failed to start bot:', error);
    removeRuntimeFile();
    process.exit(1);
});
