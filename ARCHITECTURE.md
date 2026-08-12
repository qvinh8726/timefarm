# TimeFarm Architecture

## Status and scope

This document separates code present in this repository from production proof. "Implemented" means the local code path exists and has its listed automated coverage; it does not mean that a hosted Supabase project, OAuth provider, installer, or multi-device deployment has been verified.

| Concern                | Implemented in the repository                                                                                                                                                                                                                                 | Still required before production use                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Desktop shell          | Electron, context isolation, Chromium sandbox, `webSecurity`, no renderer Node integration/`webview`, trusted sender checks, strict navigation/external-origin allowlists, and a packaged React-renderer smoke mode                                           | Update channel, clean-machine install/upgrade tests, and optional signing for a future stable line |
| Renderer               | React + TypeScript + Vite; lazy Analytics/account/dialog chunks with a bundle budget; canonical-state reload after main-process changes; bilingual UI; modal semantics/focus trap/focus restore; reduced-motion CSS; UI/a11y component tests                  | Physical screen-reader, full keyboard workflow, DPI and end-to-end release coverage                |
| Local data             | Main-process SQLite with WAL, foreign keys, ordered transactional migrations, quick integrity check, legacy JSON import, strict invariants, sync metadata/conflicts, rollback/upgrade fixtures, and native startup recovery export                            | Process-crash/OS-shutdown recovery and broader fuzz/concurrency testing                            |
| Mutation boundary      | Strict typed intents, main-owned state, serialized mutation queue, and read-only timer preflight before start/resume lease requests                                                                                                                           | Broader adversarial IPC and end-to-end validation                                                  |
| Timer                  | Timestamp + pause-interval model; one active timer; recovery UI; bounded lease guard/renewal when cloud is available; deterministic completed-session overlap accounting                                                                                      | Real multi-device and network-fault validation                                                     |
| Authentication         | Supabase email/password and Google entry points; encrypted session plus cached identity; 1.5-second bounded remote verification; provider-derived account binding                                                                                             | Provisioned project, full callback threat model, telemetry, and provider integration verification  |
| Cloud sync             | Empty-device cloud bootstrap, durable outbox, pull-before-push cursor sync, per-entity optimistic revisions/CAS, 10-second RPC deadlines, conservative conflict records/UI, atomic claims, SQL/RLS migrations, local Postgres replay plus pgTAP RLS/RPC tests | Deploy hosted migrations, physical multi-device tests, monitoring, backup/export                   |
| Currency and analytics | Original-currency facts; union-based overlap accounting; stored-timezone allocation; Frankfurter v2 reference-rate cache with bounded freshness and request time                                                                                              | Sustained provider reliability/privacy monitoring and real-service fault tests                     |
| Mini timer             | Separate transparent Electron window; interactive, view-only click-through, hidden modes, saved/clamped position                                                                                                                                              | Windows fullscreen, DPI, multi-monitor, accessibility, focus, shutdown, and installer tests        |

## Runtime boundaries

```text
React renderer
  |  contextBridge (no Node APIs or bearer tokens)
  v
Electron preload
  |  narrow named calls: load, typed command, sync/conflict, lease, auth, FX, overlay
  v
Electron main process
  |- CommandService -> validated intent -> LocalStateRepository -> workly.db (SQLite/WAL)
  |- SupabaseAuthService -> encrypted auth-session.bin
  |- SyncService -> authenticated snapshot bootstrap / pull-before-push RPCs
  |- TimerLeaseService -> per-installation device ID + lease renewal
  `- OverlayManager -> separate native mini-timer BrowserWindow
