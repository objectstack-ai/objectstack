---
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(spec): liveness-ledger follow-through — `dashboard.widgets[].colorVariant` is `live`, and `field.widget`'s note names the widget that is actually stamped (#6774, #6773)

Two ledger records that stopped being answerable to reality after objectui
implementations landed. Both are corrections to the **evidence base**, not new
judgments: the legal-metadata set is byte-identical before and after, and no
schema acceptance test changed.

## `dashboard.widgets[].colorVariant` — `dead` → `live` (#6774)

The 2026-08-03 `dead` verdict was right when it was written: every read of
`widget.colorVariant` was an authoring surface, `DashboardRenderer` built the
metric component schema explicitly, and only `options.colorVariant` ever reached
`MetricWidget`. #5010 ruling B then resolved the enforce-or-remove the other way
— keep the declaration, objectui implements it — and objectui#3359 /
PR objectui#3799 (merge `c4c0ac897`) did exactly that: `DatasetWidget` resolves
the declared token through the accent table `MetricWidget` already shared. This
repo absorbed it with the `.objectui-sha` pin `09987b68`, whose ancestry over
that merge is re-verified in the row.

So the 16 authored sites — 7 in `packages/platform-objects`' `system_overview`,
9 across `examples/app-showcase` — now paint the accent they declare. A widget
that never authored the key, and the enum's own `default`, still resolve to no
class, so their markup is unchanged.

**What changes for an author.** The row drops `authorWarn`/`authorHint`, so
`os validate` (and any other `@objectstack/lint` consumer) no longer emits
`liveness-dead-property` telling you to move `colorVariant` under `options`. That
advisory would now be wrong twice over: the key works where it is declared, and
`options.colorVariant` is the slot that measured dead. PR #5255's pinned
"`colorVariant` still warns beside the four retired keys" positive contrast is
released with it — its premise was that no renderer reads the key.

The dashboard ledger now warns on nothing, which is the resolved state
`webhook` and `email_template` already sit in. `dashboard` stays registered in
the lint's `TYPE_COLLECTIONS` so a future regression that re-deadens a widget
key warns on its own, and the block's silence pins gained the anti-vacuity guard
#4651's area gates use — a lint that had stopped loading ledgers returns "no
findings" too.

## `field.widget` — the note named a widget nobody ever stamped (#6773)

The note offered `sys_permission_set (capability-multiselect)` as a worked
example of the override in use. That half was never true. ADR-0056 P1 stamps
`permission-facet-link` on all six `sys_permission_set` facets through a single
choke point, and `field:capability-multiselect` was registered only by objectui's
docs-site-only `registerFields()` — never by the live `registerAllFields()` walk
over `fieldWidgetMap` — so authoring it always fell through to the `type`
renderer. objectui#3308 / PR objectui#3793 then retired the name outright under
ADR-0049; at pin `09987b68` it survives only as tombstone comments and a
retirement pin test.

The verdict is untouched and was never at risk: `widget` is `live` on the
`sys_sharing_rule` trio alone (`object-ref` / `filter-condition` /
`recipient-picker`, all three re-checked in `fieldWidgetMap` at the same pin).
What was wrong was one example — false evidence in the base the next
enforce-or-remove audit reads, which is the #5175 lesson.

Nothing to migrate in either half: the schemas, the parsed shapes and the
runtime are unchanged — only the classification of what they already do, and the
evidence cited for it.
