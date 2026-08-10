# Core Test Cases

## Automated coverage in the repository

Run all available automated checks with:

```powershell
pnpm lint
pnpm test
pnpm build
```

`pnpm test` runs Vitest domain tests and Node tests for Electron services. The CI workflow repeats those commands on Windows/Node 24.

| Area | Automated today | Important gaps |
| --- | --- | --- |
| Timer math | Pause subtraction, overlapping/in-progress pauses, midnight allocation, stored-timezone day keys, DST-oriented intervals, datetime-local formatting | Real Electron restart/crash injection and user recovery choices |
| Analytics | Matching original currency, clipped allocation, long daily series, and matching-currency hourly-rate denominator | Full UI range selector, period comparison, chart rendering, accessibility, and wider DST matrix |
| Local SQLite | Malformed-state rejection, one-active-session invariant, protected history, outbox coalescing/retry, remote apply/cursor/conflict behavior, atomic cloud-snapshot bootstrap, and safe recorded-remote conflict adoption | Transaction interruption, migration upgrade, fuzz input validation, and concurrent writes |
| Typed command IPC | Strict command schemas, main-owned IDs/timestamps, entity lookup, normal transitions, account-link restrictions, and no-write timer preflight | Full Electron IPC adversarial and UI end-to-end tests |
| Authentication seam | Explicit config validation, encrypted session/cached identity behavior, bounded 1.5-second offline fallback, sanitized renderer user shape, and restart-safe encrypted PKCE/nonce callback verification | Real email/password, Google OAuth callback, encrypted-storage failure, sign-out, and account-switch integration |
| Sync and lease seams | Claimed-account sync eligibility, fresh-device bootstrap, pull-before-push ordering, pull/push timeout and late-response isolation, push success/failure retention, paginated pull, both conflict choices, and bounded lease acquisition/renewal outcomes | Hosted Supabase RLS/RPC, retries over time, competing devices, and network faults |
| Desktop navigation/security | Exact app/overlay navigation, OAuth callback parsing, and configured-origin external URL allowlisting | Full Electron adversarial IPC and packaged-app security testing |
| FX service seam | Provider-payload validation, atomic cache persistence, minor-unit conversion, and stale-cache/outage behavior | Real-provider contract, desktop UI flow, and reliability/privacy tests |
| Native mini timer | Snapshot duration, click-through/action guards, position clamping/persistence, command-backed start/pause/resume, completion handoff | Real Windows multi-monitor/DPI/fullscreen and accessibility tests |
| Build quality | ESLint and TypeScript/Vite production build | Electron installer smoke test and UI end-to-end tests |

The current tests do **not** prove that a hosted Supabase project, real Google OAuth provider, production FX service, real click-through overlay, or Windows installer works. Treat the following as required manual/integration coverage until automated tests are added.

## Authentication and account ownership

Prerequisite: provision a separate test Supabase project, apply both migrations in order, and configure `TIMEFARM_SUPABASE_URL` / `TIMEFARM_SUPABASE_ANON_KEY` only in the launcher environment.

- [ ] Register with email/password and verify the intended email-confirmation behavior.
- [ ] Sign in and restart the app; confirm the session restores only when secure credential storage is available.
- [ ] Disconnect the network after a linked sign-in. Confirm each remote Auth hydration/verification step returns to cached local identity within its 1.5-second deadline, local work remains available to the matching account, and a later online verification refreshes it.
- [ ] Simulate a definitive revoked/invalid credential response and confirm the encrypted session/cached identity is removed rather than being treated as offline.
- [ ] Sign out and confirm the local session credential is removed and lease renewal stops.
- [ ] Sign in with Google using `timefarm://auth/callback`; verify cancel, expired callback, mismatched `timefarm_state`/PKCE flow ID, callback replay, malformed callback, and incorrect deep-link route failures.
- [ ] Verify a renderer never receives access or refresh token values, and cannot link an account by submitting another user's ID.
- [ ] On a new device with an existing cloud workspace, sign in online before local onboarding and verify the complete cloud snapshot is restored with no local outbox echo. Disconnect or make the snapshot RPC fail and verify onboarding is blocked rather than guessing the workspace is absent.
- [ ] Create unclaimed local data, sign in to a cloud account that already has a workspace, and verify the explicit claim is refused; verify only a confirmed empty cloud workspace can be claimed after the local-data consent.
- [ ] Create local data as user A, link it, then sign in as user B on the same machine. Confirm normal commands, overlay actions, and sync do not silently merge, overwrite, or expose user-A data.
- [ ] Verify user A cannot fetch, mutate, or delete user B's records through direct Supabase calls or the sync RPC.
- [ ] Verify unauthenticated callers cannot execute any exposed cloud RPC, and authenticated callers can execute only their own records.

