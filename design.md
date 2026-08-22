# parking-radar design direction

> Hallmark redesign record · 2026-08-22 · internal product dashboard

## Intent

parking-radar is an operational instrument, not a marketing landing page. The redesign keeps the dense parking and analytics workflow, but gives it a calm workbench rhythm: one clear status header, deliberate control surfaces, compact evidence cards, and charts that remain readable at 320px.

## Visual language

- Family: modern-minimal workbench with a restrained airport-orange signal accent.
- Canvas: warm neutral in light mode and deep blue-charcoal in dark mode.
- Surfaces: one raised level for primary panels; borders and spacing carry hierarchy instead of decorative gradients.
- Typography: Korean-friendly sans for labels and body copy; monospace only for timestamps and operational values.
- Shape: 16px panel corners, 10px controls, 1px borders, short purposeful status pills.
- Motion: transitions are limited to 160ms opacity/transform changes; `prefers-reduced-motion` removes nonessential motion.

## Tokens

The source of truth is `frontend/src/app/tokens.css`. Components consume semantic tokens through the existing CSS variables (`--bg`, `--surface`, `--ink`, `--line`, `--accent`) so the redesign can be applied without rewriting chart geometry. Colors use OKLCH tokens, not scattered hex values.

## Layout contract

1. Status header: title, freshness stamp, and collection action.
2. Control band: airport and lot selectors plus refresh action.
3. Current state: primary availability signal followed by desktop table or mobile cards.
4. Lazy analytics: history, daily overlay, weekday/holiday patterns, threshold evidence, and flight markers.
5. Operations footer: fee calculator and no-auth internal backup/restore tool.

Breakpoints are checked at 320, 375, 414, 768, and 1440 CSS pixels. Long tables scroll within their own surface; page-level horizontal overflow is clipped with `overflow-x: clip`.

## Interaction states

Every action exposes idle, hover, focus-visible, disabled/busy, success, and error feedback. Refresh and manual collection preserve the last known good dashboard while the next request is in flight. Backup restore accepts PostgreSQL custom-format `.dump` files only and displays the internal-network warning beside the action.

## Hallmark gate

The preflight audit is recorded in `docs/reports/hallmark-audit-2026-08-22.md`. The implementation gate is: no decorative gradient in the primary shell, no italic display headings, no generic hero CTA, no page-wide hidden overflow, no unbounded card grid, and no missing small-screen state. The final visual check must be run against the live service on 14.