```

`electron/main.cjs` creates the primary window with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, and `webviewTag: false`. It accepts primary-window IPC only from the current application window and separately validates the overlay sender. Navigation/redirects are limited to the exact development origin or packaged `dist` tree; `window.open` is denied and an external URL is handed to the OS only when it belongs to the configured Supabase origin (HTTPS in production, loopback HTTP only for local development). The overlay likewise denies new windows and stays on its exact generated data URL. The preload exposes explicit operations, not Node, filesystem access, or access/refresh tokens.

### Typed command boundary

Desktop mutations cross one `workly:execute-command` path. `electron/command-contract.cjs` defines a strict discriminated schema for profile, project, session, payment, goal, and preference intents. `CommandService` validates that intent, loads durable state, derives IDs/timestamps/default timezone, resolves referenced entities from the current local account, applies business rules, and persists the result through the repository. It returns canonical state for the renderer to adopt.

The main process serializes renderer mutations, overlay actions, explicit account operations, OAuth completion, auth hydration, sync pulls/pushes, and background timer-lease renewals through one queue. This pins a single authenticated subject while the shared Supabase client is in use. For a timer start/resume, a read-only `CommandService.preflight()` checks the strict schema and current durable transition using keyed account/project/active-session queries before any asynchronous lease call. That prevents an invalid or stale timer command from reserving a cloud lease, avoids a redundant full-history read, and keeps the preflight result valid until the queued command commits.

This replaces the former generic whole-application snapshot write. The only destructive data reset is a separate, explicit Settings action with a fixed empty-state operation; it is not a general-purpose renderer write API. Browser-only Vite preview deliberately uses `localStorage` for UI development and does not exercise this Electron command, database, credential, sync, or lease path.

### Renderer interaction and motion

The shared modal component uses `role="dialog"`, `aria-modal`, and an accessible title; it moves focus into the dialog, cycles Tab/Shift+Tab, restores the invoking focus on close, and supports Escape/backdrop close except for intentionally locked recovery. Analytics, account/settings, and workspace dialog implementations load as real dynamic chunks behind accessible Suspense fallbacks, while the one shared clock store starts only when a visible consumer subscribes. CSS honors `prefers-reduced-motion` by effectively disabling nonessential transitions and animations. Payment history exposes edit/delete controls, and dashboard goals expose edit/delete controls through the same typed commands. These behaviors have not yet received browser/Electron end-to-end or screen-reader coverage.

## Local data and recovery model

`electron/state-repository.cjs` uses Electron's Node 24 `node:sqlite` runtime. The database is stored as `workly.db` in Electron's user-data directory and enables WAL, foreign keys, and a busy timeout. On first use, it imports `workly-state.json` only if the SQLite database contains no account.

The repository stores accounts, projects, work sessions, pause intervals, payments, goals, preferences, `sync_outbox`, `sync_metadata`, and `sync_conflicts`. A normalized write runs under `BEGIN IMMEDIATE`; eligible local changes create or coalesce durable outbox operations in the same transaction. Each operation has a locally generated UUID/idempotency key, retry state, error details, and capped exponential scheduling. Active timers remain local until completed.

The repository and command layer reject multiple active sessions, active work on a completed project, malformed or overlapping pauses, reopening/deleting completed history, edits to a non-latest completed session, and deletion of a project with retained work/payment history. A completion deterministically closes a terminal open pause at the supplied completion timestamp.

Timer truth is derived rather than incremented:

```text
startedAt -- active interval -- pause intervals -- endedAt
                   |
                   `- active duration = elapsed time - merged pause time
```

An active or paused session is persisted immediately. On launch, the renderer shows recovery choices to continue, complete, or discard where allowed. Completed sessions hold frozen `activeDurationMs` and actual earnings. Crash-injection tests, a clean-shutdown marker, and a formal recovery journal are still open work.

## Authentication and account ownership

`SupabaseAuthService` is disabled unless the desktop process receives valid `TIMEFARM_SUPABASE_URL` and `TIMEFARM_SUPABASE_ANON_KEY` values (`WORKLY_*` and `VITE_*` names are compatibility fallbacks). The only permitted client key is the Supabase anon key.