## Local timer, commands, and recovery

- [ ] Start, pause, resume, and complete a session. Check that active duration excludes every pause.
- [ ] Try to start a second session while one is running or paused; the action must be rejected.
- [ ] Start an unassigned session and a project-linked session in separate runs.
- [ ] Complete a session with zero earnings; verify it appears in history and analytics without division errors.
- [ ] Create a long session and sessions crossing local midnight in at least two IANA timezones, including a DST transition zone.
- [ ] Force-close the app while running and while paused. Relaunch, then test Continue, Complete, custom end time, and allowed Discard behavior; ensure no duplicate session is created.
- [ ] Attempt to edit an older completed session; verify the UI keeps it locked.
- [ ] Attempt malformed/unknown typed commands, extra fields, forged IDs, and commands referencing absent entities. Verify no partial database write occurs.
- [ ] Issue an invalid or stale start/resume action while a cloud lease endpoint is reachable. Confirm read-only preflight rejects it before any lease RPC, and concurrent renderer/overlay/reset actions remain serialized.
- [ ] Attempt to persist two active sessions, reopen or remove a completed session, or remove a project with history. Each invalid transition must be rejected without a partial database write.
- [ ] Inspect the user-data SQLite file after normal use and ensure projects, sessions, pauses, payments, goals, preferences, pull cursor, and conflict records survive restart as applicable.

## Projects, payments, analytics, goals, and dashboard

- [ ] Create a project with minimum fields and with all payment/expected-money fields.
- [ ] Pause, complete, and reopen a project according to the product rules.
- [ ] Attempt to start a new session on a completed project; it must be blocked.
- [ ] Record progressive and completion payments. Confirm they remain separate from a session's actual earnings.
- [ ] Edit and delete a payment from its project's payment history; edit and delete a dashboard goal. Verify the canonical state, analytics, and queued sync operation update without changing session earnings.
- [ ] Record amounts in multiple currencies; verify original values remain intact and no account-currency conversion is invented.
- [ ] Check one and multiple completed sessions against hand-calculated daily duration and earnings.
- [ ] Check the available 7-day, 30-day, 1-month, 3-month, 6-month, and 1-year UI ranges. Boundary sessions must be clipped, not counted in full.
- [ ] Validate previous-period comparisons and project ranking with empty, zero-earnings, and mixed-currency datasets. Foreign-currency work time must not alter an account-currency effective rate.
- [ ] Confirm short durations do not show an implausible effective hourly rate.
- [ ] Create daily/weekly/monthly hours, earnings, and completed-project goals; verify progress, remaining amount, expected-by-now, pace, projected-completion estimate, and insufficient-data states.
- [ ] Hide, reorder, and resize each supported predefined dashboard widget; reload and verify persistence. Record that current reordering uses buttons, not drag-and-drop.
- [ ] Confirm every empty/error state explains what data is missing without inventing an insight.

## Sync, conflicts, leases, and server security integration

