// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #17260 — ADR-0049 enforce-or-remove, executing the objectui#8285
// director-seat ruling (comment 5583979207, decision batch #91, 2026-09-08,
// standing maintainer delegation): ruled option B — `quickAdd` is retired from
// the `object-kanban` board and stays only on the `kanban-ui` block, where a
// React host can supply the runtime function the control needs.
// The board FORWARDED the key but never honoured it: measured at the
// `.objectui-sha` pin `53ded82bf`, `ObjectKanban.tsx:931` spreads the authored
// bag into `KanbanRenderer` (`plugin-kanban/src/index.tsx:196` passes both
// `quickAdd` and `onQuickAdd`), and `KanbanImpl` gates the affordance on BOTH
// (`:355`, `:368`) — while `onQuickAdd` is a host-supplied FUNCTION that JSON
// cannot carry and no producer puts on an `object-kanban` node
// (`ObjectKanban.tsx` names neither half: 0 each, against 6 for the sibling
// `onCardClick` in the same file). The drop was not silent, which is the sharp
// edge: objectui's html tier reported the published key as `unknown-prop` —
// the SAME diagnostic a typo gets — and its registry-spec ledger records it as
// `ESCALATED (object-kanban.quickAdd — measured NOT honoured)`, so the author
// met a tool contradicting the contract with no way to tell which side was
// wrong. Tombstoned with `retiredKey()` in `ObjectKanbanPropsSchema` (the
// surface baseline line carries `[RETIRED]`); sources are stripped by the D2
// conversion `object-kanban-quick-add-removed`, a pure lossless delete scoped
// by component `type` so the LIVE `kanban-ui` spelling is untouched.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look — the `ui/ObjectGridProps:defaultSort`
// precedent one entry over.
export const entry = 'ui/ObjectKanbanProps:quickAdd';
