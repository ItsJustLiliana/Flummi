const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFieldChanges } = require('../utils/audit-details');

test('audit field changes include nested settings and omit unchanged values', () => {
    const changes = buildFieldChanges(
        { botEnabled: true, maxTriggerLength: 100, features: { pingResponsesEnabled: false } },
        { botEnabled: false, maxTriggerLength: 100, features: { pingResponsesEnabled: true } },
        { botEnabled: 'Bot enabled', 'features.pingResponsesEnabled': 'Ping responses' }
    );

    assert.deepEqual(changes, [
        { field: 'botEnabled', label: 'Bot enabled', before: true, after: false },
        { field: 'features.pingResponsesEnabled', label: 'Ping responses', before: false, after: true }
    ]);
});
