# TimeFarm – Offline Time Tracker & Earnings Dashboard for Windows

<p align="center">
  <img src="assets/timefarm-avatar.png" width="168" alt="TimeFarm offline time tracker and freelancer earnings dashboard for Windows" />
</p>

<p align="center">
  <strong>Track focused work. Record real earnings. Understand where your time goes.</strong><br />
  <sub>Ứng dụng chấm công, quản lý dự án và phân tích thu nhập dành cho Windows.</sub>
</p>

<p align="center">
  <a href="https://github.com/qvinh8726/timefarm/actions/workflows/ci.yml"><img alt="TimeFarm CI" src="https://github.com/qvinh8726/timefarm/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/qvinh8726/timefarm/releases"><img alt="Latest TimeFarm release" src="https://img.shields.io/github/v/release/qvinh8726/timefarm?include_prereleases&sort=semver&label=release" /></a>
  <img alt="Windows 10 and Windows 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white" />
  <img alt="Offline first" src="https://img.shields.io/badge/offline--first-SQLite-0F9889" />
  <a href="LICENSE"><img alt="All rights reserved license" src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" /></a>
</p>

<p align="center">
  <a href="https://github.com/qvinh8726/timefarm/releases/download/v0.2.1/TimeFarm-0.2.1-Setup.exe"><strong>Download TimeFarm v0.2.1 for Windows</strong></a>
  ·
  <a href="https://github.com/qvinh8726/timefarm/releases/tag/v0.2.1">Release notes</a>
</p>

**TimeFarm** is an offline-first Windows time tracker, project timer, freelancer earnings tracker, and productivity analytics dashboard in one focused desktop app. It keeps accurate work sessions locally in SQLite, records money in its original currency, and turns completed work into clear daily, project, goal, and income insights.

TimeFarm works without an internet connection. Supabase sign-in and multi-device synchronization are optional, so the core timer and local work history never depend on a cloud service being available.

> **v0.2.1 is a beta pre-release.** The installer is not digitally signed, so Windows SmartScreen may show a warning. Hosted multi-device sync still requires the included Supabase migrations and real-device validation. Local/offline-first usage is the recommended path for this release.

## What’s new in TimeFarm v0.2.1

- **Clean Windows chrome:** removed Electron’s generated File/Edit/View/Window menu from the application and every app window, including after pressing Alt.
- **Dashboard layout hotfix:** fixed a stale CSS cascade that squeezed dashboard widgets into unusable columns, balanced the default widget arrangement, and made tablet cards reliably use the available width.
- **Responsive polish:** compact icon navigation now starts before the sidebar becomes cramped, while sync/customize controls stay clean and readable on mobile.
- **Complete UI/UX redesign:** calmer visual hierarchy, responsive layouts, polished light/dark themes, keyboard focus, reduced motion, and accessible dialogs.
- **Today command center:** active timer, daily pulse, configurable goals, earnings trends, project distribution, comparisons, and cumulative charts.
- **Deeper analytics:** 7-day to 1-year ranges, timezone-correct day boundaries, goal pace, efficiency ranking, duration distribution, and data-backed observations.
- **Safer offline overlap handling:** overlapping completed sessions count once in account-time totals while every session, earning, and project record stays intact.
- **Stronger local data:** ordered transactional SQLite migrations, integrity checks, crash recovery, native recovery export, and one-time legacy import.
- **Safer cloud sync:** atomic workspace claims, paginated bootstrap, pull-before-push, optimistic revisions, RPC deadlines, and explicit conflict resolution.
- **Verified reference FX:** Frankfurter v2 rates, complete VND/USD/EUR/JPY/GBP coverage, bounded network time, visible source date, and stale-cache status.
- **Release-grade checks:** 137 automated tests, accessibility coverage, bundle budgets, pinned workflows, packaged Electron smoke, and NSIS install/render/uninstall smoke.

## Why use TimeFarm?

