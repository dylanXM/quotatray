'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseClaudeCodeLogText,
  parseCodexLogText,
  scanClaudeCodeUsage,
  scanCodexUsage
} = require('../../src/electron/plans/localUsage');

const SINCE = Date.parse('2026-10-01T00:00:00.000Z');

function claudeLine(timestamp, usage) {
  return JSON.stringify({ timestamp, message: { usage } });
}

function codexLine(timestamp, lastUsage) {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: lastUsage, total_token_usage: lastUsage } }
  });
}

test('parseClaudeCodeLogText sums all token classes and skips junk', () => {
  const text = [
    claudeLine('2026-10-20T10:00:00.000Z', { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 40 }),
    'not json at all',
    JSON.stringify({ timestamp: '2026-10-20T11:00:00.000Z', type: 'user' }),
    claudeLine('2026-10-21T09:00:00.000Z', { input_tokens: 200, output_tokens: 100 })
  ].join('\n');
  const events = parseClaudeCodeLogText(text);
  assert.equal(events.length, 2);
  assert.equal(events[0].tokens, 200);
  assert.equal(events[1].tokens, 300);
});

test('parseCodexLogText reads per-turn deltas from token_count events', () => {
  const text = [
    codexLine('2026-10-20T10:00:00.000Z', { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 }),
    JSON.stringify({ timestamp: '2026-10-20T10:01:00.000Z', type: 'response_item', payload: {} }),
    codexLine('2026-10-20T10:05:00.000Z', { input_tokens: 500, output_tokens: 100, total_tokens: 600 })
  ].join('\n');
  const events = parseCodexLogText(text);
  assert.equal(events.length, 2);
  assert.equal(events.reduce((sum, e) => sum + e.tokens, 0), 1800);
});

test('scanners total only events inside the window and survive missing dirs', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quotatray-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const claudeDir = path.join(home, '.claude', 'projects', 'demo');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'session.jsonl'), [
    claudeLine('2026-09-15T10:00:00.000Z', { input_tokens: 999_999, output_tokens: 0 }), // before window
    claudeLine('2026-10-20T10:00:00.000Z', { input_tokens: 1000, output_tokens: 500 })
  ].join('\n'));

  const codexDir = path.join(home, '.codex', 'sessions', '2026', '10', '21');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.writeFileSync(path.join(codexDir, 'rollout-2026-10-21.jsonl'), [
    codexLine('2026-10-21T08:00:00.000Z', { input_tokens: 2000, output_tokens: 400, total_tokens: 2400 })
  ].join('\n'));

  assert.equal(scanClaudeCodeUsage(home, SINCE).totalTokens, 1500);
  assert.equal(scanCodexUsage(home, SINCE).totalTokens, 2400);
  assert.deepEqual(scanClaudeCodeUsage(path.join(home, 'nope'), SINCE), { totalTokens: 0, filesScanned: 0, eventsCounted: 0 });
});
