'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const plans = require('../../src/shared/plans/plans');

const DAY = plans.DAY_MS;
const NOW = Date.parse('2026-10-22T12:00:00.000Z');

function monthlyPlan(overrides = {}) {
  return plans.normalizePlan({
    id: 'p1',
    name: 'Claude Pro',
    unit: 'tokens',
    totalQuota: 1_000_000,
    sourceType: 'manual',
    cycle: { type: 'monthly', resetDay: 1 },
    ...overrides
  }, NOW);
}

test('cycleBounds: monthly reset day splits the month correctly', () => {
  const plan = monthlyPlan({ cycle: { type: 'monthly', resetDay: 15 } });
  const bounds = plans.cycleBounds(plan, NOW);
  assert.equal(new Date(bounds.startMs).toISOString(), '2026-10-15T00:00:00.000Z');
  assert.equal(new Date(bounds.endMs).toISOString(), '2026-11-15T00:00:00.000Z');
});

test('cycleBounds: before the reset day the cycle started last month', () => {
  const plan = monthlyPlan({ cycle: { type: 'monthly', resetDay: 25 } });
  const bounds = plans.cycleBounds(plan, NOW);
  assert.equal(new Date(bounds.startMs).toISOString(), '2026-09-25T00:00:00.000Z');
  assert.equal(new Date(bounds.endMs).toISOString(), '2026-10-25T00:00:00.000Z');
});

test('cycleBounds: rolling cycle anchors on creation time', () => {
  const anchor = NOW - 10 * DAY;
  const plan = plans.normalizePlan({
    id: 'p2', name: 'Rolling', totalQuota: 100, sourceType: 'manual',
    cycle: { type: 'rolling', lengthDays: 30, anchorMs: anchor }
  }, NOW);
  const bounds = plans.cycleBounds(plan, NOW);
  assert.equal(bounds.startMs, anchor);
  assert.equal(bounds.endMs, anchor + 30 * DAY);
});

test('computePlanState: on-track plan projects past the reset', () => {
  const plan = monthlyPlan();
  const state = plans.computePlanState(plan, {
    nowMs: NOW,
    usedNow: 110_000,
    samples: [
      { t: NOW - 11 * DAY, used: 10_000 },
      { t: NOW, used: 110_000 }
    ]
  });
  // Burn ≈ 100k / 11 days ≈ 9091/day; 890k left lasts ~98 days >> cycle.
  assert.equal(state.status, 'on-track');
  assert.equal(state.willLastUntilReset, true);
  assert.equal(state.remaining, 890_000);
  assert.equal(state.resetDate, '2026-11-01');
  assert.ok(state.projectedDaysLeft > 30);
});

test('computePlanState: fast burn projects a run-out date before reset', () => {
  const plan = monthlyPlan();
  const state = plans.computePlanState(plan, {
    nowMs: NOW,
    usedNow: 600_000,
    samples: [
      { t: NOW - 2 * DAY, used: 100_000 },
      { t: NOW, used: 600_000 }
    ]
  });
  // Burn = 250k/day; 400k left → 1.6 days → runs out ~Oct 24, reset Nov 1.
  assert.equal(state.dailyBurn, 250_000);
  assert.equal(state.projectedRunOutDate, '2026-10-24');
  assert.equal(state.willLastUntilReset, false);
  // Runs out ~7.9 days before the reset → warning band (>= 2 days margin).
  assert.equal(state.status, 'warning');
});

test('computePlanState: exhausted plan reports exhausted', () => {
  const plan = monthlyPlan();
  const state = plans.computePlanState(plan, { nowMs: NOW, usedNow: 1_200_000, samples: [] });
  assert.equal(state.status, 'exhausted');
  assert.equal(state.remaining, 0);
  assert.equal(state.percentUsed, 1.2);
});

test('computePlanState: no usage evidence is honest unknown, not zero-risk', () => {
  const plan = monthlyPlan();
  const state = plans.computePlanState(plan, { nowMs: NOW, usedNow: 0, samples: [] });
  assert.equal(state.status, 'unknown');
  assert.equal(state.dailyBurn, null);
  assert.equal(state.projectedRunOutDate, null);
});

test('computePlanState: falls back to cycle-average burn without samples', () => {
  const plan = monthlyPlan();
  const state = plans.computePlanState(plan, { nowMs: NOW, usedNow: 210_000, samples: [] });
  // Cycle started Oct 1, now Oct 22 12:00 → 21.5 days elapsed → ~9767/day.
  assert.equal(state.burnBasis, 'cycle-average');
  assert.ok(state.dailyBurn > 9_000 && state.dailyBurn < 10_500);
});

test('validatePlan rejects bad shapes', () => {
  assert.ok(plans.validatePlan({ name: '', totalQuota: 100, sourceType: 'manual', cycle: { type: 'monthly', resetDay: 1 } }).length > 0);
  assert.ok(plans.validatePlan({ name: 'X', totalQuota: -5, sourceType: 'manual', cycle: { type: 'monthly', resetDay: 1 } }).length > 0);
  assert.ok(plans.validatePlan({ name: 'X', totalQuota: 5, sourceType: 'magic', cycle: { type: 'monthly', resetDay: 1 } }).length > 0);
  assert.ok(plans.validatePlan({ name: 'X', totalQuota: 5, sourceType: 'manual', cycle: { type: 'monthly', resetDay: 31 } }).length > 0);
  assert.deepEqual(plans.validatePlan(monthlyPlan()), []);
});

test('sortStates puts exhausted first and unknown last', () => {
  const states = [
    { id: 'a', status: 'unknown', percentUsed: 0 },
    { id: 'b', status: 'on-track', percentUsed: 0.5 },
    { id: 'c', status: 'exhausted', percentUsed: 1 },
    { id: 'd', status: 'critical', percentUsed: 0.9 }
  ];
  assert.deepEqual(plans.sortStates(states).map((s) => s.id), ['c', 'd', 'b', 'a']);
});