| Need                          | How TimeFarm helps                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Accurate work hours           | Timestamp and pause-interval accounting survives renderer refreshes and app restarts.                      |
| Fast project tracking         | Create a project, start work, pause, resume, and finish from one compact workflow.                         |
| Real freelancer earnings      | Record the amount actually earned per session without rewriting original currencies.                       |
| Useful productivity analytics | Compare active time, earnings, effective hourly rate, projects, goals, and prior periods.                  |
| Offline reliability           | SQLite, WAL, transactions, and a durable outbox keep local work available without a network.               |
| Optional multi-device sync    | Authenticated Supabase synchronization is available when its migrations and OAuth settings are configured. |
| Native Windows workflow       | Use the full dashboard or a small always-available mini timer with persisted positioning.                  |

## Core features

### Work timer and session history

- Start, pause, resume, complete, recover, or discard an unfinished work session.
- Calculate active duration from persisted timestamps while excluding pauses.
- Protect completed history from unsafe deletion and arbitrary edits.
- Edit only the latest eligible completed session.
- Browse paginated history with project, notes, earnings, currency, and timestamps.

### Projects, payments, and goals

- Create projects with colors, icons, payment models, status, and expected currency.
- Record session earnings separately from project payment history.
- Protect projects that already have retained session or payment history.
- Create daily, weekly, and monthly time/earnings goals plus completed-project goals.
- See target progress, expected pace, remaining value, and projected completion.

### Dashboard and analytics

- Reorder, resize, or hide dashboard widgets.
- Review daily pulse, active timer, goals, earnings, project distribution, and comparisons.
- Explore analytics across 7D, 30D, 1M, 3M, 6M, and 1Y ranges.
- Split cross-midnight work using the account’s stored IANA timezone.
- Count overlapping active intervals once in account totals and time goals.
- Keep earnings and project allocation as original historical facts.

### Money and reference conversion

