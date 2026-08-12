# TimeFarm full UI redesign — shared direction specification

## Consultant restatement

TimeFarm does not need a prettier collection of dashboard cards. It needs a
coherent desktop operating surface that makes the user's current work state
obvious, keeps money trustworthy, and lets deeper analysis recede until it is
requested. The audience is a freelancer or independent professional who may
leave the app open all day, resize it beside another tool, work offline, and
occasionally synchronize across devices. They must understand within one
glance whether the timer is idle, running, paused, blocked by a remote lease, or
waiting for completion details. Historical sessions, payments, goals, and FX
context need editorial clarity rather than decorative density. The redesign
must preserve every recovery and destructive state, remain keyboard-friendly,
and feel credible as a premium Windows utility. Based on that understanding,
three genuinely different visible directions will be created from this same
specification and the strongest one will be selected under the user's explicit
authorization to continue without a selection pause.

## Audience and usage context

- Primary: freelancers, consultants, solo operators, and small independent
  teams tracking both work and real earnings.
- Distance: 50–90cm laptop/desktop viewing; dense operational text remains
  readable without zoom.
- Sessions range from a compact side-by-side window to 1080p/1440p and 4K high
  DPI. Mobile breakpoints are fallback web-preview states, not the design's
  organizing principle.
- The app is often persistent background software, so visual noise and ambient
  animation are especially costly.

## Output and comparison dimensions

- Three self-contained HTML/CSS direction prototypes.
- Native comparison viewport: 1440×900.
- Each prototype shows the same populated Dashboard state with an active
  project timer, daily pulse, one goal, a seven-day earnings trend, and recent
  session rows. This is design sample data, clearly marked as illustrative.
- Each direction must include a visible compact mini-timer treatment and one
  modal/form sample so the system is not judged from a hero fragment.
- Layout skeletons must differ structurally, not merely by palette.

## Shared information architecture

1. Quiet desktop shell with TimeFarm identity, Dashboard, Projects, History,
   Analytics, Profile, and Settings.
2. First viewport prioritizes current timer and today's pulse.
3. A secondary layer shows one goal and one useful trend; analytics remains a
   deeper destination rather than a wall on Dashboard.
4. Projects favors a readable list/ledger with status and one contextual action,
   not oversized tiles.
5. History is table/list-driven with search/filter and locked-edit semantics.
6. Analytics uses a strong summary, one primary time-series visualization, then
   categorized detail sections with varied weight.
7. Profile/Settings use stable settings rows, radio/segmented controls only when
   meaningful, and isolated danger zones.

## Core workflow requirements

`Choose/create project → Start → Running ↔ Paused → End → actual earnings + currency + optional note → Save → live dashboard/history/analytics update`

- Start is lime and unique within the decision point.
- Pause, Resume, and End remain in the active timer without opening a menu.
- Completion clearly requires earnings (zero is allowed but never assumed).
- Pending actions disable duplicate clicks and show localizable live feedback.
- Recovery, conflict, cache rebuild, and device wipe use explicit language and
  never imply cryptographic erase.

## Required visual states

- Timer: idle, running, paused, pending, mutation error, remote lease held.
- Data: populated, empty, loading, stale FX, mixed currency, overlap notice.
- Sync: preview/local-only, syncing, queued, failed, conflict, clear.
- Forms: default, focus, validation error, disabled/pending, destructive confirm.
- Auth/onboarding/recovery: calm branded identity using the official mascot once.
- Theme: complete light and dark token sets with equal hierarchy.
- Mini timer: compact, glanceable, project + elapsed time + status + allowed
  controls; view-only mode cannot look clickable.

## Typography and density

- Offline system fonts only; Segoe UI Variable/Segoe UI first.
- Body/control 13–15px; secondary labels ≥12px; page title 28–36px.
- Timer 48–64px wide desktop and 34–44px compact, tabular figures.
- Use typography and rules to group data before adding containers.
- Maximum two nested surface levels. No all-card grid.

## Component families

- App shell, nav item, workspace/account switcher, top command/status rail.
- Timer instrument, project selector, daily pulse band, goal progress row.
- Data section header, metric pair, trend chart, comparison bar, table/list row.
- Buttons: lime Start, teal primary, neutral secondary, rose destructive, icon.
- Inputs/selects/textareas with 43px minimum height and consistent focus ring.
- Modal/drawer, inline alert, toast/live region, empty/loading/error state.
- Mini timer with interactive/view-only variants.

## Images and assets

The product is a data/tool surface; photography is not content-essential.
`assets/timefarm-avatar.png` is the only required image and is used for branded
entry/recovery moments. Concepts must not invent stock photography or fake
product renders. Charts, icons, and controls are code-native.

## Accessibility and responsive contract

- WCAG AA text contrast in light/dark; color is never the only state cue.
- Visible focus, logical tab order, skip link, `aria-current`, modal trap and
  focus restoration, live regions for mutations, accessible chart summaries.
- Desktop full nav; compact desktop icon rail with tooltips/labels; no essential
  action hidden by width. Tables may recompose into labeled rows, never create
  unexplained horizontal journeys.
- Modal max-height respects viewport. High-DPI uses CSS pixels and crisp SVG.

## Anti-slop constraints

- No default purple/blue AI gradient, glassmorphism, bokeh, glow, giant hero,
  decorative badge row, emoji icon, or arbitrary floating card.
- No generic card-everywhere dashboard, no equal-weight analytics wall, no
  excessive radius/shadow, no decorative data.
- The visual motif must grow from tracking time + cultivating earnings: measured
  intervals, ledger rules, planted/harvested progress, or an instrument dial—
  never literal farm clip-art.

## Form derivation answers

- Narrative role: operational mission control, with analytics as supporting
  evidence.
- Viewer distance: laptop/desktop at arm's length.
- Visual temperature: calm, precise, lightly human.
- Capacity: first viewport holds shell, timer, daily pulse, one goal, and one
  trend without scrolling at 1440×900.
- Visual motif: a precision work instrument that turns measured intervals into
  a trustworthy earnings ledger. The motif appears through time rails, rules,
  tabular numbers, and one timer enclosure—not agricultural illustration.
