'use strict';

// Local-log usage readers for QuotaTray plans.
//
// These parsers read the same on-disk logs the CLIs themselves write:
//   Claude Code: ~/.claude/projects/<project>/<session>.jsonl
//     assistant entries carry message.usage { input_tokens, output_tokens,
//     cache_creation_input_tokens, cache_read_input_tokens }.
//   Codex CLI:   ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl
//     event_msg entries with payload.type === 'token_count' carry
//     payload.info.last_token_usage (per-turn delta) and
//     payload.info.total_token_usage (session cumulative).
//
// Everything here is defensive: a missing directory, an unreadable file or
// a malformed line yields zeroes, never an exception — a quota widget must
// not crash because a log rotated mid-read.

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 4000;

function tokenSum(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const parts = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens
  ];
  let total = 0;
  for (const part of parts) {
    const n = Number(part);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  if (total === 0) {
    const direct = Number(usage.total_tokens);
    if (Number.isFinite(direct) && direct > 0) return direct;
  }
  return total;
}

function parseClaudeCodeLogText(text) {
  const events = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try { entry = JSON.parse(trimmed); } catch { continue; }
    const usage = entry && entry.message && entry.message.usage ? entry.message.usage : entry && entry.usage;
    if (!usage) continue;
    const tokens = tokenSum(usage);
    if (tokens <= 0) continue;
    const t = Date.parse(entry.timestamp);
    events.push({ t: Number.isFinite(t) ? t : 0, tokens });
  }
  return events;
}

function parseCodexLogText(text) {
  const events = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try { entry = JSON.parse(trimmed); } catch { continue; }
    const payload = entry && entry.payload;
    if (!payload || payload.type !== 'token_count' || !payload.info) continue;
    const tokens = tokenSum(payload.info.last_token_usage);
    if (tokens <= 0) continue;
    const t = Date.parse(entry.timestamp);
    events.push({ t: Number.isFinite(t) ? t : 0, tokens });
  }
  return events;
}

function listJsonlFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
    }
  }
  return files;
}

function scanUsageSince(rootDir, sinceMs, parseText) {
  const result = { totalTokens: 0, filesScanned: 0, eventsCounted: 0 };
  if (!rootDir) return result;
  for (const file of listJsonlFiles(rootDir)) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.size > MAX_FILE_BYTES) continue;
    // Files last touched before the window cannot contain newer events in
    // append-only CLI logs; skipping them keeps scans cheap.
    if (stat.mtimeMs < sinceMs) continue;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    result.filesScanned += 1;
    for (const event of parseText(text)) {
      if (event.t >= sinceMs) {
        result.totalTokens += event.tokens;
        result.eventsCounted += 1;
      }
    }
  }
  return result;
}

function scanClaudeCodeUsage(homeDir, sinceMs) {
  return scanUsageSince(path.join(homeDir, '.claude', 'projects'), sinceMs, parseClaudeCodeLogText);
}

function scanCodexUsage(homeDir, sinceMs) {
  return scanUsageSince(path.join(homeDir, '.codex', 'sessions'), sinceMs, parseCodexLogText);
}

module.exports = {
  tokenSum,
  parseClaudeCodeLogText,
  parseCodexLogText,
  scanUsageSince,
  scanClaudeCodeUsage,
  scanCodexUsage
};
