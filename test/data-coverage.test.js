const test = require('node:test');
const assert = require('node:assert/strict');
const { addDataCoverage } = require('../services/data-coverage-service');
const { availabilityFromData, updateAvailabilityData } = require('../stores/ping-metrics-store');

test('availability history turns a stale heartbeat gap into downtime', () => {
    const data = {
        system: { at: '2026-09-01T00:00:00.000Z', ready: true },
        availability: null
    };
    const next = { at: '2026-09-01T00:05:00.000Z', ready: true };
    updateAvailabilityData(data, next, new Date(next.at).getTime());
    data.system = next;
    const availability = availabilityFromData(data, new Date(next.at).getTime());
    assert.equal(availability.trackingStartedAt, '2026-09-01T00:00:00.000Z');
    assert.deepEqual(availability.downtimes, [{
        startedAt: '2026-09-01T00:01:30.000Z',
        endedAt: '2026-09-01T00:05:00.000Z',
        reason: 'Bot heartbeat missing'
    }]);
});

test('chart buckets expose their percentage of reliable bot coverage', () => {
    const availability = {
        trackingStartedAt: '2026-09-01T00:00:00.000Z',
        downtimes: [{ startedAt: '2026-09-01T00:15:00.000Z', endedAt: '2026-09-01T00:30:00.000Z' }]
    };
    const [bucket] = addDataCoverage(
        [{ date: '2026-09-01T00', count: 12, granularity: 'hour' }],
        availability,
        new Date('2026-09-01T01:00:00.000Z').getTime()
    );
    assert.equal(bucket.coveragePercent, 75);
    assert.equal(bucket.coverageStatus, 'partial');
    assert.equal(bucket.coverageOfflineMs, 15 * 60 * 1000);
});

test('coverage does not pretend older history was observed', () => {
    const rows = addDataCoverage([
        { date: '2026-08-31', count: 4 },
        { date: '2026-09-01', count: 7 }
    ], { trackingStartedAt: '2026-09-01T12:00:00.000Z', downtimes: [] }, new Date('2026-09-02T00:00:00.000Z').getTime());
    assert.equal(rows[0].coverageStatus, undefined);
    assert.equal(rows[1].coverageStatus, 'unknown');
    assert.equal(rows[1].coveragePercent, null);
});
