# TimeFarm final hardening report

Updated: 2026-08-13
Audit baseline: `4fc7381fe2ad6a4d0f3197bc66a52a88099db2b8`
Production migration/release hardening source: `df93fdd51cebd81c9adb11f91489dcf553e80650`
Desktop navigation hotfix: `09c6e63`
Release candidate: `0.2.3` (not yet published)

## 1. P0 fixed

- Hardened `workly_pull_changes` behind a subject-bound `SECURITY DEFINER` RPC
  with an empty `search_path`; authenticated clients can pull but cannot select
  `sync_changes` directly.
- Removed network/auth work from the SQLite mutation critical section. Timer
  intent timestamps are captured at IPC receipt, sync is coalesced, and lease
  renewal remains independent of slow network work.
- Protected project history with restrictive foreign-key behavior, consistent
  transaction ordering, parent locking, and database/repository guards against
  concurrent session/payment insertion versus deletion.

## 2. P1 fixed

- Daily money allocation now uses deterministic integer minor-unit
  largest-remainder allocation; range and daily totals conserve exactly.
- Keep-local conflict resolution creates or refreshes a canonical outbox retry
  before resolving the conflict.
- Legacy import returns structured recovery outcomes and preserves Retry,
  export/open-folder recovery, and explicitly confirmed Skip paths.
- Cache rebuild and device wipe are separate. Wipe suppresses bootstrap,
  clears auth/workspace/recovery/WAL state, verifies cleanup, and makes no claim
  of cryptographic SSD erasure.
- Dashboard and Analytics share the canonical live union-duration semantics;
  active overlap is not double-counted and earnings remain completed-only.
- Critical renderer and mini-timer mutations serialize requests, inspect
  `ActionResult`, disable duplicate actions, and expose localized live errors.
- Packaging accepts publishable keys or legacy `role=anon` JWTs only, and
  rejects secret/service-role/malformed keys.
- Production uses a dedicated publishable desktop key, and legacy anon/
  service-role API-key headers are disabled at the hosted gateway.

## 3. Medium fixed

- Bounded auth/OAuth, Supabase RPC, FX, sync, and lease network operations.
- Revision-aware CAS is required; legacy writers are private and retired from
  client access.
- Cloud bootstrap and normal pull are bounded and paginated.
- Added a guarded retention watermark/pruning contract while retaining entity
  tombstones and unresolved local work; see `supabase/RETENTION.md`.
- Added sync/ownership indexes and optimized RLS `auth.uid()` use.
- Locked local/IPC/cloud validation parity, including Unicode code-point limits,
  ECMAScript whitespace, countries, money, goals, colors, and icons.
- Enforced future-recovery validation and deterministic latest-session ID
  tie-breaking.
- Reduced command persistence to declared collections and split renderer state
  from stable actions; project ledgers pre-index sessions/payments with maps.
- Serialized Dashboard customization and settings mutations.
- Improved semantic headings, `dl` facts, field descriptions, focus behavior,
  dialogs, live regions, compact tables, document title/lang, and Analytics
  overflow.
- Expanded renderer/Electron coverage scope and preload bridge verification.
- Added Electron permission/webview/navigation/trusted-sender defense in depth.
- Removed mobile-only `inert`/`aria-hidden` state from the shared secondary
  navigation so Profile and Settings remain interactive on desktop.
- Added `.gitattributes`, aligned Node/type configs, refreshed support/privacy/
  architecture/release documentation, and made device-wipe wording truthful.

## 4. Schema and migration changes

- `0006_production_hardening.sql`: pull permission boundary, validation, locking,
  FK protection, indexes, and bounded RPC hardening.
- `0007_sync_contract_and_retention.sql`: final sync contract retirement,
  pagination/retention watermark, safe pruning, and additional parity/index
  changes.
- `0008_timer_lease_privileges.sql`: removes inherited `PUBLIC` and direct
  `anon` execution from the timer-lease RPC while retaining `authenticated`.
- pgTAP plans match their assertions: schema/security 61 and behavior/RLS 44,
  for 105 assertions total.

## 5. Concurrency architecture changes

User intent now captures its timestamp immediately, performs one short local
mutation, and returns without awaiting HTTP. Network sync has a separate
coalesced single-flight executor that preserves pull-before-push. Lease renewal
is independently scheduled. Wipe cancels/invalidates in-flight pull and push
results so late responses cannot repopulate cleared state.

## 6. Security hardening

- Narrow context-isolated preload bridges, trusted IPC senders, denied renderer
  permissions/webviews, exact navigation origins, CSP, and OAuth callback checks.
- Encrypted local auth, bounded PKCE continuation, strict token non-exposure,
  fail-closed public-key packaging, and 9/9 Electron fuse policy checks.
- Added CODEOWNERS, pinned Actions verification, Dependabot, CodeQL/dependency
  review, explicit unsigned-v0.x release gates, SBOM generation, and exact-artifact
  SBOM/build-provenance attestations.

## 7. UI/UX redesign

- Applied the approved **Quiet Instrument** direction directly to production:
  edge-to-edge Windows shell, restrained teal, lime reserved for Start/Continue,
  signature HH:MM:SS timer instrument and measured scale, open project/history
  ledgers, project detail/payment record, ledger-first Analytics, Profile identity
  sheet, aligned Settings rows, recovery/auth/onboarding/forms, and real Electron
  mini timer.
