// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20323 — ADR-0049 enforce-or-remove (triage record 5860351140, following the
// `ChartConfig.aria` retirement `2bf6ef18d`). The liveness ledger graded this
// key `live` on an uncited "PARTIAL — honored by a few objectui renderers"
// note, and no reader stood behind it: measured at the `.objectui-sha` pin
// `f8a9d0fb05`, none of the surfaces that render an action (`action:button`,
// `action:icon`, `action:menu`, `action:group`, `action:bar`, the grid's row
// and bulk action menus, `record:quick_actions`, the declared-actions bar)
// reads an action's `aria`. Every one of them derives the accessible name from
// the action's REQUIRED `label` — visible text, or `aria-label` on the
// icon-only renderer and the overflow trigger — and the node that PLACES the
// actions carries the node-level `ariaLabel` / `ariaDescribedBy` / `role`
// (`page.components[].aria`, the list view `aria`). A per-action block was a
// second spelling of both.
//
// `retiredKey()` on a `strictObject`, for the prescription (the
// `aria-carrier-tombstones.test.ts` family). Sources are rewritten by the D2
// conversion `action-aria-removed`; the D3 record is `action-aria-retired`.
//
// Registered under 18, not 17: the tombstone ships on the 17.x line
// (launch-window convention — accept-set narrowings ride minor releases) and
// the prescription lives at the major boundary where `migrate meta` users look.
export const entry = 'ui/Action:aria';
