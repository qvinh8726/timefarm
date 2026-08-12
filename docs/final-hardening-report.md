# TimeFarm final hardening report

Date: 2026-08-12
Base revision reviewed: `4fc7381fe2ad6a4d0f3197bc66a52a88099db2b8`
Working tree: intentionally uncommitted

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
- Added `.gitattributes`, aligned Node/type configs, refreshed support/privacy/
  architecture/release documentation, and made device-wipe wording truthful.

## 4. Schema and migration changes

- `0006_production_hardening.sql`: pull permission boundary, validation, locking,
  FK protection, indexes, and bounded RPC hardening.
- `0007_sync_contract_and_retention.sql`: final sync contract retirement,
  pagination/retention watermark, safe pruning, and additional parity/index
  changes.
- pgTAP plans match their assertions: schema/security 58 and behavior/RLS 44.

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
  review, signed-release gates, SBOM generation, and SBOM attestation workflow.

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

- Renderer: 10 files / 67 tests after redesign, including money invariants,
  live overlap, validation, state serialization, accessibility, Analytics, and
  inline wipe confirmation.
- Electron: 151 tests covering timer timestamps, slow-sync isolation, sync
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
- `pnpm test` — Renderer 67/67; Electron 151/151
- `pnpm test:coverage` — Renderer 61.88% lines; domain 94.73% lines;
  Electron 88.37% lines / 72.17% branches / 93.12% functions
- `pnpm build`
- `pnpm check:bundle` — 8 chunks, largest 190,489 B, total 607,047 B
- `pnpm audit --prod` — no known vulnerabilities

Not locally executable:

- `pnpm test:db` reached `127.0.0.1:54322` and failed with `ECONNREFUSED`
  because Docker/Supabase local is not running. No local pgTAP pass is claimed.
- `pnpm check:cloud` correctly refused to run without a hosted Supabase URL and
  public key. No hosted sync/auth verification is claimed.

## 10. Packaging results

- Offline `pnpm pack:win:dir`: pass, including 9/9 fuse checks.
- `pnpm smoke:win:packaged`: pass; renderer, lazy pages, and dialog loaded and
  exited cleanly.
- NSIS QA build with the repository's public CI placeholder configuration:
  pass. This is not a production credential or hosted-cloud verification.
- `pnpm smoke:win:installer`: pass; installed, rendered, uninstalled, and cleaned
  up.
- Offline v0.2.2 public prerelease build: pass in the isolated
  `release-public/` output, with no bundled runtime config or CI placeholder;
  9/9 fuse checks, packaged smoke, and installer install/render/uninstall/cleanup
  all passed. Authenticode reports `NotSigned`, matching the release disclosure.
- Real release `pnpm pack:win` without credentials correctly hard-failed. A
  signed production installer still requires the public hosted configuration
  plus Windows signing secrets in the release environment.

## 11. External actions still required

Repository owner/admin must:

1. Run fresh Supabase migration replay, lint, and pgTAP (58 + 44 assertions),
   then run `pnpm check:cloud` against the real hosted project.
2. Configure the GitHub `production` environment secrets and required reviewer;
   enable branch/ruleset protection requiring CI, database, security, and signed
   release checks.
3. Enable GitHub private vulnerability reporting, code scanning, dependency
   graph/alerts, and secret scanning/push protection in repository settings.
4. Add the Windows code-signing certificate secrets, publish signed artifacts,
   verify SHA-256/SBOM attestations, and establish SmartScreen reputation.
5. Validate Email Auth/Google OAuth redirects, multi-device conflict/lease
   behavior, and long offline-window retention on physical devices.

## 12. Remaining known risks

- Hosted Supabase behavior is verified only by static/unit/database contract
  tests in this environment; real credentials were intentionally unavailable.
- SQLite/database concurrency tests cover repository and SQL contracts, but a
  true two-connection hosted/Postgres race run still depends on Docker/CI.
- Clean-machine signed upgrade/rollback, physical screen readers, multi-monitor,
  high-DPI Windows scaling, crash/power-loss, and extended provider/network
  outage testing remain external release validation.
- The project remains a beta until those hosted, signing, and physical-device
  checks are completed.
