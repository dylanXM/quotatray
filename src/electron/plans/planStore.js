'use strict';

// JSON persistence for QuotaTray subscription plans.
//
// Store shape (one file, in the app's userData directory):
//   {
//     version: 1,
//     plans: [ <normalized plan>, ... ],
//     snapshots: { [planId]: { 'YYYY-MM-DD': cumulativeUsedInCycle } }
//   }
// Snapshots are the raw material for burn-rate estimation: one cumulative
// reading per day per plan, pruned to the most recent 120 days.

const fs = require('node:fs');
const path = require('node:path');

const { normalizePlan } = require('../../shared/plans/plans');

const MAX_SNAPSHOT_DAYS = 120;

function emptyStore() {
  return { version: 1, plans: [], snapshots: {} };
}

function loadStore(filePath) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch { return emptyStore(); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { return emptyStore(); }
  if (!parsed || typeof parsed !== 'object') return emptyStore();
  const plans = Array.isArray(parsed.plans)
    ? parsed.plans.map((plan) => normalizePlan(plan, plan && plan.createdAtMs)).filter((plan) => plan.name)
    : [];
  const snapshots = parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {};
  return { version: 1, plans, snapshots };
}

function saveStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function upsertPlan(store, plan) {
  const index = store.plans.findIndex((existing) => existing.id === plan.id);
  if (index >= 0) store.plans[index] = plan;
  else store.plans.push(plan);
  return plan;
}

function removePlan(store, planId) {
  store.plans = store.plans.filter((plan) => plan.id !== planId);
  delete store.snapshots[planId];
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

// Records one cumulative reading for a plan on a day. Returns true when the
// store changed (so callers can decide whether to persist).
function recordSnapshot(store, planId, key, usedCumulative) {
  if (!store.snapshots[planId]) store.snapshots[planId] = {};
  const dayMap = store.snapshots[planId];
  if (dayMap[key] === usedCumulative) return false;
  dayMap[key] = usedCumulative;
  const keys = Object.keys(dayMap).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOT_DAYS))) {
    delete dayMap[stale];
  }
  return true;
}

// Snapshot samples for a plan as [{ t, used }] points at midday UTC of each
// recorded day, restricted to the current cycle window.
function samplesForPlan(store, planId, cycleStartMs) {
  const dayMap = store.snapshots[planId] || {};
  return Object.entries(dayMap)
    .map(([key, used]) => ({ t: Date.parse(`${key}T12:00:00.000Z`), used: Number(used) || 0 }))
    .filter((sample) => Number.isFinite(sample.t) && sample.t >= cycleStartMs - 86_400_000)
    .sort((a, b) => a.t - b.t);
}

module.exports = {
  emptyStore,
  loadStore,
  saveStore,
  upsertPlan,
  removePlan,
  recordSnapshot,
  samplesForPlan,
  dateKey
};
