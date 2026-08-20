const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RepositoryFileManager, isSensitivePath, normalizeRelativePath } = require('../services/repository-file-manager');

function fixture() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-files-'));
    const rootDir = path.join(base, 'repo');
    const stateDir = path.join(base, 'state');
    fs.mkdirSync(path.join(rootDir, 'panel'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'data', 'runtime', 'file-manager', 'backups'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'panel', 'index.html'), 'first\n');
    fs.writeFileSync(path.join(rootDir, 'README.md'), '# Test\n');
    fs.writeFileSync(path.join(rootDir, '.env.example'), 'SAFE_EXAMPLE=yes\n');
    fs.writeFileSync(path.join(rootDir, '.env'), 'SECRET=yes\n');
    fs.writeFileSync(path.join(rootDir, 'data', 'botPingResponses.json'), '{"saved":true}\n');
    fs.writeFileSync(path.join(rootDir, 'logs', 'flummi.log'), 'started\n');
    fs.writeFileSync(path.join(rootDir, 'latest.log'), 'latest\n');
    const manager = new RepositoryFileManager({ rootDir, stateDir });
    return { base, rootDir, stateDir, manager };
}

test('repository paths remain inside the allowlisted Flummi workspace', () => {
    assert.equal(normalizeRelativePath('panel/index.html'), 'panel/index.html');
    assert.throws(() => normalizeRelativePath('../.env'), /invalid/i);
    assert.throws(() => normalizeRelativePath('.env'), /outside/i);
    assert.equal(normalizeRelativePath('data/runtime.json'), 'data/runtime.json');
    assert.equal(normalizeRelativePath('logs/flummi.log'), 'logs/flummi.log');
    assert.equal(isSensitivePath('data/runtime.json'), true);
    assert.equal(isSensitivePath('logs/flummi.log'), true);
    assert.equal(isSensitivePath('latest.log'), true);
    assert.equal(isSensitivePath('panel/index.html'), false);
    assert.throws(() => normalizeRelativePath('data/runtime/file-manager/backups'), /not browsable/i);
    assert.throws(() => normalizeRelativePath('panel/.secret'), /Hidden/i);
});

test('root listing exposes the safe environment example but never the real environment', t => {
    const context = fixture();
    t.after(() => fs.rmSync(context.base, { recursive: true, force: true }));
    const names = context.manager.list('').entries.map(entry => entry.name);
    assert.equal(names.includes('.env.example'), true);
    assert.equal(names.includes('.env'), false);
    assert.equal(names.includes('data'), true);
    assert.equal(names.includes('logs'), true);
    assert.equal(names.includes('latest.log'), true);
    assert.equal(context.manager.list('data/runtime').entries.some(entry => entry.name === 'file-manager'), false);
});

test('reading is a snapshot and optimistic saves detect external writes', t => {
    const context = fixture();
    t.after(() => fs.rmSync(context.base, { recursive: true, force: true }));
    const opened = context.manager.read('panel/index.html');
    fs.appendFileSync(path.join(context.rootDir, 'panel', 'index.html'), 'external\n');
    assert.throws(
        () => context.manager.save('panel/index.html', 'editor\n', opened.hash),
        error => error.code === 'FILE_CHANGED' && error.statusCode === 409
    );
    assert.equal(fs.readFileSync(path.join(context.rootDir, 'panel', 'index.html'), 'utf8'), 'first\nexternal\n');

    const forced = context.manager.save('panel/index.html', 'editor\n', opened.hash, { force: true });
    assert.equal(fs.readFileSync(path.join(context.rootDir, 'panel', 'index.html'), 'utf8'), 'editor\n');
    assert.ok(forced.backup);
});

test('delete moves files to recoverable trash and uploads are type scoped', t => {
    const context = fixture();
    t.after(() => fs.rmSync(context.base, { recursive: true, force: true }));
    const removed = context.manager.trash('panel/index.html');
    assert.equal(fs.existsSync(path.join(context.rootDir, 'panel', 'index.html')), false);
    assert.equal(fs.existsSync(path.join(context.stateDir, removed.trashPath)), true);

    const image = Buffer.from('fake-image');
    context.manager.upload('assets/test.png', image.toString('base64'));
    assert.deepEqual(fs.readFileSync(path.join(context.rootDir, 'assets', 'test.png')), image);
    assert.throws(() => context.manager.upload('panel/payload.exe', image.toString('base64')), /not allowed/i);
});

test('search reports whether matching results can be edited', t => {
    const context = fixture();
    t.after(() => fs.rmSync(context.base, { recursive: true, force: true }));
    fs.writeFileSync(path.join(context.rootDir, 'assets', 'search-image.png'), Buffer.from('needle'));
    const results = context.manager.search('search').results;
    assert.deepEqual(
        results.map(result => ({ path: result.path, editable: result.editable })),
        [{ path: 'assets/search-image.png', editable: false }]
    );
});

test('symlinks cannot escape the repository sandbox', { skip: process.platform === 'win32' }, t => {
    const context = fixture();
    t.after(() => fs.rmSync(context.base, { recursive: true, force: true }));
    fs.symlinkSync(os.tmpdir(), path.join(context.rootDir, 'panel', 'outside'));
    assert.throws(() => context.manager.list('panel/outside'), error => error.code === 'SYMLINK_BLOCKED');
});
