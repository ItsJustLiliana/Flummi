const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReleaseStatus, parseCommitLine } = require('../services/release-status');

test('release status parses commit metadata including subjects', () => {
    assert.deepEqual(
        parseCommitLine('abcdef123456\x1fabcdef1\x1f2026-08-22T18:43:00+02:00\x1fImprove staging UI'),
        {
            hash: 'abcdef123456',
            shortHash: 'abcdef1',
            committedAt: '2026-08-22T18:43:00+02:00',
            subject: 'Improve staging UI'
        }
    );
});

test('release status lists commits present on staging but not live', () => {
    const liveHash = '1'.repeat(40);
    const stagingHash = '3'.repeat(40);
    const runGit = (repository, args) => {
        if (args[0] === 'show') {
            return repository === '/staging'
                ? `${stagingHash}\x1f3333333\x1f2026-08-22T19:00:00+02:00\x1fLatest staged change`
                : `${liveHash}\x1f1111111\x1f2026-08-22T18:00:00+02:00\x1fCurrent live release`;
        }
        if (args[0] === 'merge-base' && args[2] === liveHash && args[3] === stagingHash) return '';
        if (args[0] === 'rev-list') return '2';
        if (args[0] === 'log') {
            return [
                `${stagingHash}\x1f3333333\x1f2026-08-22T19:00:00+02:00\x1fLatest staged change`,
                `${'2'.repeat(40)}\x1f2222222\x1f2026-08-22T18:30:00+02:00\x1fEarlier staged change`
            ].join('\n');
        }
        throw new Error(`Unexpected git call: ${args.join(' ')}`);
    };

    const status = buildReleaseStatus({
        stagingDir: '/staging',
        productionDir: '/live',
        repositoryExists: () => true,
        runGit
    });

    assert.equal(status.available, true);
    assert.equal(status.relation, 'ahead');
    assert.equal(status.pendingCommitCount, 2);
    assert.equal(status.staging.shortHash, '3333333');
    assert.equal(status.live.shortHash, '1111111');
    assert.deepEqual(status.stagedCommits.map(commit => commit.shortHash), ['3333333', '2222222']);
});

test('release status reports matching staging and live commits', () => {
    const hash = 'a'.repeat(40);
    const status = buildReleaseStatus({
        stagingDir: '/staging',
        productionDir: '/live',
        repositoryExists: () => true,
        runGit: (_repository, args) => {
            if (args[0] === 'show') return `${hash}\x1faaaaaaa\x1f2026-08-22T19:00:00+02:00\x1fSame release`;
            throw new Error('No comparison command should be needed.');
        }
    });

    assert.equal(status.relation, 'in-sync');
    assert.equal(status.pendingCommitCount, 0);
    assert.deepEqual(status.stagedCommits, []);
});
