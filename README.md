# TimeFarm - Work Time & Earnings Analytics

TimeFarm is a Windows desktop app for tracking real work time, recording actual earnings, and reviewing the resulting history without fabricating FX conversions. It is **local-first**: its timer and SQLite data continue to work without a network connection.

## What is runnable in this repository

- Electron desktop shell with a React + TypeScript interface, context isolation, Chromium sandboxing, `webSecurity`, no renderer Node integration, and no `webview` tag.
- First-run local profile; projects, work sessions, pause/resume, recovery prompt, protected completed-session history, editable/deletable project-payment records, editable/deletable goals, dashboard preferences, accessible modals, reduced-motion support, and a native mini timer.
- One active timer reconstructed from persisted timestamps and pause intervals, rather than an in-memory counter.
- Main-process SQLite storage (`workly.db`) using WAL, foreign keys, transactions, and one-time import of a legacy JSON state when present.
- **Typed command IPC for every normal mutation.** The renderer sends a strictly validated intent such as `session.start`, `session.complete`, `project.update`, or `payment.create`; the main process owns IDs, timestamps, account resolution, invariant checks, persistence, and the canonical state returned to the renderer. It does not accept a renderer-supplied whole-state snapshot.
- Account linking is derived from the authenticated Supabase subject in the main process, never from a renderer-provided user ID. A cloud workspace is restored into an empty local database before onboarding; an existing local workspace can be claimed only after an online snapshot check proves that the signed-in cloud account has no workspace to overwrite. The encrypted local auth envelope retains the session tokens and a sanitized last-verified identity. Each remote Auth hydration/verification request is bounded to 1.5 seconds; on a non-definitive offline failure, a matching cached identity can still authorize local-first work, but never cloud sync or a cloud lease.
- Repository integrity checks reject multiple active sessions, unsafe historical-session deletion/reopening, non-latest historical edits, malformed pauses, and project deletion while work or payment history remains.
- Cursor-based two-way sync code: an authenticated new device first reads a cloud snapshot and imports it without echoing an outbox; established devices pull paginated changes before pushing up to 50 ready idempotent operations. Pull, push, and bootstrap RPCs have a 10-second deadline, so a stalled response cannot block a later sync run or mutate state late. Only a local account explicitly linked to an authenticated subject is sync-eligible; unclaimed local data remains local. Pending divergent local data is retained rather than silently overwritten; the UI offers **Keep local & retry** or **Use cloud version** only when the recorded cloud payload passes the same local safety checks.
- Timer-lease client for configured, online-authenticated Supabase use. A lease held by another device blocks start/resume on this device; successful leases are renewed. Each acquire/renew RPC is bounded to five seconds and a late response cannot restore a failed local claim. For timer start/resume, serialized mutation handling performs read-only command/timer preflight before it asks for a lease, so an invalid or stale timer action cannot reserve one. Missing configuration, no session, or a network failure never masquerades as a held lease, so local offline timing remains usable but can require later overlap review.
- Money stored as integer minor units with its original ISO currency. When a verified cached FX rate is available, the desktop UI can show a clearly labelled reference conversion, including provider/update/stale status; original records and accounting facts are never replaced.
- Timezone-aware daily allocation and 7D/30D/1M/3M/6M/1Y analytics. Effective hourly-rate calculations use only active time whose earnings are in the matching account currency, so foreign-currency work cannot dilute an original-currency rate. Goal views include pace and projected-completion estimates when data supports them.
- Native mini-timer window with interactive, view-only click-through, and hidden modes. Its position is retained locally, and stopping hands off to the normal completion/earnings form.
- Supabase/Auth implementation paths for email/password and Google OAuth, encrypted local session/token plus cached-identity storage, and a short-lived encrypted PKCE continuation with a TimeFarm-generated callback nonce that survives one app restart. The repository also includes two unapplied Supabase SQL migrations with RLS, ownership-checking RPCs, sync history, timer leases, bootstrap snapshots, canonical profile/preferences payloads, and server-side completed-session pause ordering/bounds/duration validation.

