# Changelog

All notable changes are documented here. TimeFarm follows semantic versioning
once a stable release line is declared; 0.x releases remain beta.

## Unreleased

## 0.2.2 - 2026-08-12

### Quiet Instrument redesign

- Reworked every production surface around the approved Quiet Instrument
  direction: a focused edge-to-edge Windows shell, restrained teal palette,
  signature timer display, open ledgers, responsive light/dark layouts, and a
  visually aligned native mini timer.
- Refined Dashboard, Projects, History, Analytics, Profile, Settings,
  onboarding, authentication, recovery, and destructive confirmation flows.
- Improved semantic structure, focus handling, live regions, compact tables,
  reduced-motion behavior, localized errors, and small-screen overflow safety.

### Data correctness and resilience

- Removed network and authentication work from the SQLite mutation path so
  timer intents persist promptly while synchronization runs through a separate
  coalesced single-flight executor.
- Protected retained session and payment history from unsafe project deletion,
  including concurrent record-creation races.
- Added deterministic integer minor-unit allocation so daily and range
  earnings conserve the exact recorded total.
- Made **Keep local & retry** recreate a canonical outbox operation before
  resolving a sync conflict.
- Added structured legacy recovery choices and separated cloud cache rebuild
  from a verified local device wipe that does not claim cryptographic erasure
  or hosted-data deletion.
- Unified Dashboard and Analytics around canonical overlap handling: account
  time counts each active instant once while sessions and earnings remain
  intact.

### Optional cloud and desktop security

- Added migrations `0006_production_hardening.sql` and
  `0007_sync_contract_and_retention.sql` for subject-bound pull access,
  validation parity, locking, optimistic revisions, bounded pagination,
  retention guards, deletion protection, and supporting indexes.
- Added bounded authentication, OAuth, Supabase RPC, FX, sync, and timer-lease
  operations, plus stricter runtime validation for public Supabase client keys.
- Hardened Electron navigation, permissions, webviews, IPC sender trust,
  preload bridges, and application fuses; added pinned workflow verification,
  CODEOWNERS, Dependabot, CodeQL/dependency review, SBOM, and signed-release
  workflow foundations.

### Verification and distribution

- Passed formatting, JavaScript and CSS linting, Electron/workflow checks,
  67 renderer tests, 151 Electron tests, coverage gates, the production build,
  bundle budgets, the production dependency audit, packaged-app smoke, 9/9
  Electron fuse checks, and NSIS install/render/uninstall QA.
- GitHub CI replayed migrations `0001` through `0007` on a fresh Supabase
  database, reported no schema lint errors, and passed 102 pgTAP assertions.
  The release workstation lacked a local Supabase stack, and no hosted URL or
  public key was supplied; no hosted Auth or multi-device verification is
  claimed.
- Prepared the Windows x64 build as an unsigned, offline-only prerelease. The
  installer intentionally bundles no Supabase configuration, so optional cloud
  authentication and synchronization are disabled in this artifact.

## 0.2.1 - 2026-08-12

### Windows UI hotfix

- Removed Electron's generated File/Edit/View/Window application menu from
  the Windows build, including the menu-bar reveal previously triggered by Alt.
- Fixed an unlayered legacy stylesheet that overrode the redesigned dashboard
  grid and could squeeze widgets into columns as narrow as 77 pixels.
- Rebalanced the default dashboard order and widget sizes, switched cramped
  tablet layouts to full-width cards, and compacted sidebar navigation earlier.
- Corrected the sync-status pill and icon-only mobile controls so their labels
  no longer overflow narrow toolbars.

### Verification

- Visually audited the live renderer at 1440×900, 1080×720, 900×1000, and
  390×844, then re-ran formatting, linting, 137 automated tests, coverage,
  bundle budgets, and the packaged Windows application smoke test.

## 0.2.0 - 2026-08-12

### New experience

- Rebuilt the Windows interface around a calm, responsive dashboard with
  clearer hierarchy, light/dark themes, accessible dialogs, improved focus
  states, history pagination, and a native mini timer.
- Added configurable dashboard widgets, deeper analytics, goal pace, project
  efficiency, bilingual foundations, and lazy-loaded account/dialog pages.

### Data correctness and cloud safety

- Added atomic cloud workspace claims, paginated bootstrap, pull-before-push
  synchronization, per-entity optimistic revisions, and explicit conflict
  resolution.
- Added deterministic offline-overlap accounting: account time counts each
  active instant once while preserving every session, earning, and project
  fact.
- Prevented legacy JSON data from returning after reset and replaced the local
  schema setup with ordered transactional SQLite migrations and recovery
  export.
- Serialized authentication, sync, OAuth callbacks, timer commands, and lease
  renewal to remove account-transition races.

### Money, quality, and distribution

- Selected Frankfurter v2 reference rates with a ten-second timeout, complete
  five-currency validation, a 24-hour cache freshness window, and a seven-day
  source-age limit.
- Added renderer accessibility tests, Electron checks, SQL/RPC tests, coverage
  thresholds, CSS duplicate detection, bundle budgets, pinned CI workflows,
  packaged-app smoke tests, and full NSIS install/render/uninstall cleanup.
- Added release, privacy, security, support, architecture, and design-system
  documentation.

## 0.1.2

- Published the initial Windows beta preview.
