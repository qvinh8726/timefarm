# Roadmap

Status labels describe code in this repository, not an external deployment. "Partial" means useful implementation exists but the end-to-end acceptance criteria have not been proven in a production-like environment.

## Phase 0 - Foundation - Partial

Implemented:

- Electron + React + TypeScript workspace.
- Architecture, decision, roadmap, and test documentation.
- Windows CI for frozen install, lint, tests, and renderer build.
- Pinned Electron runtime and local NSIS packaging configuration.
- Local SQLite schema, migration-on-open behavior, and legacy JSON import.
- Main/overlay sandboxing, web-security/no-webview settings, trusted IPC senders, and navigation/external-origin restrictions.

Remaining:

- Release signing/update strategy and installer smoke test in CI.
- Versioning/release process and dependency update policy.

## Phase 1 - Account - Partial

Implemented:

- First-run profile and account identity fields.
- Main-process Supabase email/password and Google OAuth entry points when configured.
- Encrypted local session/token persistence with cached sanitized identity, a ten-minute encrypted PKCE continuation (TimeFarm nonce + flow ID) that safely survives one restart, exact-route checks, and sanitized renderer identity.
- A 1.5-second bounded remote Auth hydration/verification path preserves a matching cached identity for local-first work on non-definitive offline failure; definitive credential rejection clears it.
- Main-process authenticated-principal binding: the renderer cannot choose an `authUserId`, and a linked local account rejects normal work/sync under a different signed-in subject. Unclaimed local data remains local and is not sync-eligible.
- Empty-device cloud bootstrap happens before onboarding can create a local profile; a found cloud workspace is restored without an outbox echo. Claiming pre-existing local data requires explicit consent plus an online snapshot check that refuses to overwrite an existing cloud workspace.

Remaining:

- Create and configure a real Supabase project; apply the migration.
- Verify email confirmation, password reset, Google redirect, sign-out, secure-storage failures, and account-switch behavior against it.
- Complete callback threat model/error telemetry and real-provider integration tests.

## Phase 2 - Timer + Local Data - Partial

Implemented:

- Start, pause, resume, complete, recovery-complete, discard, and one-active-session rule.
- SQLite-backed sessions and pause intervals; restart recovery prompt.
- Completed-session earnings form with zero accepted.
- Strict typed command IPC replaces the generic renderer snapshot mutation boundary. Main process derives IDs/timestamps and persists canonical state; mutations are serialized.
- Read-only command/timer preflight runs before a start/resume lease request, preventing invalid or stale timer actions from reserving a lease.
- Repository checks reject multiple active sessions, historical-session reopening/deletion, non-latest historical edits, unsafe pause sequences, and project deletion with retained history.
- Lease guard/renewal on start and resume when a configured, online-authenticated cloud service is available; each acquire/renew request is bounded to five seconds and offline/no-config operation never pretends to have a lease.

Remaining:

- Add crash-injection/clean-shutdown tests and an explicit recovery journal or marker.
- Add property/fuzz tests around command and repository validation.
- Validate recovery plus lease behavior on real networked devices.

## Phase 3 - Projects + Payments - Partial

Implemented:

- Typed commands and UI affordances for project create/update/status, payment create/update/delete, and goal create/update/delete.
- Completed-project session guard, separate payment records, and original-currency money facts.
- Project/history deletion safeguards in SQLite and the Supabase migration artifact.

Remaining:

- Add browser-to-database UI end-to-end coverage for project, payment, and goal affordances; decide whether a guarded project-delete affordance is needed beyond the existing data-integrity rule.
- Verify project completion/reopen rules with queued cloud operations in a real environment.

## Phase 4 - Cloud Sync - Partial

Implemented:

