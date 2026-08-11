# TimeFarm Design System

> Global source of truth for the TimeFarm desktop experience. Page-specific files in `pages/` override this document only where explicitly noted.

## Product direction

TimeFarm is a local-first desktop productivity and earnings application. Its interface should feel like a calm mission-control surface: focused enough for an active work session, trustworthy enough for financial data, and quiet enough to remain open all day.

The visual system combines:

- Linear-style calm hierarchy and low-noise navigation.
- Rize-style separation between “today” and historical analysis.
- Toggl-style one-action timer access.
- Stripe-style financial clarity and explicit data context.
- Raycast-style compact desktop ergonomics.

## Core principles

1. Today before history: the current timer and today's pulse lead the dashboard.
2. One clear primary action per surface; do not repeat the same CTA across header, sidebar, and content.
3. Data needs context: values include timeframe, unit, currency, or completion state.
4. Empty states explain the next useful action instead of drawing meaningless zero charts.
5. Dark mode is OLED-friendly; light mode is softly tinted rather than pure gray.
6. Use Lucide icons consistently. Stored legacy project glyphs are rendered through Lucide equivalents.
7. Motion is limited to responsive micro-interactions and must respect reduced-motion preferences.

## Color tokens

### Light

| Role | Value |
|---|---|
| Background | `#EDF2F1` |
| Surface | `#FBFDFC` |
| Surface muted | `#F1F5F4` |
| Text | `#12201F` |
| Muted text | `#5D716E` |
| Border | `#D9E3E0` |
| Primary | `#0F9889` |
| Primary strong | `#087F73` |
| Positive | `#0D9B6E` |
| Danger | `#D84C62` |

### Dark

| Role | Value |
|---|---|
| Background | `#07100F` |
| Surface | `#101A19` |
| Surface muted | `#152321` |
| Text | `#EDF8F6` |
| Muted text | `#93A8A4` |
| Border | `#223331` |
| Primary | `#45D6C3` |
| Primary strong | `#6EE7D6` |
| Positive | `#4ADEA7` |
| Danger | `#FF7789` |

The active timer uses a deep teal grid surface. Lime `#D5FF7D` is reserved for its primary Start action so it remains instantly identifiable.

## Typography

- Family: `Segoe UI Variable`, `Segoe UI`, `Inter`, system sans-serif.
- Display headings: 700–720 weight, tight negative letter spacing.
- Body: 13–14px desktop, never below 12px for meaningful secondary text.
- Eyebrows: 9.5px uppercase, 1.38px tracking, primary teal.
- Numeric timer: 34–54px with tabular visual rhythm.
- Do not load remote fonts; TimeFarm must remain visually reliable offline.

## Spacing and shape

- Base spacing rhythm: 4, 8, 12, 16, 24, 32px.
- Application inset: 11px desktop.
- Main shell and sidebar radius: 21px.
- Primary cards: 19–23px.
- Controls: 10–12px.
- Mobile touch controls: 40px minimum, 44px for primary actions where space permits.

## Shell and navigation

- Desktop uses an inset sidebar and inset content surface.
- Navigation is split into Workspace and Personal groups.
- Active navigation uses a teal rail, a quiet tinted fill, and `aria-current="page"`.
- At tablet width the sidebar collapses to an icon rail.
- At mobile width use four labeled primary tabs plus More; Profile and Settings live in the More popover.
- A skip-navigation link must remain available to keyboard users.

## Components

### Buttons

- Primary: teal gradient, dark text, one per decision point.
- Active-timer Start: lime on deep teal.
- Secondary: visible border and surface-matched fill.
- Destructive: pink/red with explicit wording.
- Hover changes color, border, or shadow without layout-shifting scale/translation.

### Cards

- Surfaces use visible borders in both themes and restrained shadows.
- Non-interactive cards must not imply clickability through large movement on hover.
- Bento sizing uses 12 columns: large 8, medium 4, small 4 on wide desktop.

### Charts

- Trends use line/area treatment with about 20% fill opacity.
- Every SVG gradient ID is unique.
- Charts provide a localized accessible label, title, and description.
- All-zero ranges render an explanatory empty state rather than a flat zero line.
- Category comparisons use labeled horizontal bars.

### Forms and modals

- Every field has a visible label.
- Inputs are at least 43px tall and show a clear focus ring.
- Modals use a blurred overlay, a focused surface, keyboard trapping, Escape close where safe, and focus restoration.

## Responsive contract

- 1440px: full sidebar, 8/4 dashboard command grid, 12-column bento layout.
- 1024px: command grid may stack; insight widgets use two columns.
- 768px: icon rail, stacked command surface, compact daily pulse.
- 375px: bottom navigation, one-column content, two-column daily KPIs, no horizontal scrolling.

## Accessibility and interaction checklist

- Text contrast meets WCAG AA in both themes.
- Focus-visible remains obvious for buttons, fields, and navigation.
- Navigation, modal, chart, filter, and search controls have localized accessible names.
- Color is never the only state indicator; labels and icons accompany it.
- `prefers-reduced-motion` disables nonessential movement.
- No fixed navigation obscures page content.
- Do not hide meaningful session content on mobile merely to make it fit.

## Avoid

- Purple-only generic SaaS styling.
- Handwritten fonts in analytics or financial contexts.
- Three or more repeated Start buttons in one viewport.
- A wall of equal-weight charts.
- Flat zero-value charts.
- Text below 12px for essential information.
- False affordances, decorative buttons, or controls without actions.
- Horizontal scroll journeys inside the desktop application.
