'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const store = require('../../src/electron/plans/planStore');
const { normalizePlan } = require('../../src/shared/plans/plans');

const NOW = Date.parse('2026-10-22T12:00:00.000Z');

test('store round-trips plans through disk', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotatray-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'quotatray-plans.json');

  const data = store.emptyStore();
  store.upsertPlan(data, normalizePlan({
    id: 'p1', name: 'ChatGPT Plus', totalQuota: 300, unit: 'requests',
    sourceType: 'manual', cycle: { type: 'monthly', resetDay: 5 }
  }, NOW));
  store.saveStore(file, data);

  const loaded = store.loadStore(file);
  assert.equal(loaded.plans.length, 1);
  assert.equal(loaded.plans[0].name, 'ChatGPT Plus');
  assert.equal(loaded.plans[0].cycle.resetDay, 5);
});

test('loadStore survives missing and corrupt files', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotatray-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(store.loadStore(path.join(dir, 'absent.json')), store.emptyStore());
  const corrupt = path.join(dir, 'corrupt.json');
  fs.writeFileSync(corrupt, '{oops');
  assert.deepEqual(store.loadStore(corrupt), store.emptyStore());
});

test('snapshots dedupe per day and feed samplesForPlan', () => {
  const data = store.emptyStore();
  assert.equal(store.recordSnapshot(data, 'p1', '2026-10-20', 100), true);
  assert.equal(store.recordSnapshot(data, 'p1', '2026-10-20', 100), false);
  assert.equal(store.recordSnapshot(data, 'p1', '2026-10-21', 250), true);
  const samples = store.samplesForPlan(data, 'p1', Date.parse('2026-10-01T00:00:00.000Z'));
  assert.equal(samples.length, 2);
  assert.deepEqual(samples.map((s) => s.used), [100, 250]);
  store.removePlan(data, 'p1');
  assert.equal(store.samplesForPlan(data, 'p1', 0).length, 0);
});
