# TimeFarm redesign direction approval

## User authorization

The user explicitly authorized internal exploration and immediate self-selection:

> “có thể exploration nội bộ
> chọn direction tốt nhất dựa trên TimeFarm product goals
> implement direction tốt nhất ngay
> không dừng chờ tôi chọn trừ khi thực sự cần product decision lớn”

## Compared directions

All directions were rendered at the same 1440×900 viewport and include the
same active-session dashboard content, a mini timer, and a completion form.

- Direction A — Pixel Ledger:
  [`direction-a-pixel-ledger.html`](./direction-a-pixel-ledger.html) and
  [`direction-a-pixel-ledger.png`](./direction-a-pixel-ledger.png)
- Direction B — Calm Timeline:
  [`direction-b-calm-timeline.html`](./direction-b-calm-timeline.html) and
  [`direction-b-calm-timeline.png`](./direction-b-calm-timeline.png)
- Direction C — Quiet Instrument:
  [`direction-c-quiet-instrument.html`](./direction-c-quiet-instrument.html) and
  [`direction-c-quiet-instrument.png`](./direction-c-quiet-instrument.png)

The three ImageGen concept references are also preserved as
`concept-a-pixel-ledger.png`, `concept-b-calm-timeline.png`, and
`concept-c-quiet-instrument.png` in this directory.

## Selected direction

**Direction C — Quiet Instrument** is approved for production implementation.

It gives the active timer the strongest glance hierarchy, treats sessions and
earnings as a trustworthy ledger, and feels like a persistent Windows work
instrument instead of a web-dashboard template. Its open rules, compact data
density, signature timer enclosure, reserved teal, and start-only lime scale to
light and dark themes, analytics, forms, recovery states, and the mini-timer
overlay without inventing a timeline data model.

Direction A is distinctive but its pixel/retro language competes with financial
legibility and narrows the product's professional audience. Direction B is calm
and readable, but its dominant day timeline consumes the first viewport and
implies scheduling/interval detail that is not currently canonical product
data. Direction C best satisfies TimeFarm's product goals while preserving the
existing information architecture and implementation scope.

## Selected-direction coverage boards

Before production refactoring, the approved system was expanded beyond the
Dashboard so implementation decisions would share one fidelity contract:

- `quiet-instrument-analytics-projects-history.png` covers Analytics, the
  projects ledger, project detail, and History.
- `quiet-instrument-entry-recovery-settings-overlay.png` covers authentication,
  onboarding, recovery, Profile/Settings, dialog states, and interactive versus
  view-only mini timers.

These boards are design references only. Production behavior and canonical
data contracts remain authoritative when a concept specimen contains data or
controls not exposed by the real application.

## Fidelity ledger

Production was compared in the same QA pass against
`direction-c-quiet-instrument.png` and the two coverage boards using rendered
screens in this directory. Accepted production captures include
`production-dashboard-digital.png`, `production-dashboard-dark.png`,
`production-analytics-populated.png`, `production-project-detail.png`,
`production-history-populated.png`, `production-profile-dark.png`,
`production-settings-dark.png`, `production-complete-dialog.png`,
`production-onboarding.png`, and `production-recovery.png`.

Implemented faithfully: the crisp edge-to-edge desktop shell, open ledger
rules, timer-as-instrument enclosure, tabular HH:MM:SS display, measured scale,
utility teal, start-only lime, destructive rose, Segoe/Cascadia typography,
compact analytics summary rail, project/history ledgers, settings rows, and
interactive versus view-only overlay language.

Intentional differences: production uses canonical user data and copy rather
than illustrative concept values; it omits unsupported task/rate/window actions
from the mini timer; and it keeps Dashboard customization as a deeper section
instead of inventing the concept's fixed widget arrangement. These differences
protect real behavior and data contracts rather than reducing visual fidelity.
