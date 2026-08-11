# Changelog

All notable changes are documented here. TimeFarm follows semantic versioning
once a stable release line is declared; 0.x releases remain beta.

## Unreleased

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
