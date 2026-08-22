# Hallmark audit — 2026-08-22

## Scope

Audited the current `frontend/src/app/globals.css`, `frontend/src/components/dashboard-screen.tsx`, and `frontend/src/components/dashboard-app.tsx` before the redesign. This is an in-place operational dashboard redesign; existing test IDs and data semantics remain contracts.

## Findings

### Critical

- The global stylesheet uses scattered raw colors and decorative gradients for primary actions and dark-mode controls. That makes the visual system difficult to tune and weakens contrast review.
- `html` and `body` use page-wide `overflow-x: hidden`, which masks layout defects and prevents a useful mobile overflow signal.
- The dashboard has no persistent token layer or explicit Hallmark stamp, so later changes can easily regress into one-off styles.

### Major

- The first load performs separate bootstrap requests and the airport endpoint performs one parking-lot query per airport. This is visible latency on a small ODROID deployment.
- Settings were persisted only in localStorage. Private browsing, storage policy, or a different device loses the last airport/lot choice.
- The operations workflow had no backup/restore affordance even though PostgreSQL requires an explicit dump lifecycle.
- The analytics surface can request six independent endpoints after entering the viewport. Database-backed analytics are now grouped into one lazy request; flight status remains isolated so a slow upstream does not block parking evidence.

### Minor

- The existing dashboard already had responsive table/card variants and lazy analytics, so those contracts are retained rather than replaced with a visually novel but behaviorally risky page.
- Dark mode repeats some literal colors in media-query overrides; the token layer becomes the preferred extension point.

## Redesign decisions

- Added semantic OKLCH tokens and workbench layout guidance in `design.md` and `frontend/src/app/tokens.css`.
- Replaced page-wide hidden overflow with `clip`, added explicit focus-visible treatment, and added backup panel styling.
- Kept the core signal hierarchy, data test IDs, and mobile/desktop split.
- Added `/dashboard/bootstrap` and `/dashboard/analytics` to reduce request fan-out and preserved flight timeout behavior as a separate request.

## Gate status

Preflight: pass with tracked findings. Implementation: in progress until the live 14 deployment is checked at 320/375/414/768/1440 widths. The reviewer must reject any regression that hides content, makes the primary status ambiguous, or exposes the no-auth backup tool outside the intended internal network.
