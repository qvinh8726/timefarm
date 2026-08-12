# TimeFarm brand specification

## Source assets

- Primary official raster asset: `assets/timefarm-avatar.png` (1254×1254).
  It contains the white cat mascot, pale blue plaid scarf, snow/asterisk motifs,
  and the TimeFarm wordmark.
- Windows icon: `assets/timefarm-avatar.ico` (256×256).
- Existing UI source of truth: `design-system/timefarm/MASTER.md`.
- Current rendered baseline: `docs/design-exploration/baseline-current.png`.

The mascot is official and must be preserved without redrawing or restyling.
Use it selectively on authentication, onboarding, recovery, About/Profile, or
an occasional empty state. It must not dominate analytics, financial tables, or
the active work surface.

## Brand character

Calm, precise, trustworthy, warm enough to remain human, and desktop-native.
TimeFarm is a work instrument, not an AI dashboard template or playful mobile
game. Its personality comes from focused timing, honest money context, and the
quiet winter-cat asset—not decorative gradients or mascot repetition.

## Color derivation

The established product system and official asset are both authoritative but
serve different roles:

- Utility teal: `#0F9889` light / `#45D6C3` dark. This is the primary UI state,
  focus, selection, and data accent.
- Start lime: `#D5FF7D`. Reserved for the timer's Start/Continue decision; never
  used as general decoration.
- Brand ink: approximately `#30436B`, sampled from the mascot/wordmark outline.
- Scarf blue: approximately `#8EA9D2`, sampled from the official scarf.
- Frost: approximately `#E8F5F7`, sampled from the mascot background.
- Semantic positive/danger remain green and rose, always paired with text/icon.

Color rationale: teal keeps the existing product's live-work signal, while the
mascot navy/blue appears only in branded or human moments. This avoids forcing
the soft blue illustration into dense operational data.

## Typography

- UI and body: `Segoe UI Variable`, `Segoe UI`, system sans-serif.
- Optional instrument/data labels: `Cascadia Mono`, `Consolas`, monospace.
- No remote fonts. No display font may reduce scan speed in timers, money, or
  analytics.
- Meaningful text is at least 12px; normal body/control text is 13–15px.
- Timer and financial numbers use tabular figures.

## Shapes and surfaces

- Prefer open rails, lists, tables, data bands, and one strong timer frame.
- Avoid a rounded card around every metric. Radius is 6–12px for controls and
  purposeful panels; the timer may use one larger signature enclosure.
- Borders are crisp hairlines with restrained elevation. No glassmorphism,
  generic glow, or excessive shadow.
- Iconography is Lucide with consistent 1.75–2px strokes. No emoji icons.

## Motion

- 120–180ms state transitions; opacity/color/indicator movement only.
- A single orchestrated load/reveal is allowed. No floating widgets or constant
  decorative motion.
- Timer ticks never cause layout shift. Reduced-motion removes nonessential
  transitions.

## Prohibited treatments

- Purple/blue AI gradients, bokeh/orbs, glass panels, neon grids.
- Mascot-heavy dashboard chrome.
- Equal-weight card walls, giant marketing hero sections, excessive pills.
- Essential labels below 12px, decorative fake metrics, emoji controls.
- Changing the official mascot, wordmark lettering, or scarf colors.
