const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { installTimestampedConsole } = require('./utils/logger');

installTimestampedConsole();

const workspaceRoot = __dirname;
const runtimeDir = path.join(workspaceRoot, 'data', 'runtime');
const runtimeFile = path.join(runtimeDir, 'runtime.json');
const legacyRuntimeFile = path.join(runtimeDir, 'bots.json');
const maxRuntimeEntries = 50;

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
    fs.mkdirSync(runtimeDir, { recursive: true });
    const limited = instances.slice(-maxRuntimeEntries);
    fs.writeFileSync(runtimeFile, JSON.stringify(limited, null, 2));
}

function readTrackedPids() {
    const currentPids = readRuntimeInstances()
        .filter(instance => instance?.status !== 'stopped' && instance?.status !== 'stale')
        .map(instance => Number(instance?.pid));

    const legacyPids = fs.existsSync(runtimeDir)
        ? fs.readdirSync(runtimeDir)
            .filter(file => file.startsWith('bot-') && file.endsWith('.json'))
        .map(file => {
            const pidMatch = file.match(/^bot-(\d+)\.json$/);
            return pidMatch ? Number(pidMatch[1]) : null;
        })
        : [];

    return [...new Set([...currentPids, ...legacyPids])]
        .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function markRuntimeInstances(pids, status) {
    const now = new Date();
    const stoppedAtMs = now.getTime();
    const pidSet = new Set(pids.map(pid => Number(pid)));
    const existing = readRuntimeInstances();
    const seenPids = new Set();
    const instances = existing.map(instance => {
        const pid = Number(instance?.pid);

        if (!pidSet.has(pid) || instance?.status === 'stopped') {
            return instance;
        }

        seenPids.add(pid);

        const startedAtMs = Number(instance.startedAtMs) || stoppedAtMs;

        return {
            ...instance,
            status,
            stoppedAt: formatTimestamp(now),
            stoppedAtMs,
            totalRuntime: formatDuration(stoppedAtMs - startedAtMs),
            totalRuntimeMs: stoppedAtMs - startedAtMs
        };
    });

    for (const pid of pidSet) {
        if (seenPids.has(pid)) {
            continue;
        }

        instances.push({
            pid,
            entry: 'discovered',
            status,
            startedAt: 'unknown',
            stoppedAt: formatTimestamp(now),
            stoppedAtMs,
            totalRuntime: 'unknown'
        });
    }

    writeRuntimeInstances(instances);
}

function getWindowsBotPids() {
    const escapedRoot = workspaceRoot.replace(/\\/g, '\\\\').replace(/'/g, "''");
    const command = [
        `$root = '${escapedRoot}'`,
        "$botProcesses = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^node(\\.exe)?$' -and $_.CommandLine -like \"*$root*\" -and ($_.CommandLine -like '*start.js*' -or $_.CommandLine -like '*index.js*') -and $_.CommandLine -notlike '*stop.js*' }",
        '$botProcesses | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress'
    ].join('; ');

    try {
        const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
            encoding: 'utf8'
        }).trim();

        if (!output) {
            return [];
        }

        const parsed = JSON.parse(output);
        const pids = Array.isArray(parsed) ? parsed : [parsed];
        return pids
            .map(pid => Number(pid))
            .filter(pid => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    } catch (error) {
        console.warn(`Failed to scan running bot processes: ${error.message}`);
        return [];
    }
}

function stopWindowsPid(pid) {
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore'
    });
}

function stopOtherPid(pid) {
    process.kill(pid, 'SIGTERM');
}

function stopPid(pid) {
    if (process.platform === 'win32') {
        stopWindowsPid(pid);
        return;
    }

    stopOtherPid(pid);
}

function removeStaleRuntimeFiles() {
    if (!fs.existsSync(runtimeDir)) {
        return;
    }

    const nextInstances = readRuntimeInstances()
        .map(instance => {
            const pid = Number(instance?.pid);

            if (instance?.status === 'stopped' || instance?.status === 'stale') {
                return instance;
            }

            if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
                return {
                    ...instance,
                    status: 'stale',
                    stoppedAt: formatTimestamp(new Date()),
                    totalRuntime: 'unknown'
                };
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

    writeRuntimeInstances(nextInstances);

    for (const file of fs.readdirSync(runtimeDir)) {
        const filePath = path.join(runtimeDir, file);
        const pidMatch = file.match(/^bot-(\d+)\.json$/);

        if (!pidMatch) {
            continue;
        }

        const pid = Number(pidMatch[1]);

        try {
            process.kill(pid, 0);
        } catch {
            fs.unlinkSync(filePath);
        }
    }
}

function main() {
    const trackedPids = readTrackedPids();
    const discoveredPids = process.platform === 'win32' ? getWindowsBotPids() : [];
    const allPids = [...new Set([...trackedPids, ...discoveredPids])];

    if (allPids.length === 0) {
        removeStaleRuntimeFiles();
        console.log('No active bot instances found.');
        return;
    }

    const stoppedPids = [];
    const failedPids = [];

    for (const pid of allPids) {
        try {
            stopPid(pid);
            stoppedPids.push(pid);
        } catch (error) {
            failedPids.push({ pid, error: error.message });
        }
    }

    markRuntimeInstances(stoppedPids, 'stopped');
    removeStaleRuntimeFiles();

    if (stoppedPids.length > 0) {
        console.log(`Stopped bot instance${stoppedPids.length === 1 ? '' : 's'}: ${stoppedPids.join(', ')}`);
    }

    if (failedPids.length > 0) {
        for (const failure of failedPids) {
            console.error(`Failed to stop PID ${failure.pid}: ${failure.error}`);
        }

        process.exitCode = 1;
    }
}

main();
