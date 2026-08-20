const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFieldChanges } = require('../utils/audit-details');

test('audit field changes include nested settings and omit unchanged values', () => {
    const changes = buildFieldChanges(
        { botEnabled: true, maxTriggerLength: 100, features: { shotsEnabled: false } },
        { botEnabled: false, maxTriggerLength: 100, features: { shotsEnabled: true } },
        { botEnabled: 'Bot enabled', 'features.shotsEnabled': 'Shots' }
    );

    assert.deepEqual(changes, [
        { field: 'botEnabled', label: 'Bot enabled', before: true, after: false },
        { field: 'features.shotsEnabled', label: 'Shots', before: false, after: true }
    ]);
});