- [ ] With no cloud configuration, confirm timer and SQLite persistence work and sync reports no configuration rather than throwing.
- [ ] Create and use an unclaimed local profile with cloud configuration present. Confirm it never sends outbox data or requests cloud sync/leases until the explicit authenticated claim succeeds.
- [ ] Apply both migrations in order. With a direct authenticated RPC request, verify `workly_bootstrap_snapshot` returns only the caller's profile, completed sessions/pauses, projects, payments, goals, canonical preferences, and a usable cursor; verify an account with no profile returns `found: false`.
- [ ] Complete a session offline, reconnect, and verify its matching outbox operation reaches the server exactly once.
- [ ] Simulate server/network failure or a stalled pull RPC. Verify no push occurs before a successful pull, the cursor remains unchanged, a late pull response is inert, and the next run retries safely. Stall bootstrap/push too and verify their 10-second deadlines leave state/outbox retryable and late responses inert.
- [ ] Verify project/payment/goal/preferences updates and allowed deletes are idempotent. Attempt a non-account cloud write before a profile exists and confirm the server rejects it. Send a mismatched entity ID/body and confirm the server RPC rejects it. Send completed-session pauses that are out of bounds, overlap/out of order, or yield a mismatched active duration and confirm the server rejects them.
- [ ] Use two devices signed into the same test account. Create independent data on each, sync, and verify pull cursor progression, pagination, and eventual safe remote application.
- [ ] Create conflicting edits to the same queued project/payment/goal from two devices. Verify the local pending version is retained, an open conflict is visible with its reason, and the cursor advances. Test **Keep local & retry** retains the pending operation, then test **Use cloud version** only applies a safe recorded payload and atomically cancels the losing local operation; an unsafe choice must leave the conflict open.
- [ ] Verify remote changes cannot turn a local timer into running/paused, overwrite an active local timer, delete completed session history, or delete a project with retained history.
- [ ] Have device A start or resume while it holds a lease. Confirm device B is blocked from start/resume; after A stops renewing or expires, confirm B can acquire. Repeat around recovery Continue.
- [ ] Stall the lease RPC. Confirm acquire and renewal time out within five seconds, do not report a held lease, and a late successful response cannot revive the local claim.
- [ ] Exercise offline overlap deliberately: start local work without a configured/authenticated/reachable cloud service, reconnect both devices, and verify the resulting overlap/conflict is visible and does not silently rewrite history.
- [ ] Review RLS policies, RPC grants, function search paths, and ownership checks with a test user and an anonymous request before production access.

## FX, overlay, and release

- [ ] Document and test the production FX provider contract. Test fresh, stale, missing, malformed, and provider-outage states; original money must never change.
- [ ] Test the native mini timer in interactive, view-only, and hidden modes. Interactive Stop must open the regular completion form rather than write earnings directly.
- [ ] Verify view-only mode is click-through, cannot focus, and cannot handle start/pause/resume/stop actions.
- [ ] Verify interactive overlay start/resume follows the same timer lease restriction as the main window.
- [ ] Drag the mini timer, restart the app, and verify its saved position restores on-screen. Repeat on secondary displays, unusual DPI settings, and after display removal.
- [ ] Test fullscreen/game behavior, Alt+Tab, app close/reopen, and keyboard/screen-reader behavior on a real Windows system.
- [ ] Exercise every modal with keyboard only: initial focus, Tab/Shift+Tab containment, Escape/backdrop close where allowed, locked recovery behavior, focus restoration, accessible name/role, and `prefers-reduced-motion` behavior.
- [ ] Attempt renderer navigation/redirects to lookalike development hosts, sibling packaged paths, credential-bearing URLs, arbitrary external schemes, and non-TimeFarm deep links. Verify they are denied; only the configured Supabase origin may open externally and only `timefarm://auth/callback` reaches OAuth handling.
- [ ] Run `pnpm pack:win` on a clean Windows machine, install the NSIS artifact, launch it, and verify SQLite/auth paths resolve correctly from the installed app.
- [ ] Test install, uninstall, upgrade, Windows Defender reputation, code signature, and update behavior before any public distribution.