- Email/password calls run in the main process.
- Google sign-in opens the system browser and expects `timefarm://auth/callback` on Windows. A 32-byte TimeFarm nonce is appended to the redirect URL and stored only with the short-lived encrypted PKCE verifier/flow record, so a callback can survive one app restart without relying on an OAuth `state` value from Supabase's authorization URL.
- A successful Supabase session is encrypted with Electron `safeStorage` before writing `auth-session.bin` in the user-data directory. Its envelope contains the session tokens and a sanitized last-verified user identity; neither is exposed to the renderer as credentials.
- The renderer receives a sanitized `{ id, email, displayName }` identity and explicit actions, never an access or refresh token.
- A local account can be linked only using the authenticated subject read by the main process. The renderer cannot supply `authUserId` in an initialization or link command.
- Before first local setup, an online-authenticated device with no account calls the self-scoped cloud snapshot RPC. A found workspace is atomically restored locally without an outbox echo. An existing local account is linked only after `workly_claim_workspace` atomically reserves the authenticated cloud profile for that exact local workspace ID; the local link is committed only after the RPC confirms ownership. Offline or failed claims cannot fall through to a potentially overwriting profile write.
- Each remote Auth hydration and verification request has a 1.5-second local deadline. A definitive credential rejection clears the encrypted session; a timeout/network failure retains its cached identity and reports an offline principal instead of blocking local work.
- After linking, ordinary renderer commands and overlay timer actions require the provider or cached-offline subject to match that local account. A different signed-in user cannot silently merge or overwrite the local data. An offline cached identity is sufficient for local-first commands only: it does not authorize sync or lease acquisition.

The repository contains no credentials; hosted configuration is supplied from ignored local files or release secrets. The OAuth callback checks the exact `timefarm://auth/callback` route, a pending TimeFarm-generated nonce, and the PKCE flow ID before exchange; the encrypted continuation expires after ten minutes and is consumed before the network exchange. A full callback threat model, error telemetry, secure-storage failure handling, and real provider verification remain release gates.

## Cloud schema, sync, and conflicts

[0001_workly_schema.sql](supabase/migrations/0001_workly_schema.sql), [0002_bootstrap_snapshot.sql](supabase/migrations/0002_bootstrap_snapshot.sql), [0003_atomic_workspace_claim.sql](supabase/migrations/0003_atomic_workspace_claim.sql), [0004_paginated_bootstrap.sql](supabase/migrations/0004_paginated_bootstrap.sql), and [0005_optimistic_revisions.sql](supabase/migrations/0005_optimistic_revisions.sql) are the versioned cloud schema source. Together they create profiles, projects, sessions, pauses, payments, goals, sync operation/change records, durable entity-version tombstones, FX cache rows, timer lease rows, self-scoped bootstrap/revision RPCs, an atomic workspace-claim RPC, and canonical profile/preferences payloads. RLS and RPC code derive ownership from `auth.uid()` rather than trusting a client-supplied user ID. CI replays the complete chain into disposable Postgres and runs pgTAP tests; hosted deployment remains an explicit, credentialed production-environment workflow.

The migration rejects a non-object sync payload and mismatched entity/body IDs for projects, work sessions, payments, and goals; requires a profile root before any non-account cloud entity can be created; forbids deletion of completed work-session history; blocks deletion of projects with work/payment history; restricts an existing completed-session amendment to the latest completed session; validates every completed-session pause is an ordered, non-overlapping interval within session bounds and that its declared active duration matches timestamps minus pauses; and revokes default `PUBLIC` execution for the RPCs before granting them to `authenticated`. The client also stops its run after a failed root-account operation instead of attempting dependent writes. These safeguards must still be applied and tested in an actual Supabase project.

Cloud sync is eligible only after a local account has been explicitly linked to an authenticated subject. An unclaimed local profile does not consult cloud auth or send its outbox; it remains local even when Supabase configuration is present. A linked account with only an offline cached identity also keeps local data usable but returns an offline sync state rather than turning normal offline time into failed retries.

For a brand-new device, `workly_bootstrap_page_v2` runs before any onboarding-created profile or normal outbox exists. It pins the change cursor on page one, reads at most 250 canonical revision-bearing entities per request, rejects a repeated cursor, and stops safely before local import if the bounded 200-page run is not complete. A final incremental pull from the pinned cursor reconciles writes made while pages were loading. If it finds a cloud profile, the repository atomically imports the completed history, preferences, and entity revisions, clears generated outbox rows, marks imported entities synced, and saves the snapshot cursor. If no profile is found, onboarding remains local and an explicit later claim is protected by the server-side atomic workspace claim.

When configuration and an online-verifiable linked session are available, `SyncService` does the following after a local mutation and on a 30-second background interval:

