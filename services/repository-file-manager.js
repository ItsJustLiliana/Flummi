const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const allowedDirectories = new Set([
    'assets', 'commands', 'deploy', 'docs', 'events', 'panel', 'scripts',
    'services', 'stores', 'test', 'tools', 'utils'
]);
const allowedRootFiles = new Set([
    '.env.example', 'README.md', 'Flummi_Linux_Server_Setup.md', 'idea.md',
    'config.example.json', 'control-panel.js', 'index.js', 'package.json', 'package-lock.json'
]);
const textExtensions = new Set([
    '.bat', '.cjs', '.conf', '.css', '.csv', '.env', '.example', '.html', '.ini',
    '.js', '.json', '.md', '.mjs', '.ps1', '.service', '.sh', '.svg', '.toml',
    '.ts', '.txt', '.yaml', '.yml'
]);
const assetExtensions = new Set([
    '.gif', '.ico', '.jpeg', '.jpg', '.json', '.mp3', '.ogg', '.png', '.svg',
    '.wav', '.webm', '.webp'
]);
const maxTextBytes = 1024 * 1024;
const maxUploadBytes = 8 * 1024 * 1024;
const maxDownloadBytes = 20 * 1024 * 1024;

class RepositoryFileError extends Error {
    constructor(message, code = 'FILE_MANAGER_ERROR', statusCode = 400, details = {}) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

function fileHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeRelativePath(value, { allowRoot = false } = {}) {
    const raw = String(value ?? '').trim().replace(/\\/g, '/');
    if (!raw) {
        if (allowRoot) return '';
        throw new RepositoryFileError('A repository path is required.', 'INVALID_PATH');
    }
    if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
        throw new RepositoryFileError('Absolute paths are not allowed.', 'INVALID_PATH');
    }

    const segments = raw.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
        throw new RepositoryFileError('The repository path is invalid.', 'INVALID_PATH');
    }
    if (segments.slice(1).some(segment => segment.startsWith('.'))) {
        throw new RepositoryFileError('Hidden repository paths are not available.', 'BLOCKED_PATH', 403);
    }

    const first = segments[0];
    const allowed = allowedDirectories.has(first) || (segments.length === 1 && allowedRootFiles.has(first));
    if (!allowed) {
        throw new RepositoryFileError('That path is outside the developer file workspace.', 'BLOCKED_PATH', 403);
    }
    return segments.join('/');
}

function isTextPath(relativePath) {
    const basename = path.posix.basename(relativePath).toLowerCase();
    if (basename === 'dockerfile' || basename === 'license') return true;
    if (basename === '.env.example') return true;
    return textExtensions.has(path.posix.extname(basename));
}

function isUploadAllowed(relativePath) {
    if (isTextPath(relativePath)) return true;
    return relativePath.startsWith('assets/') && assetExtensions.has(path.posix.extname(relativePath).toLowerCase());
}

function timestampName() {
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
}

class RepositoryFileManager {
    constructor({ rootDir, stateDir }) {
        this.rootDir = path.resolve(rootDir);
        this.stateDir = path.resolve(stateDir);
    }

