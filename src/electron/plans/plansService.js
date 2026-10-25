'use strict';

// QuotaTray subscription plans — main-process service.
//
// Owns the plans store (userData/quotatray-plans.json), resolves each
// plan's current usage (manual entry, or a scan of the local Claude Code /
// Codex CLI logs), records daily snapshots for burn-rate estimation, and
// serves the tray panel over IPC. Everything is local; nothing here makes
// a network call.

const path = require('node:path');

const plansEngine = require('../../shared/plans/plans');
const planStore = require('./planStore');
const { scanClaudeCodeUsage, scanCodexUsage } = require('./localUsage');

const STORE_FILENAME = 'quotatray-plans.json';

function resolveUsedNow(plan, homeDir, cycleStartMs) {
  if (plan.sourceType === 'claude-code-logs') {
    return scanClaudeCodeUsage(homeDir, cycleStartMs).totalTokens + (plan.manualAdjust || 0);
  }
  if (plan.sourceType === 'codex-logs') {
    return scanCodexUsage(homeDir, cycleStartMs).totalTokens + (plan.manualAdjust || 0);
  }
  return plan.manualUsed || 0;
}

function createPlansService({ configPath, homeDir, nowFn } = {}) {
  const now = typeof nowFn === 'function' ? nowFn : () => Date.now();

  function getState() {
    const store = planStore.loadStore(configPath);
    const nowMs = now();
    let dirty = false;
    const states = store.plans.map((plan) => {
      const bounds = plansEngine.cycleBounds(plan, nowMs);
      const usedNow = Math.max(0, resolveUsedNow(plan, homeDir, bounds.startMs));
      const todayKey = planStore.dateKey(new Date(nowMs));
      if (planStore.recordSnapshot(store, plan.id, todayKey, usedNow)) dirty = true;
      const samples = planStore.samplesForPlan(store, plan.id, bounds.startMs);
      return plansEngine.computePlanState(plan, { usedNow, samples, nowMs });
    });
    if (dirty) {
      try { planStore.saveStore(configPath, store); } catch { /* panel still renders */ }
    }
    return {
      generatedAt: new Date(nowMs).toISOString(),
      states: plansEngine.sortStates(states),
      plans: store.plans
    };
  }

  function savePlan(rawPlan) {
    const plan = plansEngine.normalizePlan(rawPlan);
    const errors = plansEngine.validatePlan(plan);
    if (errors.length) throw new Error(errors.join('; '));
    const store = planStore.loadStore(configPath);
    planStore.upsertPlan(store, plan);
    planStore.saveStore(configPath, store);
    return getState();
  }

  function deletePlan(planId) {
    const store = planStore.loadStore(configPath);
    planStore.removePlan(store, String(planId));
    planStore.saveStore(configPath, store);
    return getState();
  }

  // Quick usage logging from the panel: for manual plans it moves the
  // entered total; for log-backed plans it records an offset (e.g. usage
  // that happened on another machine and never hit these logs).
  function adjustPlan(planId, delta) {
    const store = planStore.loadStore(configPath);
    const plan = store.plans.find((candidate) => candidate.id === String(planId));
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    const amount = Number(delta) || 0;
    if (plan.sourceType === 'manual') {
      plan.manualUsed = Math.max(0, (plan.manualUsed || 0) + amount);
    } else {
      plan.manualAdjust = (plan.manualAdjust || 0) + amount;
    }
    planStore.saveStore(configPath, store);
    return getState();
  }

  return { getState, savePlan, deletePlan, adjustPlan };
}

// Registers IPC handlers and returns a handle with openPlansWindow().
// Deps are injected so this module can be exercised from a test harness
// without the full application.
function attachPlans({ app, ipcMain, BrowserWindow }) {
  const service = createPlansService({
    configPath: path.join(app.getPath('userData'), STORE_FILENAME),
    homeDir: app.getPath('home')
  });

  let plansWindow = null;
  function openPlansWindow() {
    if (plansWindow && !plansWindow.isDestroyed()) {
      if (plansWindow.isMinimized()) plansWindow.restore();
      plansWindow.focus();
      return plansWindow;
    }
    plansWindow = new BrowserWindow({
      width: 440,
      height: 680,
      minWidth: 380,
      minHeight: 480,
      title: 'QuotaTray — Subscription Plans',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'plansPreload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    plansWindow.on('closed', () => { plansWindow = null; });
    plansWindow.loadFile(path.join(__dirname, '..', 'renderer', 'plans.html'));
    return plansWindow;
  }

  ipcMain.handle('quotatray:plans:getState', () => service.getState());
  ipcMain.handle('quotatray:plans:save', (_event, plan) => service.savePlan(plan));
  ipcMain.handle('quotatray:plans:delete', (_event, planId) => service.deletePlan(planId));
  ipcMain.handle('quotatray:plans:adjust', (_event, planId, delta) => service.adjustPlan(planId, delta));
  ipcMain.handle('quotatray:plans:open', () => { openPlansWindow(); return true; });

  return { service, openPlansWindow };
}

module.exports = { createPlansService, attachPlans, STORE_FILENAME };
