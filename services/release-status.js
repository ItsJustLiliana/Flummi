const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const commitFormat = '%H%x1f%h%x1f%cI%x1f%s';

function parseCommitLine(line) {
    const [hash = '', shortHash = '', committedAt = '', ...subjectParts] = String(line || '').trim().split('\x1f');
    if (!hash) return null;
    return { hash, shortHash: shortHash || hash.slice(0, 7), committedAt: committedAt || null, subject: subjectParts.join('\x1f') };
}

function defaultRunGit(repository, args) {
    return execFileSync('git', ['-C', repository, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
}

function buildReleaseStatus({
    stagingDir = process.env.FLUMMI_STAGING_DIR || '/projects/Flummi-staging',
    productionDir = process.env.FLUMMI_PRODUCTION_DIR || '/projects/Flummi',
    runGit = defaultRunGit,
    repositoryExists = repository => fs.existsSync(path.join(repository, '.git'))
} = {}) {
    if (!repositoryExists(stagingDir) || !repositoryExists(productionDir)) {
        return { available: false, reason: 'Staging and live Git checkouts are not both available on this host.' };
    }

    try {
        const staging = parseCommitLine(runGit(stagingDir, ['show', '-s', `--format=${commitFormat}`, 'HEAD']));
        const live = parseCommitLine(runGit(productionDir, ['show', '-s', `--format=${commitFormat}`, 'HEAD']));
        if (!staging || !live) throw new Error('Could not read staging or live commit metadata.');
        try {
            const productionUpdateStatus = JSON.parse(fs.readFileSync(path.join(productionDir, 'data', 'runtime', 'update-status.json'), 'utf8'));
            if (!productionUpdateStatus.lastPromotedCommit || productionUpdateStatus.lastPromotedCommit === live.hash) {
                live.promotedAt = productionUpdateStatus.lastPromotedAt || null;
            }
        } catch { /* promotion timestamps are available after the first promotion with this release */ }

        let relation = 'in-sync';
        if (staging.hash !== live.hash) {
            try {
                runGit(stagingDir, ['merge-base', '--is-ancestor', live.hash, staging.hash]);
                relation = 'ahead';
            } catch {
                try {
                    runGit(stagingDir, ['merge-base', '--is-ancestor', staging.hash, live.hash]);
                    relation = 'behind';
                } catch {
                    relation = 'diverged';
                }
            }
        }

        const range = `${live.hash}..${staging.hash}`;
        const pendingCommitCount = relation === 'in-sync' || relation === 'behind'
            ? 0
            : Math.max(0, Number(runGit(stagingDir, ['rev-list', '--count', range])) || 0);
        const stagedCommits = pendingCommitCount
            ? runGit(stagingDir, ['log', `--format=${commitFormat}`, '-n', '25', range])
                .split(/\r?\n/)
                .map(parseCommitLine)
                .filter(Boolean)
            : [];

        return {
            available: true,
            checkedAt: new Date().toISOString(),
            relation,
            inSync: staging.hash === live.hash,
            pendingCommitCount,
            stagedCommits,
            staging,
            live
        };
    } catch (error) {
        return { available: false, reason: error.message || 'Could not inspect staging and live Git history.' };
    }
}

module.exports = { buildReleaseStatus, parseCommitLine };