- Light/dark and 1440, 1024, 800, and 620 CSS-pixel layouts were visually tested
  without horizontal overflow. Meaningful rendered main-content text has a 12px
  floor, focus is visible, modals fit the viewport, and reduced motion is honored.
- Design exploration, approval, coverage boards, fidelity ledger, and accepted
  production captures live in `docs/design-exploration/`.

## 8. Added or changed tests

- Renderer: 11 files / 76 tests after the desktop navigation regression test,
  including money invariants, live overlap, validation, state serialization,
  accessibility, Analytics, and inline wipe confirmation.
- Electron: 204 tests covering timer timestamps, slow-sync isolation, sync
  coalescing, leases, repository invariants, conflicts, wipe/recovery, auth
  timeouts, client-key validation, navigation/security, preload bridges, and the
  Quiet Instrument overlay.
- Database contract tests cover RPC-only pull access, CAS, bounded bootstrap,
  deletion protection, retention, indexes, and validation parity.

## 9. Full gate results

Passed locally:

- `pnpm install --frozen-lockfile`
- `pnpm format:check`
- `pnpm lint`
- `pnpm lint:css`
- `pnpm check:electron`
- `pnpm check:workflows`
- `pnpm test` — Renderer 76/76; Electron 204/204
- `pnpm test:coverage` — Renderer 63.29% lines; domain 95.66% lines;
  Electron 89.03% lines / 73.91% branches / 93.56% functions
- `pnpm build`
- `pnpm check:bundle` — 8 chunks, largest 194,055 B, total 610,406 B
- `pnpm audit --audit-level high` — no known vulnerabilities

Not locally executable on the release workstation:

- `pnpm test:db` reached `127.0.0.1:54322` and failed with `ECONNREFUSED`
  because Docker/Supabase local is not running. No local pgTAP pass is claimed.

Passed in GitHub CI on the pushed release source:

- Fresh database replay of migrations `0001` through `0008`.
- `supabase db lint --local --level error` — no schema errors.
- `supabase test db --local` — 2 files / 105 assertions, all successful.
- Windows quality, build, packaging, and installer smoke jobs.
- CodeQL JavaScript/TypeScript analysis.

Passed against the hosted production project:

- Production migration deployment confirmed the remote ledger is current
  through `0008`.
- `pnpm check:cloud` passed 6/6 RPC existence and unauthenticated-denial probes.
  These negative probes do not claim authenticated CRUD/sync or OAuth success.

## 10. Packaging results

- A cloud-mode installer built from `df93fdd` with production public
  configuration passed explicit ASAR mode, 9/9 Electron fuse, packaged-app,
  install/render/uninstall, cleanup, and `NotSigned` checks.
- That pre-hotfix installer was rejected after runtime QA found Profile and
  Settings trapped beneath a desktop `inert` ancestor. It will not be released.
- The hotfix at `09c6e63` adds a red/green regression test and removes the
  shared inert state. The final installer identity is intentionally omitted
  until the tagged workflow rebuilds and publishes the exact artifact.
- Offline `pnpm pack:win:offline`: pass with an explicit offline marker inside
  the final ASAR and 9/9 fuse checks.
- `pnpm smoke:win:packaged` and `pnpm smoke:win:installer`: pass for both modes;
  each packaged app rendered its expected entry flow, and each installer
  installed, rendered, uninstalled, and cleaned up.
- The v0.x production-environment workflow requires public cloud
  configuration, disables certificate discovery, and rejects the installer
  unless Authenticode reports `NotSigned`.

## 11. External actions still required

Before publication:

1. Validate the complete installed-app Google PKCE flow: system-browser login,
   exact `timefarm://` callback, app restart, cancellation, expiry, and provider
   error handling.
2. Validate workspace claim/link plus authenticated sync push/pull on production
   without wiping existing local data. Test conflicts and competing timer leases
   on physical devices before making a multi-device guarantee.
3. Publish only an unsigned `v0.*` prerelease, retain the visible Unknown
   Publisher/SmartScreen disclosure, and verify its SHA-256 plus SBOM and
   build-provenance attestations.
   Code signing and reputation building are deferred to a future stable line.

Strict `master` protection already requires CI, database replay, CodeQL,
dependency review, and conversation resolution. Production environment secrets
and reviewer protection are also configured.

## 12. Remaining known risks

- Production migrations and the six unauthenticated RPC denial boundaries are
  hosted-verified. Authenticated CRUD/sync, conflict resolution, retention
  pruning, real-provider sign-in, concurrent hosted races, and physical
  multi-device lease behavior are not yet verified.
- SQLite/database concurrency tests cover repository and SQL contracts, but a
  true competing-client hosted/Postgres race remains unverified.
- Clean-machine unsigned upgrade/rollback, physical screen readers, multi-monitor,
  high-DPI Windows scaling, crash/power-loss, and extended provider/network
  outage testing remain external release validation.
- The project remains a beta until those hosted and physical-device checks are
  completed; code signing is not a gate for the explicitly unsigned v0.x line.
