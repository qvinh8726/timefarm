# TimeFarm — Windows Time Tracking and Earnings Analytics

[![CI](https://github.com/qvinh8726/timefarm/actions/workflows/ci.yml/badge.svg)](https://github.com/qvinh8726/timefarm/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/qvinh8726/timefarm?display_name=tag&sort=semver)](https://github.com/qvinh8726/timefarm/releases)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white)](https://github.com/qvinh8726/timefarm/releases)
[![License](https://img.shields.io/badge/license-not%20specified-lightgrey)](https://github.com/qvinh8726/timefarm)

**TimeFarm** is a Windows desktop app for accurate work-time tracking, real earnings recording, and actionable productivity analytics. It is designed for freelancers, independent professionals, consultants, creators, and anyone who needs a reliable **offline-first time tracker with income analytics**.

The app keeps the timer useful without a network connection, stores work history locally in SQLite, and synchronizes to Supabase only when the account is authenticated and the device is eligible to sync. TimeFarm never invents an exchange rate and never replaces an original-currency financial record with a conversion.

**Download:** [TimeFarm v0.1.0 for Windows](https://github.com/qvinh8726/timefarm/releases/tag/v0.1.0) · **Source:** [github.com/qvinh8726/timefarm](https://github.com/qvinh8726/timefarm)

> Current release status: the Windows installer is available, but it is unsigned. Windows SmartScreen may display a warning until a production code-signing certificate is configured.

## Why TimeFarm?

Most time trackers stop at a stopwatch. TimeFarm connects the complete workflow:

1. Start a work session.
2. Pause and resume without losing active-time accuracy.
3. Finish the session and enter the amount actually received.
4. Keep the original currency and payment context.
5. Sync safely when online.
6. Review time, earnings, efficiency, projects, goals, and trends.

The result is a practical **work-hours tracker**, **freelance earnings tracker**, and **personal productivity dashboard** in one Windows app.

## Features

### Accurate work sessions

- Start, pause, resume, complete, or discard a session.
- Active duration is calculated from persisted timestamps and pause intervals, not from a fragile in-memory counter.
- Crash and restart recovery detects an unfinished session and lets you continue, complete, or discard it safely.
- A strict one-active-session rule protects the local account from accidental overlapping timers.
- Completed history is protected from unsafe deletion and arbitrary historical rewrites.

### Projects and payment history

- Create projects with a name, color, icon, status, and payment model.
- Track per-session earnings without overwriting project-level payment history.
- Add, edit, and delete payment records when local history rules allow it.
- Complete projects explicitly; linked work and payment history remains protected.
- View project time, earnings, efficiency, status, and recent activity from the dashboard and history views.

### Goals and dashboard customization

- Create time, earnings, session-count, or completed-project goals.
- Edit or delete goals from the workspace.
- Review progress, expected pace, ahead/behind status, and projected completion when enough data exists.
- Hide, reorder, and resize dashboard widgets to keep the daily view focused.

### Analytics that respect the data

- Daily and range analytics for 7 days, 30 days, 1 month, 3 months, 6 months, and 1 year.
- Time, earnings, efficiency, project distribution, session duration, and goal insights.
- Sessions crossing a day or date-range boundary are allocated by the active time that actually belongs in the selected range.
- Hourly-rate calculations only compare earnings and time in compatible currencies.
- Original currency, provider, update time, and stale/unavailable FX state remain visible.

### Offline-first desktop workflow

- Timer and local history continue working when the network is unavailable.
- SQLite uses WAL, foreign keys, transactions, and durable repository validation.
- A local outbox keeps pending cloud operations retryable and idempotent.
- Offline identity can preserve local work, but it cannot silently claim or sync cloud data.

### Cloud account and synchronization

- Supabase email/password authentication.
- Google OAuth with a persisted, encrypted PKCE continuation for desktop restarts.
- New-device cloud bootstrap runs before local onboarding can overwrite an existing workspace.
- Pull-before-push synchronization with a durable cursor and paginated changes.
- Retained local conflicts with explicit **Keep local & retry** and **Use cloud version** actions.
- Timer lease acquisition and renewal for authenticated online devices.
- RPC deadlines prevent a hanging network response from blocking future sync attempts.

### Native Windows experience

- Electron desktop shell with Chromium sandboxing, context isolation, web security, and no renderer Node integration.
- Native mini timer with hidden, view-only click-through, and interactive modes.
- Overlay position is persisted locally; stopping the overlay opens the normal earnings form.
- Responsive dashboard, accessible modal semantics, keyboard focus styles, and reduced-motion support.
- Vietnamese and English resource foundations with locale-aware time and date formatting.

## Screens and workflow

| Area | Purpose |
| --- | --- |
| Dashboard | Today’s work time, earnings, efficiency, sessions, goals, and configurable widgets. |
| Projects | Project setup, payment model, status, icons, and project-level activity. |
| History | Completed sessions, actual earnings, notes, original currencies, and safe latest-session editing. |
| Analytics | Range-based charts, project comparisons, pace, FX context, and data-backed observations. |
| Profile | Local account identity, country, currency, and timezone. |
| Settings | Theme, language, mini timer mode, and local data controls. |

## Quick start on Windows

### Requirements

- Windows 10/11 for the desktop target.
- Node.js 24.x. The project uses Node’s built-in `node:sqlite` runtime.
- pnpm 11.x, installed through Corepack.
- Git for source development.

### Install and run

Open **Command Prompt** or PowerShell in the repository directory:

```powershell
corepack enable
pnpm install
pnpm dev
```

The development command starts Vite and Electron together. Keep the terminal open while TimeFarm is running.

For a renderer-only browser preview:

```powershell
pnpm dev:web
```

The browser preview uses localStorage and is intentionally not a substitute for Electron SQLite, secure auth storage, cloud sync, or the native overlay.

### Command Prompt environment syntax

If you use `cmd.exe`, use `set`, not PowerShell’s `$env:` syntax:

```cmd
set "TIMEFARM_SUPABASE_URL=https://your-project.supabase.co"
set "TIMEFARM_SUPABASE_ANON_KEY=your-publishable-or-anon-key"
pnpm dev
```

If you use PowerShell:

```powershell
$env:TIMEFARM_SUPABASE_URL = "https://your-project.supabase.co"
$env:TIMEFARM_SUPABASE_ANON_KEY = "your-publishable-or-anon-key"
pnpm dev
```

Environment variables belong to the terminal process that launches Electron. Opening a new terminal means setting them again.

## Supabase setup

Cloud features are optional. TimeFarm remains a local-first timer without Supabase configuration.

1. Create a Supabase project.
2. Apply the migrations in order:
   - [`0001_workly_schema.sql`](supabase/migrations/0001_workly_schema.sql)
   - [`0002_bootstrap_snapshot.sql`](supabase/migrations/0002_bootstrap_snapshot.sql)
3. Configure Email authentication and Google OAuth in Supabase Auth.
4. Set the desktop callback URL to `timefarm://auth/callback`.
5. Add a redirect pattern that accepts the OAuth query parameters, such as `timefarm://auth/callback**` when supported by the project’s redirect syntax.
6. Launch TimeFarm with the public Supabase URL and **publishable/anon key**.

Never put a Supabase `service_role` or `sb_secret_*` key in this application, the repository, `.env.example`, a screenshot, or a public issue. The anon/publishable key is intended for client applications; database ownership and authorization must still be enforced by Supabase RLS and RPC policies.

### Production configuration for the installer

The installer build can bundle a local runtime configuration without committing it to Git:

```powershell
$env:TIMEFARM_SUPABASE_URL = "https://your-project.supabase.co"
$env:TIMEFARM_SUPABASE_ANON_KEY = "your-publishable-or-anon-key"
node scripts/prepare-runtime-config.cjs
pnpm pack:win
```

`electron/timefarm.config.json` is ignored by Git. It is used only to provide public client configuration to the packaged desktop app. Do not put a secret/service-role key in it.

## Build, test, and package

Run the quality gates before sharing a build:

```powershell
pnpm lint
pnpm test
pnpm build
```

Create an x64 NSIS installer:

```powershell
pnpm pack:win
```

The installer is written to `release/TimeFarm-<version>-Setup.exe`. For an unpacked directory smoke test:

```powershell
pnpm pack:win:dir
```

The public v0.1.0 installer is available on the [GitHub Releases page](https://github.com/qvinh8726/timefarm/releases/tag/v0.1.0).

## Architecture

```text
React + TypeScript renderer
        │ typed context-isolated IPC
        ▼
Electron main process
  ├─ CommandService: validates intent and owns IDs/timestamps
  ├─ LocalStateRepository: SQLite/WAL, invariants, recovery, outbox
  ├─ SupabaseAuthService: encrypted session and OAuth PKCE
  ├─ SyncService: bootstrap, pull cursor, retry, conflicts
  ├─ TimerLeaseService: online cross-device timer lease
  ├─ FxService: verified reference-rate cache
  └─ OverlayManager: native mini timer window
        │
        ├─ workly.db (local durable state; compatibility filename)
        └─ Supabase Auth + RLS/RPC migrations (optional cloud)
```

The internal `workly:*` IPC channels, SQL function names, migration filenames, and `workly.db` compatibility filename are retained deliberately. They are implementation identifiers and do not change the public TimeFarm brand.

## Security model

- Renderer Node integration is disabled.
- Context isolation and Chromium sandboxing are enabled.
- Navigation is restricted to the packaged app or the exact development origin.
- External browser navigation is restricted to the configured Supabase origin.
- OAuth callbacks require the exact `timefarm://auth/callback` route, a TimeFarm nonce, a Supabase flow ID, freshness, and single-use consumption.
- Renderer commands are schema-validated in the main process; renderer-supplied account IDs, entity ownership, timestamps, and whole-state snapshots are not trusted.
- Local auth sessions and OAuth continuation material use Electron secure storage when available.
- Cloud writes derive ownership from `auth.uid()` and are expected to run behind Supabase RLS/security-definer RPC checks.

## Known limitations and release gates

TimeFarm is runnable and tested locally, but the following still require real hosted or clean-machine verification before calling it a fully production-hardened release:

- Apply and integration-test both Supabase migrations in the intended hosted project.
- Verify RLS, email auth, Google OAuth, bootstrap, conflict, and timer lease behavior with multiple devices.
- Add server-side optimistic revision/CAS handling for every concurrent entity edit; current sync safety prevents several unsafe overwrites but does not eliminate every last-write-wins race.
- Define reconciliation for two devices that work offline and create overlapping completed sessions.
- Run Windows crash/restart, DPI, fullscreen, screen-reader, and keyboard smoke tests.
- Add a production code-signing certificate, clean-machine installer test, upgrade test, and update policy.
- Choose and validate a production FX provider and freshness policy.

These boundaries are tracked in [`ARCHITECTURE.md`](ARCHITECTURE.md) and the issue tracker.

## Troubleshooting

### `pnpm` is not recognized

Open Command Prompt as Administrator once and run:

```cmd
corepack enable
pnpm --version
```

Then use a normal terminal for development.

### Vite says port 5173 is in use

Stop the previous `pnpm dev` process with `Ctrl+C`. If needed, find the exact process:

```cmd
netstat -ano | findstr :5173
taskkill /PID <PID_FROM_NETSTAT> /F
```

### TimeFarm says it is offline

Check that the terminal launching Electron has both `TIMEFARM_SUPABASE_URL` and `TIMEFARM_SUPABASE_ANON_KEY`. A new terminal does not inherit variables from an older terminal. Confirm that the URL and key belong to the same Supabase project and that the migrations were applied in order.

### Cloud claim says `Authentication required`

Update to the latest source, restart TimeFarm, and sign in again. The sync client must send the authenticated bearer token to Supabase RPC calls; an anon key alone cannot claim a cloud workspace.

### Windows SmartScreen warns about the installer

The current installer is unsigned. Verify that the download came from the official [TimeFarm GitHub release](https://github.com/qvinh8726/timefarm/releases), then use the production-signed build once code signing is configured.

## Contributing

1. Fork the repository and create a focused branch.
2. Install dependencies with `pnpm install`.
3. Make the smallest safe change that matches the product rules.
4. Run `pnpm lint`, `pnpm test`, and `pnpm build`.
5. Update the relevant product/architecture decision document when behavior changes.
6. Open a pull request with a clear description, test results, and screenshots for UI changes.

## Project documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — implementation boundaries and data flow.
- [GitHub Issues](https://github.com/qvinh8726/timefarm/issues) — current bugs, ideas, and release gates.
- [GitHub Actions](https://github.com/qvinh8726/timefarm/actions) — automated CI runs.

## SEO keywords

Windows time tracker · offline-first time tracking app · freelancer time tracker · work hours tracker · earnings tracker · productivity analytics dashboard · project time tracking · hourly rate analytics · Electron desktop app · Supabase sync · local-first productivity software · Vietnamese and English time tracking.