- SQLite outbox with per-entity pending-operation coalescing, operation UUID idempotency keys, retry/backoff, and queued/failed/conflict status.
- Explicit claimed-account eligibility: unclaimed local data is never sent to cloud; a cached offline principal keeps local work available but does not run sync or lease acquisition.
- Two unapplied Supabase migrations with RLS, ownership-checking RPCs, change cursor, ID/body validation, server-side completed-session pause ordering/bounds/duration validation, authenticated-only RPC execution, timer-lease RPC, canonical profile/preferences payloads, and a self-scoped bootstrap snapshot.
- Fresh-device snapshot bootstrap before onboarding/outbox creation, with atomic local import, synced status, and snapshot cursor persistence.
- Pull-before-push sync worker after local changes and periodically when configured/authenticated. Pull, push, and bootstrap RPCs use a 10-second deadline; failed/timed-out pulls stop that run before any push, and late responses are inert.
- Paginated remote pull with durable account cursor, atomic remote application, and state refresh after remotely applied changes.
- Conservative conflict handling: unsafe/deviating remote changes are recorded with payloads and retained-local data instead of being silently overwritten; the UI can keep local data queued for retry or safely adopt the recorded cloud version while cancelling the losing local operation.
- Per-installation timer lease requests/renewal with five-second RPC deadline; another device's active lease blocks start/resume here, while a late RPC cannot restore a failed local claim.

Remaining:

- Apply and test the migration, RLS, RPC grants, push/pull, cursor migration, and auth behavior in a real Supabase project.
- Validate the existing keep-local/retry and safe-use-cloud conflict choices with real concurrent edits; decide whether product requirements need field-level merge, duplicate-overlap resolution, recovery/export, or additional policy.
- Test overlapping offline work, competing-device leases, retry timing, network failures, large pulls, observability, backup/export, and data recovery.

## Phase 5 - Dashboard - Partial

Implemented:

- Dashboard metrics, timer card, trend charts, project breakdown, local goals, and period comparison.
- Predefined-widget show/hide, button-based reorder, constrained size selection, reset, and persisted layout state.

Remaining:

- Drag-and-drop reordering if it remains a strict UX requirement (current reorder uses explicit buttons).
- Add empty, loading, and error-state accessibility checks.

## Phase 6 - Analytics - Partial

Implemented:

- Stored-timezone range and daily-allocation calculations, including DST-oriented domain tests.
- UI ranges for 7D, 30D, 1M, 3M, 6M, and 1Y.
- Daily/cumulative earnings and time trends, effective-rate trend, project time/earnings breakdowns, period comparisons, duration distribution, efficiency ranking, goal progress, and guarded insights.
- Matching-currency active-time denominator for effective hourly rates; foreign-currency sessions cannot dilute account-currency rate calculations.

Remaining:

- Add range/UI regression tests, chart accessibility checks, and manual cross-timezone/DST validation.
- Add export only if approved.

## Phase 7 - Goals + Insights - Partial

Implemented:

- Goal creation, editing, deletion, progress, guarded observations, pace estimates, and projected-completion copy when enough data exists.

Remaining:

- Long-range validation and goal-specific automated/UI tests.

## Phase 8 - Overlay - Partial

Implemented:

- Separate transparent native mini-timer window with interactive, view-only, and hidden modes.
- Click-through/unfocusable view-only window and sender restrictions for overlay actions.
- Local position persistence, display-work-area clamping, timer snapshot updates, normal completion-form handoff, and command/lease-backed start/resume.

Remaining:

- Windows fullscreen/game, multi-monitor, DPI, accessibility, focus, shutdown, and installed-app smoke tests.
- Refine user-facing overlay position/reset controls and failure reporting as needed.

## Phase 9 - Hardening and release - In progress

Implemented:

- Unit tests for core time/money/analytics behavior and Electron repository, command/preflight, offline auth/principal, sync, lease timeout, and overlay seams.
- ESLint, TypeScript/Vite production build, Windows CI, and unsigned local packaging commands.
- Strict typed command schema and principal-binding checks at the desktop IPC boundary.
- Modal focus management/dialog semantics, reduced-motion CSS, and focused navigation-security tests for local renderer navigation, OAuth callback routes, external origins, and overlay navigation.

Remaining release gates:

- Hosted Supabase/RLS/RPC security and multi-device integration review.
- Real email/password and Google OAuth verification, callback hardening/telemetry, credential-storage failure testing, and account-switch review.
- Crash recovery, sync failure/large-pull, conflict-resolution, lease/offline-overlap, timezone/DST, currency/FX, accessibility, performance, and UI end-to-end tests.
- Production FX-provider contract, reliability/privacy, stale-rate, and user-interface validation while keeping original records immutable.
- Clean-machine installer/install/uninstall/upgrade testing, code signing, malware/reputation checks, privacy/support materials, update strategy, and release process.