- Store money in safe integer minor units.
- Keep VND, USD, EUR, JPY, and GBP records in their original currency.
- Calculate effective hourly rates only with compatible earning/time denominators.
- Use [Frankfurter v2](https://frankfurter.dev/) for optional reference conversion.
- Reject incomplete, future-dated, or source data older than seven days.
- Mark cache older than 24 hours as stale instead of silently presenting it as current.

### Local-first and cloud synchronization

- Continue local work when Supabase is missing, offline, or temporarily unavailable.
- Encrypt supported auth/session material through Electron secure storage.
- Bootstrap an empty device before local onboarding can overwrite cloud history.
- Pull remote changes before pushing pending local operations.
- Preserve conflicts and let the user choose **Keep local & retry** or **Use cloud version**.
- Use an online timer lease to reduce two authenticated devices starting simultaneously.

## Download and install on Windows

1. Download [`TimeFarm-0.2.1-Setup.exe`](https://github.com/qvinh8726/timefarm/releases/download/v0.2.1/TimeFarm-0.2.1-Setup.exe).
2. Run the installer on Windows 10 or Windows 11 x64.
3. Choose the installation directory when prompted.
4. Create a local profile and start tracking work.

Because v0.2.1 is unsigned, Windows SmartScreen may require **More info → Run anyway**. Verify the SHA-256 value published in the GitHub Release before running the installer.

## Quick start from source

### Requirements

- Windows 10/11 x64
- Node.js 24.x
- pnpm 11.x through Corepack
- Git

```powershell
git clone https://github.com/qvinh8726/timefarm.git
cd timefarm
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` starts Vite and Electron together. A renderer-only preview is available with `pnpm dev:web`, but browser preview does not exercise Electron SQLite, secure auth storage, IPC, sync, or the native overlay.

## Build and test

Run all local quality gates:

```powershell
pnpm format:check
pnpm lint
pnpm lint:css
pnpm check:electron
pnpm check:workflows
pnpm test
pnpm test:coverage
pnpm build
pnpm check:bundle
pnpm audit --prod
```

Build and smoke an unpacked Windows app:

```powershell
pnpm pack:win:dir
pnpm smoke:win:packaged
```

Build and smoke the NSIS installer:

```powershell
pnpm pack:win
pnpm smoke:win:installer
```

Artifacts are written to `release/`. Build output, coverage, local cloud configuration, logs, and Codex workspace files are intentionally excluded from Git.

## Optional Supabase setup

TimeFarm does **not** require Supabase for local tracking. To enable authentication and synchronization:

1. Create a Supabase project.
2. Deploy the migrations in order:
   - [`0001_workly_schema.sql`](supabase/migrations/0001_workly_schema.sql)
   - [`0002_bootstrap_snapshot.sql`](supabase/migrations/0002_bootstrap_snapshot.sql)
   - [`0003_atomic_workspace_claim.sql`](supabase/migrations/0003_atomic_workspace_claim.sql)
   - [`0004_paginated_bootstrap.sql`](supabase/migrations/0004_paginated_bootstrap.sql)
   - [`0005_optimistic_revisions.sql`](supabase/migrations/0005_optimistic_revisions.sql)
3. Enable Email Auth and optionally Google OAuth.
4. Add `timefarm://auth/callback**` to the accepted redirect patterns.
5. Supply only the public project URL and publishable/anon key.

Never bundle a Supabase `service_role`, `sb_secret_*`, database password, personal access token, or any other server credential. Ownership is derived from `auth.uid()` and enforced by RLS/security-definer RPCs.

The repository includes a manual **Deploy Supabase migrations** GitHub workflow. Configure the `production` environment with:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PROJECT_REF`
- `TIMEFARM_SUPABASE_URL`
- `TIMEFARM_SUPABASE_ANON_KEY`

The workflow performs a dry run, applies pending migrations, and verifies that required RPCs exist while rejecting anonymous callers.

## Architecture

```text
React + TypeScript renderer
        │ typed, context-isolated IPC
        ▼
Electron main process
  ├─ CommandService        strict intents and main-owned timestamps/IDs
  ├─ LocalStateRepository  SQLite, WAL, migrations, recovery, outbox
  ├─ SupabaseAuthService   encrypted session and OAuth PKCE
  ├─ SyncService           bootstrap, pull cursor, CAS, retry, conflicts
  ├─ TimerLeaseService     bounded online cross-device lease
  ├─ FxService             validated reference-rate cache
  └─ OverlayManager        native mini timer window
        │
        ├─ Local workly.db
        └─ Optional Supabase Auth + RLS/RPC schema
```

The renderer cannot access Node.js, the filesystem, database credentials, or auth tokens. Electron uses `contextIsolation`, Chromium sandboxing, strict navigation policies, trusted sender checks, and narrow preload APIs.

Read the implementation boundaries in [`ARCHITECTURE.md`](ARCHITECTURE.md) and the reporting policy in [`SECURITY.md`](SECURITY.md).

## Release status and known limitations

TimeFarm v0.2.1 is ready for local/offline-first beta evaluation. Before describing it as a stable production multi-device product, the project still needs:

- Hosted verification of every Supabase migration, RLS rule, RPC, Email Auth, and Google OAuth flow.
- Competing physical-device and extended network-fault testing.
- Windows code signing, SmartScreen reputation, upgrade/rollback testing, and an update strategy.
- Physical screen-reader, DPI, fullscreen, multi-monitor, crash/shutdown, and clean-machine coverage.
- Sustained FX provider outage/rate-limit monitoring.

See [`PRIVACY.md`](PRIVACY.md), [`SUPPORT.md`](SUPPORT.md), and [`CHANGELOG.md`](CHANGELOG.md) for the current beta boundaries and release history.

## Project documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) – runtime boundaries, persistence, sync, security, and release gates.
- [`design-system/timefarm/MASTER.md`](design-system/timefarm/MASTER.md) – UI tokens, hierarchy, responsiveness, and accessibility.
- [`SECURITY.md`](SECURITY.md) – responsible security reporting.
- [`PRIVACY.md`](PRIVACY.md) – local/cloud data behavior.
- [`SUPPORT.md`](SUPPORT.md) – supported beta workflows.
- [`CHANGELOG.md`](CHANGELOG.md) – release history.
- [GitHub Issues](https://github.com/qvinh8726/timefarm/issues) – bugs, ideas, and roadmap.
- [GitHub Actions](https://github.com/qvinh8726/timefarm/actions) – CI, database deployment, and release workflows.

## License

Copyright © 2026 TimeFarm contributors. This repository is currently **UNLICENSED / all rights reserved**. See [`LICENSE`](LICENSE) before copying, modifying, or redistributing the source.

---

TimeFarm is a Windows time tracker, offline work-hours tracker, freelancer project timer, earnings tracker, productivity analytics dashboard, hourly-rate calculator, and optional Supabase-synced Electron desktop app.
