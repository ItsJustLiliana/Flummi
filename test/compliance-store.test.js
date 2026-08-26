const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCompliance, updateOpenRouter } = require('../stores/compliance-store');
const { PROCEDURES } = require('../services/compliance-operations-service');

test('provider agreement review is explicitly recorded with reviewer and reference', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flummi-compliance-'));
    const filePath = path.join(root, 'compliance.json');
    try {
        assert.equal(readCompliance(filePath).openRouter.status, 'pending');
        assert.throws(() => updateOpenRouter({ status: 'dpa-executed', effectiveAt: '2026-08-26' }, '42', filePath), /reference/);
        const state = updateOpenRouter({ status: 'dpa-executed', effectiveAt: '2026-08-26', reference: 'contract-123' }, '42', filePath);
        assert.equal(state.openRouter.status, 'dpa-executed');
        assert.equal(state.openRouter.reviewedBy, '42');
        assert.equal(readCompliance(filePath).openRouter.reference, 'contract-123');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('internal procedures define ownership, deadlines, and escalation', () => {
    assert.match(PROCEDURES.owner, /responsible/i);
    assert.match(JSON.stringify(PROCEDURES.abuse), /4 hours/);
    assert.match(JSON.stringify(PROCEDURES.correction), /30 days/);
    assert.match(JSON.stringify(PROCEDURES.incident), /72 hours/);
});
