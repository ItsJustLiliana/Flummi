const fs = require('fs');
const path = require('path');

const defaultFilePath = path.join(__dirname, '..', 'data', 'global', 'compliance.json');
const allowedStatuses = new Set(['pending', 'terms-reviewed', 'dpa-executed']);

function emptyState() {
    return { openRouter: { status: 'pending', effectiveAt: null, reference: '', reviewedBy: null, updatedAt: null } };
}

function readCompliance(filePath = defaultFilePath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return { ...emptyState(), ...parsed, openRouter: { ...emptyState().openRouter, ...(parsed.openRouter || {}) } };
    } catch { return emptyState(); }
}

function updateOpenRouter(input, reviewerId, filePath = defaultFilePath) {
    const status = String(input.status || '');
    if (!allowedStatuses.has(status)) throw new Error('Invalid provider agreement status.');
    const effectiveAt = input.effectiveAt ? new Date(input.effectiveAt).toISOString() : null;
    if (status !== 'pending' && !effectiveAt) throw new Error('An effective date is required after review.');
    if (status !== 'pending' && !String(input.reference || '').trim()) throw new Error('An agreement reference is required after review.');
    const state = readCompliance(filePath);
    state.openRouter = {
        status,
        effectiveAt,
        reference: String(input.reference || '').trim().slice(0, 500),
        reviewedBy: String(reviewerId),
        updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    fs.renameSync(temporary, filePath);
    return state;
}

module.exports = { readCompliance, updateOpenRouter };