1. Pull changes through `workly_pull_changes` from the durable account cursor, in pages of up to 100 changes (at most 50 pages per run). A pull error, 10-second RPC deadline, or remaining page after that bounded run is a safety stop: no outbox operation is pushed until a later run catches the cursor up, and a late page is inert.
2. Apply safe remote changes in a SQLite transaction and advance the cursor even when a conflict is recorded, preventing a conflict from blocking all later changes.
3. Hydrate any unknown revisions in one self-scoped batch, then push up to 50 ready outbox operations through the six-argument `workly_apply_sync_operation`. The server locks a durable per-entity version row and rejects a stale expected revision without writing; the next pull turns the winner into the existing explicit conflict flow. Successful and idempotently replayed operations return the canonical revision, while failed operations remain retryable. The same 10-second deadline applies to revision lookup, push, and bootstrap RPCs; a late success cannot acknowledge or mutate a later run.

Remote sync never drives a running or paused timer. If remote data would overwrite a divergent pending local entity, an active local timer, protected history, or another unsafe deletion, the repository retains local data/outbox work and records a durable conflict with both payloads and the remote cursor. The renderer offers **Keep local & retry**, which acknowledges the conflict while retaining the pending local operation, or **Use cloud version**, which atomically applies the recorded remote payload only after the same local safety checks and cancels the losing pending operation. There is no field-level merge, cloud monitoring, or deployed-service proof yet. Distinct completed sessions are not destructively merged merely because they overlap: analytics applies the deterministic policy described below.

## Timer lease behavior

`TimerLeaseService` persists one UUID per installation in the user-data directory. For a configured, online-authenticated linked account it calls `workly_acquire_timer_lease` with a default 45-second lease and renews a successfully held lease about every 30 seconds. Each acquire or renewal RPC has a five-second deadline; once that deadline wins, a late successful RPC response is inert and cannot recreate the local claim.

- Starting or resuming first passes serialized, read-only command/timer preflight, then asks for a lease. If another device currently holds it, the main process rejects the action; invalid/stale actions never request one.
- A successful acquisition starts renewal; completing, discarding, signing out, resetting local data, or quitting stops local renewal. The server expiry releases a no-longer-renewed lease.
- Missing configuration, missing authentication, or an RPC/network failure clears any local claim and is **not** treated as a held lease. The local offline timer still functions; any later overlap is retained, reconciled deterministically in account-time metrics, and surfaced in Analytics. The lease is not an offline consensus mechanism.
- Recovery UI rechecks the lease before continuing an interrupted session. Overlay start/resume use the same command/lease path as the main window.

The protocol has service and integration-seam tests, but has not been proven against a real Supabase project or competing physical devices. Treat that validation as required before describing it as a production multi-device timer guarantee.

## Native mini timer

`OverlayManager` creates a small, frameless, transparent `BrowserWindow` rather than simulating an overlay in the main renderer. It is always on top, omitted from the taskbar, uses its own context-isolated preload, and accepts actions only from that overlay's web contents.

- **Interactive:** Start, pause, resume, and open-main actions use the same command path. Stop focuses the main window and opens the regular completion form, so it cannot silently record zero earnings.
- **View-only:** The window calls `setIgnoreMouseEvents(true, { forward: true })`, is unfocusable, and rejects timer actions. This provides click-through behavior.
- **Hidden:** The native window is hidden without losing its local preference.
- **Position:** Dragging writes a small user-data position record. Restore clamps it to the nearest display work area.

Focused unit tests cover rendering snapshots, click-through/action guards, position persistence/clamping, command-backed timer actions, and completion handoff. Real Windows display, DPI, fullscreen/game, accessibility, focus, shutdown, and restart behavior is not yet validated.

## Time, money, and analytics rules

