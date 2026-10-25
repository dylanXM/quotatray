'use strict';

// Dev harness: opens the real QuotaTray plans panel (real IPC, real
// preload, real service) against a fixture HOME with synthetic Claude Code
// / Codex logs, then captures a screenshot for visual verification.
//
// Usage:
//   xvfb-run -a npx electron scripts/quotatray-harness.js [out.png]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-software-rasterizer');

// Headless runs must never hang forever: if the panel has not been
// captured in 90 seconds, fail loudly instead of blocking CI forever.
setTimeout(() => {
  console.error('harness: timed out before capture');
  app.exit(2);
}, 90_000);

const outPath = process.argv[2] && process.argv[2].endsWith('.png')
  ? process.argv[2]
  : path.join(os.tmpdir(), 'quotatray-panel.png');

function seedFixtureHome(home) {
  const claudeDir = path.join(home, '.claude', 'projects', 'demo');
  fs.mkdirSync(claudeDir, { recursive: true });
  const lines = [];
  for (let day = 2; day <= 21; day += 1) {
    const ts = new Date(Date.UTC(2026, 9, day, 10)).toISOString();
    lines.push(JSON.stringify({ timestamp: ts, message: { usage: { input_tokens: 60_000, output_tokens: 40_000 } } }));
  }
  fs.writeFileSync(path.join(claudeDir, 'session.jsonl'), lines.join('\n'));
  const codexDir = path.join(home, '.codex', 'sessions', '2026', '10', '20');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'rollout.jsonl'), JSON.stringify({
    timestamp: '2026-10-20T09:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 30_000, output_tokens: 10_000, total_tokens: 40_000 } } }
  }));
}

app.whenReady().then(async () => {
  console.log('harness: app ready');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'quotatray-harness-'));
  // The fixture home must be the process HOME so app.getPath('home') —
  // which attachPlans uses — points at it: launch with HOME=<fixture>.
  const fixtureHome = process.env.QT_FIXTURE_HOME || app.getPath('home');
  seedFixtureHome(fixtureHome);
  app.setPath('userData', path.join(scratch, 'userData'));

  const { attachPlans } = require('../src/electron/plans/plansService');
  const handle = attachPlans({ app, ipcMain, BrowserWindow });
  handle.service.savePlan({ name: 'Claude Code budget', totalQuota: 2_500_000, unit: 'tokens', sourceType: 'claude-code-logs', cycle: { type: 'monthly', resetDay: 1 } });
  handle.service.savePlan({ name: 'Codex budget', totalQuota: 1_000_000, unit: 'tokens', sourceType: 'codex-logs', cycle: { type: 'monthly', resetDay: 1 } });
  handle.service.savePlan({ name: 'Midjourney Standard', totalQuota: 200, unit: 'images', sourceType: 'manual', manualUsed: 172, cycle: { type: 'monthly', resetDay: 28 } });

  const win = handle.openPlansWindow();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(outPath, image.toPNG());
  console.log(`screenshot written: ${outPath}`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
