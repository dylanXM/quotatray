'use strict';

(function exposeQuotaTrayPlans(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuotaTrayPlans = api;
})(typeof window !== 'undefined' ? window : null, function createQuotaTrayPlansApi() {
  const DAY_MS = 86_400_000;

  const SOURCE_TYPES = ['manual', 'claude-code-logs', 'codex-logs'];
  const CYCLE_TYPES = ['monthly', 'rolling', 'fixed'];

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function clampResetDay(day) {
    const n = Math.round(Number(day));
    if (!Number.isFinite(n)) return 1;
    // 28 max so the reset day exists in every month, February included.
    return Math.min(28, Math.max(1, n));
  }

  function utcDateMs(year, monthIndex, day) {
    return Date.UTC(year, monthIndex, day);
  }

  // Current cycle [startMs, endMs) for a plan at `nowMs`.
  // Monthly cycles are anchored to a reset day in UTC so results are
  // identical in tests and in the app regardless of local timezone drift
  // within a day; the UI renders dates locally.
  function cycleBounds(plan, nowMs) {
    const cycle = (plan && plan.cycle) || { type: 'monthly', resetDay: 1 };
    if (cycle.type === 'rolling') {
      const lengthDays = Math.max(1, Number(cycle.lengthDays) || 30);
      const anchor = isFiniteNumber(cycle.anchorMs) ? cycle.anchorMs : (plan.createdAtMs || 0);
      const lengthMs = lengthDays * DAY_MS;
      const k = Math.floor((nowMs - anchor) / lengthMs);
      const startMs = anchor + k * lengthMs;
      return { startMs, endMs: startMs + lengthMs };
    }
    if (cycle.type === 'fixed') {
      const startMs = Date.parse(cycle.startDate);
      const endMs = Date.parse(cycle.endDate);
      return {
        startMs: Number.isFinite(startMs) ? startMs : nowMs,
        endMs: Number.isFinite(endMs) ? endMs : nowMs + 30 * DAY_MS
      };
    }
    // monthly
    const resetDay = clampResetDay(cycle.resetDay);
    const now = new Date(nowMs);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const thisReset = utcDateMs(year, month, resetDay);
    if (nowMs >= thisReset) {
      return { startMs: thisReset, endMs: utcDateMs(year, month + 1, resetDay) };
    }
    return { startMs: utcDateMs(year, month - 1, resetDay), endMs: thisReset };
  }

  // Burn rate (quota units per day) from cumulative-in-cycle samples.
  // samples: [{ t, used }] — used is cumulative usage inside the cycle.
  // Prefers the last 7 days when they contain a usable span; otherwise the
  // whole cycle span; otherwise falls back to used/elapsed. Returns null
  // when there is no evidence of consumption at all.
  function computeDailyBurn(samples, usedNow, bounds, nowMs) {
    const points = (Array.isArray(samples) ? samples : [])
      .filter((s) => s && isFiniteNumber(s.t) && isFiniteNumber(s.used))
      .filter((s) => s.t >= bounds.startMs - DAY_MS && s.t <= nowMs + 60_000)
      .sort((a, b) => a.t - b.t);
    // Always include the live point so a single stored snapshot is enough.
    if (!points.length || points[points.length - 1].t < nowMs - 60_000) {
      points.push({ t: nowMs, used: usedNow });
    }
    const rate = (from, to) => {
      const dtDays = (to.t - from.t) / DAY_MS;
      if (dtDays < 0.25) return null;
      const delta = to.used - from.used;
      if (delta <= 0) return null;
      return delta / dtDays;
    };
    const last = points[points.length - 1];
    const weekAgo = nowMs - 7 * DAY_MS;
    const weekPoints = points.filter((s) => s.t >= weekAgo);
    if (weekPoints.length >= 2) {
      const r = rate(weekPoints[0], last);
      if (r !== null) return { dailyBurn: r, basis: 'last-7-days' };
    }
    if (points.length >= 2) {
      const r = rate(points[0], last);
      if (r !== null) return { dailyBurn: r, basis: 'cycle-to-date' };
    }
    const elapsedDays = (nowMs - bounds.startMs) / DAY_MS;
    if (usedNow > 0 && elapsedDays >= 0.25) {
      return { dailyBurn: usedNow / elapsedDays, basis: 'cycle-average' };
    }
    return { dailyBurn: null, basis: 'none' };
  }

  function dateStr(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  // input: { usedNow, samples, nowMs }
  function computePlanState(plan, input) {
    const nowMs = input && isFiniteNumber(input.nowMs) ? input.nowMs : Date.now();
    const usedNow = Math.max(0, Number(input && input.usedNow) || 0);
    const total = Math.max(0, Number(plan.totalQuota) || 0);
    const bounds = cycleBounds(plan, nowMs);
    const remaining = Math.max(0, total - usedNow);
    const percentUsed = total > 0 ? usedNow / total : 0;
    const daysLeftInCycle = Math.max(0, (bounds.endMs - nowMs) / DAY_MS);
    const burn = computeDailyBurn(input && input.samples, usedNow, bounds, nowMs);

    let projectedDaysLeft = null;
    let projectedRunOutMs = null;
    let willLastUntilReset = null;
    if (burn.dailyBurn !== null && burn.dailyBurn > 0 && remaining > 0) {
      projectedDaysLeft = remaining / burn.dailyBurn;
      projectedRunOutMs = nowMs + projectedDaysLeft * DAY_MS;
      willLastUntilReset = projectedRunOutMs >= bounds.endMs - 12 * 3_600_000;
    }

    let status;
    if (total > 0 && usedNow >= total) status = 'exhausted';
    else if (willLastUntilReset === false) {
      const marginDays = (bounds.endMs - projectedRunOutMs) / DAY_MS;
      status = marginDays >= 2 ? 'warning' : 'critical';
    } else if (willLastUntilReset === true) status = 'on-track';
    else status = 'unknown';

    return {
      id: plan.id,
      name: plan.name,
      unit: plan.unit || 'units',
      sourceType: plan.sourceType,
      isEstimate: plan.sourceType === 'manual',
      total,
      used: usedNow,
      remaining,
      percentUsed,
      cycleStart: dateStr(bounds.startMs),
      cycleEnd: dateStr(bounds.endMs),
      resetDate: dateStr(bounds.endMs),
      daysLeftInCycle: Math.round(daysLeftInCycle * 10) / 10,
      dailyBurn: burn.dailyBurn === null ? null : Math.round(burn.dailyBurn * 100) / 100,
      burnBasis: burn.basis,
      projectedDaysLeft: projectedDaysLeft === null ? null : Math.round(projectedDaysLeft * 10) / 10,
      projectedRunOutDate: projectedRunOutMs === null ? null : dateStr(projectedRunOutMs),
      willLastUntilReset,
      status
    };
  }

  const STATUS_RANK = { exhausted: 0, critical: 1, warning: 2, 'on-track': 3, unknown: 4 };

  function sortStates(states) {
    return [...states].sort((a, b) => {
      const rankDiff = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return b.percentUsed - a.percentUsed;
    });
  }

  function validatePlan(plan) {
    const errors = [];
    if (!plan || typeof plan !== 'object') return ['plan must be an object'];
    if (!String(plan.name || '').trim()) errors.push('name is required');
    if (!(Number(plan.totalQuota) > 0)) errors.push('totalQuota must be a positive number');
    if (!SOURCE_TYPES.includes(plan.sourceType)) errors.push(`sourceType must be one of ${SOURCE_TYPES.join(', ')}`);
    const cycle = plan.cycle || {};
    if (!CYCLE_TYPES.includes(cycle.type)) errors.push(`cycle.type must be one of ${CYCLE_TYPES.join(', ')}`);
    if (cycle.type === 'monthly' && clampResetDay(cycle.resetDay) !== Number(cycle.resetDay)) {
      errors.push('cycle.resetDay must be an integer between 1 and 28');
    }
    if (cycle.type === 'rolling' && !(Number(cycle.lengthDays) >= 1)) {
      errors.push('cycle.lengthDays must be at least 1');
    }
    if (cycle.type === 'fixed') {
      const s = Date.parse(cycle.startDate);
      const e = Date.parse(cycle.endDate);
      if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
        errors.push('fixed cycle needs a valid startDate before endDate');
      }
    }
    return errors;
  }

  let fallbackIdCounter = 0;
  function normalizePlan(raw, nowMs) {
    const now = isFiniteNumber(nowMs) ? nowMs : Date.now();
    const cycleIn = (raw && raw.cycle) || {};
    const cycle = { type: CYCLE_TYPES.includes(cycleIn.type) ? cycleIn.type : 'monthly' };
    if (cycle.type === 'monthly') cycle.resetDay = clampResetDay(cycleIn.resetDay ?? 1);
    if (cycle.type === 'rolling') {
      cycle.lengthDays = Math.max(1, Math.round(Number(cycleIn.lengthDays) || 30));
      cycle.anchorMs = isFiniteNumber(cycleIn.anchorMs) ? cycleIn.anchorMs : now;
    }
    if (cycle.type === 'fixed') {
      cycle.startDate = String(cycleIn.startDate || dateStr(now));
      cycle.endDate = String(cycleIn.endDate || dateStr(now + 30 * DAY_MS));
    }
    fallbackIdCounter += 1;
    return {
      id: String((raw && raw.id) || `plan-${now.toString(36)}-${fallbackIdCounter}`),
      name: String((raw && raw.name) || '').trim(),
      unit: String((raw && raw.unit) || 'tokens').trim() || 'tokens',
      totalQuota: Math.max(0, Number(raw && raw.totalQuota) || 0),
      sourceType: SOURCE_TYPES.includes(raw && raw.sourceType) ? raw.sourceType : 'manual',
      manualUsed: Math.max(0, Number(raw && raw.manualUsed) || 0),
      manualAdjust: Number(raw && raw.manualAdjust) || 0,
      cycle,
      createdAtMs: isFiniteNumber(raw && raw.createdAtMs) ? raw.createdAtMs : now
    };
  }

  return {
    DAY_MS,
    SOURCE_TYPES,
    CYCLE_TYPES,
    clampResetDay,
    cycleBounds,
    computeDailyBurn,
    computePlanState,
    sortStates,
    validatePlan,
    normalizePlan
  };
});