- Store money as `amountMinor` and a three-letter ISO currency. Original facts stay authoritative and immutable.
- Aggregate account-currency earnings only from matching original-currency records. Foreign-currency records remain original until a verified reference conversion exists.
- Completed sessions from different offline devices remain immutable historical facts even when their active intervals overlap. Account work-time totals, daily series, comparisons, time goals, and the matching-currency denominator coalesce those intervals and count each instant once. Earnings and per-project allocation retain every session; the Analytics warning makes that distinction explicit instead of silently deleting, merging, or double-counting account time.
- An effective hourly rate uses the union of active intervals from sessions with earnings in that same currency. Foreign work time therefore cannot dilute the original-currency denominator.
- Stored IANA timezones define local-day boundaries. `@js-temporal/polyfill` splits work across days and calculates calendar/range views. Recovery's `datetime-local` minimum is formatted in the zone shown to the user instead of slicing a UTC timestamp.
- Earnings are allocated over clipped intervals proportional to active time; pauses are excluded. Rates under one minute are suppressed.
- Goals expose progress, expected-by-now, current pace, and a clearly labelled projected completion only when enough data exists.
- The selected default reference provider is the public [Frankfurter v2 API](https://frankfurter.dev/). TimeFarm requests only base/quote currency codes—never amounts, account IDs, or work records—and labels the result as a reference conversion rather than a bank, card, tax, or settlement rate. The request has a 10-second deadline and requires HTTPS except for loopback development.
- `electron/fx-service.cjs` accepts the v2 row format (and a validated v1-compatible response for configured deployments), requires a positive rate for all five supported currencies, rejects invalid/future source dates and observations older than seven days, and atomically caches the oldest source observation date. A cache fetch older than 24 hours, incomplete legacy coverage, or invalid timestamp is visibly `stale`; an unavailable refresh never replaces the last verified matrix. Provider outage/rate-limit monitoring and a sustained real-service privacy/reliability exercise remain release gates.

## Build, CI, and distribution

Electron is pinned to `43.3.0`, matching the Node 24 runtime used by the SQLite repository. Electron Builder is pinned to `26.15.7`, whose Windows extraction path retries a locked directory rename and falls back to copy-and-delete. The GitHub Actions workflow at `.github/workflows/ci.yml` runs frozen install, formatting, renderer/Electron/CSS lint and checks, unit/UI accessibility tests, coverage thresholds, renderer bundle budgets, a real packaged-renderer smoke launch, an NSIS install/render/uninstall smoke test in an isolated Windows temp directory, and an isolated Ubuntu/Postgres job that replays all Supabase migrations before running database lint plus pgTAP schema/RLS/RPC tests. Every third-party action is pinned to a full commit SHA and a repository checker rejects mutable action tags. `.github/workflows/release.yml` accepts only exact `v0.*` prerelease tags on `master` through the protected `production` environment. It requires public cloud configuration, explicitly disables certificate discovery, rejects the installer unless Authenticode reports `NotSigned`, repeats both packaged and installer smoke tests, emits SHA-256 checksums and a packaged SPDX SBOM, and creates both SBOM and build-provenance attestations for the exact installer before publishing it as a prerelease.

`electron-builder` is configured in `package.json` for an x64 NSIS installer:

```powershell
pnpm pack:win       # build + release/TimeFarm-<version>-Setup.exe
pnpm pack:win:dir   # build + unpacked Windows directory
```

Packaging includes the compiled renderer and main/overlay files and relies on Electron's bundled `node:sqlite`, not a native SQLite addon. CI launches the packaged executable with an isolated seeded profile, navigates through the lazy Analytics and Settings pages, opens the lazy Start-session dialog, rejects the fatal-error boundary, and requires a clean exit. This is not a substitute for a clean-machine install. The v0.x channel is intentionally unsigned and must disclose the resulting Unknown Publisher/SmartScreen warning. Certificate provisioning and reputation building are deferred to a future signed stable channel; malware review, upgrade/rollback testing, and an auto-update strategy remain separate release work.

Packaging is fail-closed about cloud mode. A configured release validates a public Supabase client key, credential-free HTTPS origin, and exact OAuth callback before writing an explicit `cloud` marker. Offline packaging replaces any earlier ignored configuration with an explicit `offline` marker. A post-build gate extracts `electron/timefarm.config.json` from the final ASAR and rejects a missing, malformed, stale, or wrong-mode artifact.

The local sync outbox distinguishes queued work from an operation whose cloud outcome is uncertain. Before an RPC, TimeFarm atomically claims the row as `in_flight`; edits created while that RPC is pending become a separate successor. After a crash or timeout, the predecessor is retried first with its durable idempotency key, and a successful acknowledgement advances the successor's expected revision. Cache rebuild and destructive lifecycle operations treat `in_flight` rows as unsettled data. Sign-out cancels late sync writes before it verifies removal of both encrypted session and OAuth continuation files.
