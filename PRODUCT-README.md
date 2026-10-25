# QuotaTray — AI Subscription Quota Tracker (Windows & macOS)

QuotaTray is a tray / menu-bar app that answers one question for every AI
subscription you pay for:

> **How much do I have left — and on what date does my current pace run out?**

For each plan it shows the cycle's **total quota, used, remaining**, a
quota bar, your **daily burn rate**, the **projected run-out date**, and
whether you will make it to the **reset day**.

QuotaTray is a productized build of the open-source
[Token Monitor](https://github.com/Javis603/token-monitor) (MIT, © Javis —
see `LICENSE`), extended with a subscription-plan layer
(`src/shared/plans/`, `src/electron/plans/`) that Token Monitor does not
have: user-defined plans for *arbitrary* services, with monthly / rolling /
fixed cycles and runway projections.

## How usage numbers are obtained (honest by design)

| Plan source | What happens | Label in UI |
|---|---|---|
| Claude Code logs | Reads `~/.claude/projects/**/*.jsonl` usage entries written by the CLI itself | `Auto · Claude Code logs` |
| Codex logs | Reads `~/.codex/sessions/**/*.jsonl` `token_count` events | `Auto · Codex logs` |
| Manual | You enter used-so-far and log usage with the Apply button | `Manual · estimate` |

Plus everything Token Monitor already does: token & cost tracking for 46+
coding tools, and per-provider limit windows (5-hour / weekly) read from
the providers' own usage endpoints using the login your CLI already has.

Most consumer AI subscriptions publish **no official quota API**. QuotaTray
never fakes one: every number carries its source, and every run-out date is
labelled a projection from recent pace.

## Install

Download the build for your platform from the store page:

- **Windows**: the builds arrive inside a ZIP — unzip it, then run the
  installer (or the portable build). SmartScreen may warn on first
  launch — builds are unsigned during launch; choose
  *More info → Run anyway*.
- **macOS**: unzip the ZIP for your chip and drag QuotaTray.app to
  Applications (this release is ZIP-only, no .dmg). On first launch,
  right-click the app → *Open* to pass Gatekeeper (unsigned build).

## Add your first plan

1. Click the tray / menu-bar icon → **Subscription Plans…** (or open the
   panel from the app).
2. **Add plan**: name, total quota per cycle, unit (tokens / requests /
   credits / images / …), and the usage source.
3. Pick the cycle: monthly reset day, rolling N-day window, or a fixed
   prepaid period.
4. Automatic plans fill themselves in from local logs. Manual plans: type
   today's usage into the card's *log usage* box whenever you use the
   service; the projection sharpens as daily snapshots accumulate.

## Build from source

```bash
npm ci
npm start                 # run the app in dev mode (upstream widget + plans)
npm run pack:quotatray    # branded dir build into dist/
```

Windows and macOS release artifacts are produced by the manual GitHub
Actions workflow `.github/workflows/quotatray-release.yml`
(workflow_dispatch), which builds with
`scripts/electron-builder.quotatray.js` (QuotaTray identity, upstream
auto-update feed removed).

## Privacy

100% local. No account, no telemetry, no cloud. Plan data lives in
`quotatray-plans.json` in the app's per-user data directory. Log files are
read, never modified.

## License

MIT. Token Monitor engine © 2026 Javis (see `LICENSE`); the QuotaTray
plan-layer additions are MIT as well.
