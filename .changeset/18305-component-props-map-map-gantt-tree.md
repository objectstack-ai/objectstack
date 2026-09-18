---
"@objectstack/spec": minor
---

`ComponentPropsMap` declares `object-map`, `object-gantt` and `object-tree` — the three object-bound SDUI blocks #7751 enumerated past — with each row's key set derived from the objectui renderer's own read points (#18305).

**Clause-②: yes (widening)** — three new declared rows on a published surface, so the accept set a consumer writes against grows. Nothing previously admitted is refused, and nothing is retired. Contract-review tier.

Until now the `object-*` family carried six rows, `object-chart` carried a written note saying its key set is not derivable with this section's confidence, and these three carried neither: they were not ruled out, they were never measured. The cost was the one #7751 exists to remove — the `@objectstack/lint` props gate had no schema to dispatch on, so every authored key inside `properties` on one of these nodes parsed clean, stored, shipped and was ignored by the renderer with a success receipt. It also left objectui's own `@object-ui/types` mirror standing in as the authority for `object-map.data` and `object-gantt.data`, and left `object-tree`'s record-source read undeclared on every published face (objectui#8348, PR objectui#9234). Executing the ruling 「8348 以协议为准」 (decision batch #83, 2026-09-08) and batch #136 item 3 (Q1-C).

Key sets measured from `plugin-map/src/ObjectMap.tsx`, `plugin-gantt/src/ObjectGantt.tsx` and `plugin-tree/src/ObjectTree.tsx` at the `.objectui-sha` pin `53ded82b`, with per-key read-point citations in each schema's header:

- **`object-map`** — `objectName`, `data`, `staticData`, `filter`, `sort`, `map`, `mapStyle`, `navigation`, `enableClustering`.
- **`object-gantt`** — the same record-source and query keys, plus `gantt`, `navigation`, `label`, `skipWeekends`, `holidays`, `persistLayout`, `viewName`, `markers`, `criticalPath`, `showBaselines`, `readOnly`, `mobileReadOnly`.
- **`object-tree`** — `objectName`, `data`, `staticData`, `filter`, `tree`, `navigation`. No `sort`: this renderer's fetch carries `$filter`, `$top` and `$expand` and no `$orderby`, so a `sort` door here would publish a key with no read site.

Three things the derivation decided rather than assumed, each pinned:

- **`data` is the `ViewData` object arm on all three**, because rung 1 of the shared record-source ladder returns the authored value verbatim as a `ViewData`. For map and gantt that agrees with objectui's mirror — verified from the read points first and read back as a check, never as the source. For **`object-tree` it does not**: the mirror declares no `data`, no `staticData`, no `filter` and no `navigation` at all, while the renderer reads all four (`data` on two sites). The row follows the read points, which is what 「以协议为准」 resolving for this block means.
- **The flat top-level config spellings stay unauthorable.** `ObjectView` / `ListView` build these nodes by spreading `options.map` / `options.gantt` / `options.tree`'s CONTENTS at the top level; that is an internal transport form, not a second authoring surface (maintainer ruling objectui#5018, 2026-08-17, inherited by objectui#6469). Writing one now gets a wrong-layer prescription naming the config block instead of a bare unknown-key refusal — the channel `object-calendar` already uses for its own flat field spellings.
- **`filter` and `sort` are the family's one orthography from birth** — `ViewFilterRule[]` and `SortItem[]`, not the `z.unknown()` the original six carried before #15449 and objectui#8221 pulled them back.

Nothing about the parse of a page changes: `PageComponentSchema.type` already accepted all three through its open string arm, and it still does. What changes is that an authored props bag on one of them is now judged instead of skipped.
