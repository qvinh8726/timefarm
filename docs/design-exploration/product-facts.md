# TimeFarm product facts

Verified on 2026-08-12 against the local repository at
`4fc7381fe2ad6a4d0f3197bc66a52a88099db2b8` plus the public
[qvinh8726/timefarm repository](https://github.com/qvinh8726/timefarm).

## Product

- TimeFarm is an offline-first Windows desktop app for focused work time,
  projects, actual earnings, goals, and productivity analytics.
- Local work uses Electron + SQLite and remains usable without a network.
- Supabase authentication and multi-device synchronization are optional.
- The prepared release version is `0.2.2` beta/pre-release. The app must not imply
  hosted sync or signed-installer guarantees that have not been verified.
- Supported historical currencies are VND, USD, EUR, JPY, and GBP. Values must
  retain currency context; reference conversion is optional and visibly dated.

## Core workflow

`Select or create project → Start → Pause / Resume → Complete → enter actual earnings → session saved → dashboard/history/analytics update`

The timer is the product's strongest live state. Completion cannot silently
invent zero earnings. Unfinished-session recovery, cloud conflicts, rebuild,
and device wipe must remain explicit and recoverable.

## Required surfaces

- Pre-workspace: splash, load failure, legacy recovery, authentication, cloud
  bootstrap failure, onboarding, workspace claim, account mismatch.
- Workspace: shell/navigation, dashboard, active timer, projects, history,
  analytics, profile, settings, synchronization status and conflict handling.
- Dialogs: start, complete, project, payment/history, goal, latest-session edit,
  dashboard customization, destructive confirmations, timer recovery.
- Native companion surface: compact mini timer in hidden, view-only, and
  interactive modes.

## Current technical constraints

- React 19 + TypeScript + Vite renderer; Electron 43 main process.
- Lucide is the established icon family. App text and controls remain native
  React/HTML, never baked into concept images.
- Offline visual reliability matters: no remote font dependency.
- Main window targets 1440×920 and currently has a 1080×700 minimum. Design QA
  also covers 1024×768, compact side-by-side widths, 1440p, and high DPI.
- Light and dark themes, keyboard navigation, visible focus, WCAG AA contrast,
  reduced motion, localized VI/EN UI, and no accidental horizontal overflow are
  mandatory.

## Existing strengths to preserve

- Today-first information architecture and one prominent timer action.
- Skip link, `aria-current`, live/error regions, focus trap/restoration,
  accessible chart descriptions, reduced-motion handling, and explicit empty
  states.
- Honest local/cloud status and original-currency financial context.

## Problems the redesign must solve

- The renderer currently contains overlapping legacy purple and teal CSS
  systems, producing cascade debt and inconsistent typography.
- Dashboard/analytics rely on too many equal-weight rounded cards.
- Essential labels occasionally fall below 12px.
- The mini timer is an English-only blue/purple visual island.
- The official mascot is absent from the renderer while the shell uses a
  generic letter mark.
- `App.tsx` and the dialog file are visually monolithic; the redesign should
  establish reusable presentation primitives rather than add another override
  layer.