    resolve(relativePath, options = {}) {
        const normalized = normalizeRelativePath(relativePath, options);
        const target = normalized ? path.resolve(this.rootDir, ...normalized.split('/')) : this.rootDir;
        const rootPrefix = `${this.rootDir}${path.sep}`;
        if (target !== this.rootDir && !target.startsWith(rootPrefix)) {
            throw new RepositoryFileError('The resolved path left the repository.', 'BLOCKED_PATH', 403);
        }

        let current = this.rootDir;
        for (const segment of normalized.split('/').filter(Boolean)) {
            current = path.join(current, segment);
            if (!fs.existsSync(current)) break;
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw new RepositoryFileError('Symbolic links are not available in the file manager.', 'SYMLINK_BLOCKED', 403);
            }
        }
        return { relativePath: normalized, target };
    }

    list(relativePath = '') {
        const resolved = this.resolve(relativePath, { allowRoot: true });
        if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isDirectory()) {
            throw new RepositoryFileError('Folder not found.', 'NOT_FOUND', 404);
        }

        const entries = fs.readdirSync(resolved.target, { withFileTypes: true })
            .filter(entry => !entry.isSymbolicLink())
            .filter(entry => !entry.name.startsWith('.') || (!resolved.relativePath && allowedRootFiles.has(entry.name)))
            .filter(entry => resolved.relativePath || allowedDirectories.has(entry.name) || allowedRootFiles.has(entry.name))
            .map(entry => {
                const childRelative = resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name;
                const stat = fs.statSync(path.join(resolved.target, entry.name));
                return {
                    name: entry.name,
                    path: childRelative,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size: entry.isFile() ? stat.size : null,
                    modifiedAt: stat.mtime.toISOString(),
                    editable: entry.isFile() && isTextPath(childRelative)
                };
            })
            .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));

        return { path: resolved.relativePath, entries };
    }

    read(relativePath) {
        const resolved = this.resolve(relativePath);
        if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isFile()) {
            throw new RepositoryFileError('File not found.', 'NOT_FOUND', 404);
        }
        if (!isTextPath(resolved.relativePath)) {
            throw new RepositoryFileError('This binary file can be downloaded but not edited.', 'BINARY_FILE', 415);
        }

        const stat = fs.statSync(resolved.target);
        if (stat.size > maxTextBytes) {
            throw new RepositoryFileError('This text file is too large for the browser editor.', 'FILE_TOO_LARGE', 413);
        }
        const buffer = fs.readFileSync(resolved.target);
        return {
            path: resolved.relativePath,
            content: buffer.toString('utf8'),
            hash: fileHash(buffer),
            size: buffer.length,
            modifiedAt: stat.mtime.toISOString(),
            git: this.gitStatus(resolved.relativePath)
        };
    }

    gitStatus(relativePath) {
        const args = ['status', '--short', '--', relativePath];
        let status = '';
        let diff = '';
        try {
            const options = { cwd: this.rootDir, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] };
            status = execFileSync('git', args, options).trim();
            diff = execFileSync('git', ['diff', '--no-ext-diff', '--', relativePath], options);
        } catch {
            // Git information is helpful but must never prevent file access.
        }
        return { status, diff };
    }

    backup(relativePath, target) {
        if (!fs.existsSync(target)) return null;
        const destination = path.join(this.stateDir, 'backups', timestampName(), ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.cpSync(target, destination, { recursive: true });
        this.trimStateFolder('backups', 100);
        return path.relative(this.stateDir, destination).replace(/\\/g, '/');
    }

    trimStateFolder(folderName, keep) {
        const folder = path.join(this.stateDir, folderName);
        if (!fs.existsSync(folder)) return;
        const entries = fs.readdirSync(folder).sort();
        for (const entry of entries.slice(0, Math.max(0, entries.length - keep))) {
            fs.rmSync(path.join(folder, entry), { recursive: true, force: true });
        }
    }

    save(relativePath, content, expectedHash, { force = false } = {}) {
        const resolved = this.resolve(relativePath);
        if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isFile()) {
            throw new RepositoryFileError('File not found.', 'NOT_FOUND', 404);
        }
        if (!isTextPath(resolved.relativePath)) {
            throw new RepositoryFileError('Binary files cannot be edited as text.', 'BINARY_FILE', 415);
        }

        const current = fs.readFileSync(resolved.target);
        const currentHash = fileHash(current);
        if (!force && expectedHash !== currentHash) {
            throw new RepositoryFileError(
                'This file changed on the server after you opened it. Reload it or explicitly overwrite the newer version.',
                'FILE_CHANGED',
                409,
                { currentHash, modifiedAt: fs.statSync(resolved.target).mtime.toISOString() }
            );
        }

        const output = Buffer.from(String(content ?? ''), 'utf8');
        if (output.length > maxTextBytes) {
            throw new RepositoryFileError('The edited file is too large.', 'FILE_TOO_LARGE', 413);
        }
        const backup = this.backup(resolved.relativePath, resolved.target);
        // A normal write does not retain a long-lived file descriptor or lock. Other
        // processes may keep writing; the hash above prevents silent overwrites.
        fs.writeFileSync(resolved.target, output);
        const stat = fs.statSync(resolved.target);
        return { path: resolved.relativePath, hash: fileHash(output), size: output.length, modifiedAt: stat.mtime.toISOString(), backup, git: this.gitStatus(resolved.relativePath) };
    }

    create(relativePath, type = 'file') {
        const resolved = this.resolve(relativePath);
        if (fs.existsSync(resolved.target)) {
            throw new RepositoryFileError('A file or folder already exists at that path.', 'ALREADY_EXISTS', 409);
        }
        const parent = path.dirname(resolved.target);
        if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
            throw new RepositoryFileError('The parent folder does not exist.', 'NOT_FOUND', 404);
        }
        if (type === 'directory') {
            fs.mkdirSync(resolved.target);
            return { path: resolved.relativePath, type };
        }
        if (type !== 'file' || !isTextPath(resolved.relativePath)) {
            throw new RepositoryFileError('New files must use an approved text/code extension.', 'FILE_TYPE_BLOCKED', 415);
        }
        fs.writeFileSync(resolved.target, '');
        return { path: resolved.relativePath, type: 'file', hash: fileHash(Buffer.alloc(0)) };
    }

    rename(sourcePath, destinationPath) {
        const source = this.resolve(sourcePath);
        const destination = this.resolve(destinationPath);
        if (!fs.existsSync(source.target)) throw new RepositoryFileError('Source not found.', 'NOT_FOUND', 404);
        if (fs.existsSync(destination.target)) throw new RepositoryFileError('Destination already exists.', 'ALREADY_EXISTS', 409);
        if (!fs.existsSync(path.dirname(destination.target))) throw new RepositoryFileError('Destination folder not found.', 'NOT_FOUND', 404);
        if (fs.statSync(source.target).isFile() && !isUploadAllowed(destination.relativePath)) {
            throw new RepositoryFileError('The destination file type is not allowed.', 'FILE_TYPE_BLOCKED', 415);
        }
        const backup = this.backup(source.relativePath, source.target);
        fs.renameSync(source.target, destination.target);
        return { from: source.relativePath, path: destination.relativePath, backup };
    }

    trash(relativePath) {
        const resolved = this.resolve(relativePath);
        if (!fs.existsSync(resolved.target)) throw new RepositoryFileError('Path not found.', 'NOT_FOUND', 404);
        const destination = path.join(this.stateDir, 'trash', timestampName(), ...resolved.relativePath.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(resolved.target, destination);
        this.trimStateFolder('trash', 100);
        return { path: resolved.relativePath, trashPath: path.relative(this.stateDir, destination).replace(/\\/g, '/') };
    }

    upload(relativePath, base64, expectedHash = null, { force = false } = {}) {
        const resolved = this.resolve(relativePath);
        if (!isUploadAllowed(resolved.relativePath)) {
            throw new RepositoryFileError('That upload type is not allowed.', 'FILE_TYPE_BLOCKED', 415);
        }
        const buffer = Buffer.from(String(base64 || ''), 'base64');
        if (!buffer.length || buffer.length > maxUploadBytes) {
            throw new RepositoryFileError('Upload must be between 1 byte and 8 MB.', 'FILE_TOO_LARGE', 413);
        }
        if (!fs.existsSync(path.dirname(resolved.target))) throw new RepositoryFileError('Destination folder not found.', 'NOT_FOUND', 404);

        let backup = null;
        if (fs.existsSync(resolved.target)) {
            if (!fs.statSync(resolved.target).isFile()) throw new RepositoryFileError('Destination is not a file.', 'INVALID_PATH');
            const currentHash = fileHash(fs.readFileSync(resolved.target));
            if (!force && expectedHash !== currentHash) {
                throw new RepositoryFileError('The destination changed or already exists.', 'FILE_CHANGED', 409, { currentHash });
            }
            backup = this.backup(resolved.relativePath, resolved.target);
        }
        fs.writeFileSync(resolved.target, buffer);
        return { path: resolved.relativePath, hash: fileHash(buffer), size: buffer.length, backup };
    }

    download(relativePath) {
        const resolved = this.resolve(relativePath);
        if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isFile()) {
            throw new RepositoryFileError('File not found.', 'NOT_FOUND', 404);
        }
        const stat = fs.statSync(resolved.target);
        if (stat.size > maxDownloadBytes) throw new RepositoryFileError('File is too large to download.', 'FILE_TOO_LARGE', 413);
        return { path: resolved.relativePath, buffer: fs.readFileSync(resolved.target) };
    }

    search(query) {
        const needle = String(query || '').trim().toLowerCase();
        if (needle.length < 2) throw new RepositoryFileError('Search requires at least two characters.', 'INVALID_SEARCH');
        const results = [];
        let inspected = 0;

        const visit = (relativeDirectory) => {
            if (results.length >= 100 || inspected >= 2000) return;
            const { target } = this.resolve(relativeDirectory, { allowRoot: true });
            for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
                if (results.length >= 100 || inspected >= 2000) break;
                if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
                const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
                if (!relativeDirectory && !allowedDirectories.has(entry.name) && !allowedRootFiles.has(entry.name)) continue;
                if (entry.isDirectory()) {
                    visit(relativePath);
                    continue;
                }
                inspected += 1;
                const nameMatch = entry.name.toLowerCase().includes(needle);
                let contentMatch = false;
                if (isTextPath(relativePath)) {
                    const stat = fs.statSync(path.join(target, entry.name));
                    if (stat.size <= 512 * 1024) {
                        contentMatch = fs.readFileSync(path.join(target, entry.name), 'utf8').toLowerCase().includes(needle);
                    }
                }
                if (nameMatch || contentMatch) results.push({ path: relativePath, name: entry.name, nameMatch, contentMatch, editable: isTextPath(relativePath) });
            }
        };

        visit('');
        return { query: String(query).trim(), results, truncated: results.length >= 100 || inspected >= 2000 };
    }
}

module.exports = {
    RepositoryFileError,
    RepositoryFileManager,
    allowedDirectories,
    allowedRootFiles,
    isTextPath,
    normalizeRelativePath
};