The cloud implementation is not a deployed or integration-verified service. No Supabase credentials, OAuth provider setup, or hosted environment is committed; neither migration has been applied here. Real RLS/RPC, OAuth, bootstrap, conflict, and lease behavior still need multi-device testing, while the mini timer and modal accessibility still need Windows fullscreen, DPI, screen-reader, and keyboard smoke tests. Installer signing and a clean-machine install/upgrade pass are also outstanding. These boundaries are tracked in [ROADMAP.md](ROADMAP.md) and [TEST_CASES.md](TEST_CASES.md).

## Requirements

- Windows for the supported desktop target.
- Node.js **24.x** for development and tests (the repository uses Node's built-in SQLite module).
- pnpm 11.16.0 or Corepack.

## Run locally

```powershell
corepack enable
pnpm install
pnpm dev
```

For a renderer-only UI preview (it uses browser `localStorage`, not Electron SQLite, secure credential storage, leases, or sync):

```powershell
pnpm dev:web
```

Quality checks:

```powershell
pnpm lint
pnpm test
pnpm build
```

## Optional Supabase development setup

Cloud behavior stays disabled until the **Electron process** receives a Supabase URL and anon key. Never put a service-role key in this app.

1. Create a separate Supabase project and configure the email/password and Google providers.
2. Apply [0001_workly_schema.sql](supabase/migrations/0001_workly_schema.sql) and then [0002_bootstrap_snapshot.sql](supabase/migrations/0002_bootstrap_snapshot.sql) with the Supabase CLI or SQL editor. Review both migrations before applying them to any shared environment.
3. Add a Supabase redirect allow-list pattern that permits `timefarm://auth/callback` **with query parameters** (for example `timefarm://auth/callback**` where the project's wildcard syntax is enabled). TimeFarm appends `timefarm_state` and the SDK appends `sb_flow_id`; an exact query-less entry can reject the callback.
4. In the PowerShell session that launches Electron, set only public client configuration:

   ```powershell
   $env:TIMEFARM_SUPABASE_URL = 'https://your-project.supabase.co'
   $env:TIMEFARM_SUPABASE_ANON_KEY = 'your-anon-key'
   pnpm dev
   ```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are accepted as compatibility fallbacks, but `TIMEFARM_*` is preferred. A `.env` file is not automatically loaded by Electron's main process, so inject environment values through the launch environment until a production configuration mechanism is added.

When configured and online-authenticated, a device with no local profile first asks `workly_bootstrap_snapshot` whether it should restore an existing cloud workspace. A local profile stays unclaimed until an explicit consent action and a second snapshot check confirm there is no cloud workspace. For an established claimed profile, the desktop process pulls remote changes before it pushes its outbox, surfaces conflicts, and requests timer leases. A cached offline identity preserves local work only. This is implementation availability, not proof of hosted-service correctness: complete the migration, RLS, OAuth, multi-device, network-fault, recovery, and installer checks in [TEST_CASES.md](TEST_CASES.md) before relying on it with real data.

## FX rate behavior

The desktop app uses a provider-validated cache for reference conversions of foreign-currency records. Its default endpoint is Frankfurter-compatible and can be overridden with `TIMEFARM_FX_API_URL` and `TIMEFARM_FX_PROVIDER_NAME` when the app process starts. The legacy `WORKLY_*` names remain accepted for existing setups. The renderer shows the provider, update time, and stale/unavailable state, and keeps the original amount when no verified rate exists. Browser preview does not access this desktop provider path.

Choose, contract-test, and review a production provider before distributing the app. The rate is informational; it must never overwrite historical original-currency data.

## Create a Windows installer

```powershell
pnpm pack:win
```

The command builds the renderer and is configured to produce an x64 NSIS installer in `release/`. `pnpm pack:win:dir` is configured to create an unpackaged Windows directory for smoke testing. The repository does **not** yet establish a clean-machine installer pass, signing, upgrade behavior, malware/reputation review, or auto-update channel. Do not distribute the unsigned artifact as a production release.

## Project documentation

- [PRD.md](PRD.md) - product requirements.
- [ARCHITECTURE.md](ARCHITECTURE.md) - current implementation, data flow, and production boundaries.
- [ROADMAP.md](ROADMAP.md) - implementation status and remaining milestones.
- [TEST_CASES.md](TEST_CASES.md) - automated coverage and manual acceptance matrix.
- [DECISION_LOG.md](DECISION_LOG.md) - durable product and technical decisions.
