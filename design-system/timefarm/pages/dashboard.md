# Dashboard Overrides

> The dashboard is TimeFarm's “Today mission control.” These rules override the master only for this page.

## Information order

1. Page intent, current date, and Customize action.
2. Active/idle timer plus Daily Pulse in one command grid.
3. Goals and trends as a secondary bento section.
4. Deeper historical analysis remains on Analytics.

## Wide layout

- Use a 12-column grid.
- Timer: 8 columns.
- Daily Pulse: 4 columns with four compact KPIs.
- Default insight row: Goals 4 columns + Earnings trend 8 columns.
- Large insight widgets span 8; medium and small widgets span 4.

## Timer

- It is the strongest visual object in the first viewport.
- Idle: one primary Start action inside the card; the sidebar may retain a global Start shortcut.
- Active: project, elapsed time, Pause, and End session remain visible without opening another dialog.
- Do not allow the page header to add another duplicate Start action.

## Daily Pulse

- Show work time, earnings, effective hourly value, and completed sessions.
- Each metric includes its timeframe or calculation state.
- Use a two-by-two compact grid and avoid oversized decorative KPI cards.

## Insight section

- Introduce it with a heading so the page hierarchy remains `h1 → h2 → h3`.
- Empty charts use a dot-grid placeholder and a useful next step.
- Historical charts should never visually outrank the active timer.

## Responsive

- Under 1020px, stack Timer and Daily Pulse.
- At tablet width, Daily Pulse becomes a compact horizontal summary.
- At mobile width, return Daily Pulse to a two-by-two grid below the timer.
- The bottom nav must preserve Dashboard, Projects, History, Analytics, and More with visible labels.
