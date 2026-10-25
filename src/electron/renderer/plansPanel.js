'use strict';

// QuotaTray subscription-plans panel.
// Talks to the main process through window.quotaTrayPlans (plansPreload.js).
// When the bridge is absent (plain browser / headless preview), it renders
// a clearly-labelled demo from the shared engine instead of failing.

(function initPlansPanel() {
  const bridge = window.quotaTrayPlans || null;
  const engine = window.QuotaTrayPlans || null;

  const els = {
    cards: document.getElementById('qt-cards'),
    empty: document.getElementById('qt-empty'),
    error: document.getElementById('qt-error'),
    demo: document.getElementById('qt-demo-banner'),
    form: document.getElementById('qt-form'),
    formTitle: document.getElementById('qt-form-title'),
    addToggle: document.getElementById('qt-add-toggle')
  };

  const fmt = new Intl.NumberFormat('en-US');
  const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

  function formatAmount(value, unit) {
    const n = Number(value) || 0;
    const rendered = Math.abs(n) >= 100_000 ? fmtCompact.format(n) : fmt.format(Math.round(n * 100) / 100);
    return `${rendered} ${unit}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const date = new Date(`${iso}T12:00:00.000Z`);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  const SOURCE_LABELS = {
    manual: 'Manual · estimate',
    'claude-code-logs': 'Auto · Claude Code logs',
    'codex-logs': 'Auto · Codex logs'
  };

  function runwayText(state) {
    if (state.status === 'exhausted') return 'Used up for this cycle';
    if (state.projectedDaysLeft !== null && state.projectedDaysLeft !== undefined) {
      const days = state.projectedDaysLeft < 10
        ? (Math.round(state.projectedDaysLeft * 10) / 10).toString()
        : String(Math.round(state.projectedDaysLeft));
      const tail = state.willLastUntilReset
        ? ` · resets ${formatDate(state.resetDate)}`
        : ` · runs out ~${formatDate(state.projectedRunOutDate)}`;
      return `≈ ${days} days left <span class="qt-dim">at current pace${tail}</span>`;
    }
    if (state.used > 0) return `On track so far <span class="qt-dim">· resets ${formatDate(state.resetDate)}</span>`;
    return `No usage recorded yet <span class="qt-dim">· resets ${formatDate(state.resetDate)}</span>`;
  }

  function burnText(state) {
    const parts = [];
    if (state.dailyBurn) {
      const basis = { 'last-7-days': 'last 7 days', 'cycle-to-date': 'this cycle', 'cycle-average': 'cycle average' }[state.burnBasis] || '';
      parts.push(`≈ ${formatAmount(state.dailyBurn, state.unit)}/day (${basis})`);
    }
    parts.push(`${state.daysLeftInCycle} days until reset`);
    return parts.join(' · ');
  }

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function renderCard(state, rawPlan) {
    const card = el('article', 'qt-card');
    const top = el('div', 'qt-card-top');
    top.appendChild(el('span', 'qt-card-name', escapeHtml(state.name)));
    top.appendChild(el('span', 'qt-badge', SOURCE_LABELS[state.sourceType] || state.sourceType));
    card.appendChild(top);

    card.appendChild(el('div', 'qt-runway', runwayText(state)));

    const bar = el('div', 'qt-bar');
    const fill = el('div', 'qt-bar-fill');
    fill.dataset.status = state.status;
    fill.style.width = `${Math.min(100, Math.max(0, state.percentUsed * 100))}%`;
    bar.appendChild(fill);
    card.appendChild(bar);

    card.appendChild(el('div', 'qt-stats',
      `${formatAmount(state.used, state.unit)} used of ${formatAmount(state.total, state.unit)} · ${formatAmount(state.remaining, state.unit)} left`));
    card.appendChild(el('div', 'qt-meta', escapeHtml(burnText(state))));

    const actions = el('div', 'qt-card-actions');
    const editBtn = el('button', 'qt-btn', 'Edit');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openForm(rawPlan));
    const deleteBtn = el('button', 'qt-btn qt-btn-danger', 'Delete');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', async () => {
      if (!bridge) return;
      await call(() => bridge.deletePlan(state.id));
    });
    actions.append(editBtn, deleteBtn);

    const adjust = el('div', 'qt-adjust');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.placeholder = state.sourceType === 'manual' ? 'log usage…' : 'adjust ±…';
    const apply = el('button', 'qt-btn', 'Apply');
    apply.type = 'button';
    apply.addEventListener('click', async () => {
      const amount = Number(input.value);
      if (!bridge || !Number.isFinite(amount) || amount === 0) return;
      const delta = state.sourceType === 'manual' ? amount : amount;
      await call(() => bridge.adjustPlan(state.id, delta));
    });
    adjust.append(input, apply);
    actions.appendChild(adjust);
    card.appendChild(actions);
    return card;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  let currentPlans = [];

  function render(state) {
    currentPlans = state.plans || [];
    const byId = new Map(currentPlans.map((plan) => [plan.id, plan]));
    els.cards.replaceChildren();
    for (const planState of state.states || []) {
      els.cards.appendChild(renderCard(planState, byId.get(planState.id)));
    }
    els.empty.hidden = (state.states || []).length > 0;
  }

  function showError(error) {
    els.error.hidden = false;
    els.error.textContent = error && error.message ? error.message : String(error);
  }

  async function call(fn) {
    try {
      els.error.hidden = true;
      const state = await fn();
      if (state) render(state);
    } catch (error) {
      showError(error);
    }
  }

  // ---- form -------------------------------------------------------------
  const fields = {
    id: document.getElementById('f-id'),
    name: document.getElementById('f-name'),
    total: document.getElementById('f-total'),
    unit: document.getElementById('f-unit'),
    source: document.getElementById('f-source'),
    manualUsed: document.getElementById('f-manual-used'),
    manualWrap: document.getElementById('f-manual-wrap'),
    cycleType: document.getElementById('f-cycle-type'),
    resetDay: document.getElementById('f-reset-day'),
    resetWrap: document.getElementById('f-reset-wrap'),
    lengthDays: document.getElementById('f-length-days'),
    lengthWrap: document.getElementById('f-length-wrap'),
    fixedWrap: document.getElementById('f-fixed-wrap'),
    start: document.getElementById('f-start'),
    end: document.getElementById('f-end')
  };

  function syncFormVisibility() {
    const cycle = fields.cycleType.value;
    fields.resetWrap.hidden = cycle !== 'monthly';
    fields.lengthWrap.hidden = cycle !== 'rolling';
    fields.fixedWrap.hidden = cycle !== 'fixed';
    fields.manualWrap.hidden = fields.source.value !== 'manual';
  }

  function openForm(plan) {
    els.form.hidden = false;
    els.formTitle.textContent = plan ? `Edit ${plan.name}` : 'Add a plan';
    fields.id.value = plan ? plan.id : '';
    fields.name.value = plan ? plan.name : '';
    fields.total.value = plan ? plan.totalQuota : '';
    fields.unit.value = plan ? plan.unit : 'tokens';
    fields.source.value = plan ? plan.sourceType : 'manual';
    fields.manualUsed.value = plan ? (plan.manualUsed || 0) : 0;
    const cycle = (plan && plan.cycle) || { type: 'monthly', resetDay: 1 };
    fields.cycleType.value = cycle.type || 'monthly';
    fields.resetDay.value = cycle.resetDay || 1;
    fields.lengthDays.value = cycle.lengthDays || 30;
    fields.start.value = cycle.startDate || '';
    fields.end.value = cycle.endDate || '';
    syncFormVisibility();
    fields.name.focus();
  }

  function closeForm() { els.form.hidden = true; }

  els.addToggle.addEventListener('click', () => {
    if (els.form.hidden) openForm(null);
    else closeForm();
  });
  document.getElementById('qt-form-cancel').addEventListener('click', closeForm);
  fields.cycleType.addEventListener('change', syncFormVisibility);
  fields.source.addEventListener('change', syncFormVisibility);

  els.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!bridge) { showError(new Error('Editing is disabled in the demo preview.')); return; }
    const cycleType = fields.cycleType.value;
    const cycle = { type: cycleType };
    if (cycleType === 'monthly') cycle.resetDay = Number(fields.resetDay.value) || 1;
    if (cycleType === 'rolling') cycle.lengthDays = Number(fields.lengthDays.value) || 30;
    if (cycleType === 'fixed') { cycle.startDate = fields.start.value; cycle.endDate = fields.end.value; }
    const plan = {
      id: fields.id.value || undefined,
      name: fields.name.value,
      totalQuota: Number(fields.total.value),
      unit: fields.unit.value || 'tokens',
      sourceType: fields.source.value,
      manualUsed: Number(fields.manualUsed.value) || 0,
      cycle
    };
    await call(() => bridge.savePlan(plan));
    closeForm();
  });

  // ---- boot ---------------------------------------------------------------
  if (bridge) {
    call(() => bridge.getState());
  } else {
    els.demo.hidden = false;
    els.addToggle.disabled = true;
    render(demoState());
  }

  function demoState() {
    const now = Date.now();
    const DAY = 86_400_000;
    const defs = [
      {
        raw: { id: 'demo-claude', name: 'Claude Code (Max plan)', unit: 'tokens', totalQuota: 5_000_000, sourceType: 'claude-code-logs', cycle: { type: 'monthly', resetDay: 1 } },
        used: 3_150_000,
        samples: [{ t: now - 6 * DAY, used: 1_900_000 }, { t: now - 2 * DAY, used: 2_700_000 }, { t: now, used: 3_150_000 }]
      },
      {
        raw: { id: 'demo-gpt', name: 'ChatGPT Plus', unit: 'messages', totalQuota: 1_000, sourceType: 'manual', manualUsed: 655, cycle: { type: 'monthly', resetDay: 12 } },
        used: 655,
        samples: [{ t: now - 5 * DAY, used: 380 }, { t: now, used: 655 }]
      },
      {
        raw: { id: 'demo-mj', name: 'Midjourney Standard', unit: 'images', totalQuota: 200, sourceType: 'manual', manualUsed: 193, cycle: { type: 'monthly', resetDay: 28 } },
        used: 193,
        samples: [{ t: now - 3 * DAY, used: 120 }, { t: now, used: 193 }]
      }
    ];
    const states = defs.map((def) => {
      const plan = engine.normalizePlan(def.raw, now);
      return engine.computePlanState(plan, { usedNow: def.used, samples: def.samples, nowMs: now });
    });
    return { generatedAt: new Date(now).toISOString(), states: engine.sortStates(states), plans: defs.map((d) => d.raw) };
  }
})();
