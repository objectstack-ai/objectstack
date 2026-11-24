# ADR-0035: Config-driven master-detail (declare on the relationship, forms derive)

**Status**: Accepted · **Amended** (2026-10-28, [#27069](https://github.com/objectstack-ai/objectstack/issues/27069), maintainer rulings on that card: 「A」, an ordered list on the parent, and 「明细行的子表放在右侧合适嘛？」 / 「他如果做到放在基本信息下面，而条款和备注在后面」, line items in the record body) — `relatedList: 'primary'` is a **placement** (the record body, as a full-width table), no longer a prominence hint that orders lists; the order is the parent object's `relatedLists`; and an omitted `relatedList` on a `master_detail` FK that sets `inlineEdit` is now `'primary'` by default. See the note under the read-side table. · **Amended** (2026-11-19, [#35597](https://github.com/objectstack-ai/objectstack/issues/35597), under the record-page epic [#35590](https://github.com/objectstack-ai/objectstack/issues/35590), maintainer's words on that card: 「就是master-detail表类型的子表」 / 「主从的子表是否应该默认出现在概览的左侧区域？关键字段下面。」) — an omitted `relatedList` on ANY `master_detail` FK is `'primary'` (a body table) by default, `inlineEdit` or not; its totals are server-owned. See the second note under the read-side table. · **Amended** (2026-11-20, [#35889](https://github.com/objectstack-ai/objectstack/issues/35889), same epic, maintainer's words on that card: 「主从子表我认为不应该自动申明放在概览中，除非我通过 fieldGroup 强制指定」) — that default is withdrawn: an omitted `relatedList` on a `master_detail` FK is a tab, and the list is a body table (in the record page, the parent's forms and its edit state) only where a parent field group names it, and `inlineEdit` no longer inlines a child in the form by itself. See the third note under the read-side table. · **Amended** (2026-11-20, [#35897](https://github.com/objectstack-ai/objectstack/issues/35897) and [#35899](https://github.com/objectstack-ai/objectstack/issues/35899), epic [#35896](https://github.com/objectstack-ai/objectstack/issues/35896), maintainer's words: 「其实除了 overview，我们直接用 relatedLists 是不是就可以。」 / 「三个内置项，是不是可以直接用对应的对象名」) — a declared `relatedLists` is the record page's tab list (unlisted side lists show no tab), with the attachments, approvals and activity-stream tabs placed by object name and an entry's own title and columns. See the fourth note under the read-side table.
**Author**: surfaced while making master-detail (parent + child line-item) entry a first-class, low-config capability
**Affects**: `@objectstack/spec` (field schema), `@object-ui/plugin-form`, `@object-ui/plugin-view`, `@object-ui/app-shell`; builds on ADR-0034 (atomic multi-write) and the cross-object batch endpoint (#1604)

---

## TL;DR

Entering a record together with its child line items (invoice + lines, project +
tasks) must **not** require a hand-authored page or a per-form columns block. The
structure is already declared in the data model — a child's `master_detail`
relationship to its parent. So the **inline-editing intent belongs on the
relationship too**: set `inlineEdit: true` on the child's FK field, and every
standard create/edit form for the parent auto-renders an atomic master-detail
form. Forms **derive** the UI from metadata; they don't re-declare it.

---

## Context

Master-detail is one of the most common enterprise entry patterns. The naive
implementations force authors to either (a) build a custom page that composes a
form + an editable grid, or (b) hand-write the child columns in every form. Both
duplicate information that already lives in the metadata (the relationship, the
child's fields) and don't scale to an AI-authored platform, where the generator
should target a small, semantic vocabulary — not bespoke UI.

Two facts make derivation possible:

- The child→parent link is a `master_detail` field whose `reference` is the
  parent (ownership + cascade already implied).
- The child object's fields fully describe the editable grid columns.

What was missing was (1) a place to declare *intent* ("edit these inline"),
(2) runtime plumbing to persist parent + children atomically, and (3) the
derivation that turns the relationship into a rendered, editable grid.

## Decision

**Intent lives in the data model; the UI is derived; forms just follow.**

```
relationship inlineEdit (data model)  ──derive──▶  every standard form renders
                                                    an atomic master-detail form
```

### The layered surface (most → least automatic)

| Layer | Where | When |
|---|---|---|
| **Relationship `inlineEdit`** | child `master_detail` field | default; zero view/page config |
| **Form view `subforms`** | object form view | override derived columns/order, or expose a non-`inlineEdit` child |
| **`object-master-detail-form`** | page block | bespoke/free-form layouts |

All three converge on the same runtime: `MasterDetailForm`, which renders the
parent's fields + an editable child grid per collection and persists everything
through the transactional batch.

### Derivation rules

- **Relationship FK**: the child field of type `master_detail`/`lookup` whose
  `reference` is the parent (master_detail preferred). Auto-detected; override
  with `relationshipField`.
- **Grid columns**: the child object's fields, skipping system/audit fields, the
  back-reference FK, and non-editable types (formula/summary/autonumber/file/
  json/…); select options and lookup references carry through. Override with
  `columns` / `inlineColumns`.
- **Running total**: first numeric/currency column; override with `amountField` /
  `inlineAmountField`.
- **Only `inlineEdit` children are inlined.** `master_detail` ≠ "show in the
  entry form": comments, attachments, audit, activity are commonly
  `master_detail` (cascade delete) but are associations, not line items, and
  must stay out of the parent's create form (surface as related lists).

### Read-side mirror: detail-page related lists

Inline editing is the **write** side — the child pulled *into* the parent's
entry form. Its read-side counterpart is the **related list** on the parent's
record detail page. Both intents live on the same relationship:

| Side | Flag (on the child's FK field) | Effect |
|---|---|---|
| Write | `inlineEdit: true` | child rendered as an editable grid inside the parent's create/edit form (atomic save) |
| Read | `relatedList: boolean \| 'primary'` (+ `relatedListTitle` / `relatedListColumns`) | child rendered as a related list on the parent's detail page; `'primary'` promotes it to its own tab |

Related lists are **shown by default** for every child relationship
(`master_detail` and `lookup`) — owned (`master_detail`) children are ordered
first. `relatedList` is tri-state (a *prominence* hint, not a layout switch —
see ADR-0085): `false` suppresses a noisy association/audit link; `true` /
omitted shows the child under a single shared **Related** tab; `'primary'`
promotes the relationship to its **own tab** on the detail page. `relatedListTitle` /
`relatedListColumns` override the derived title / columns — both optional, with
columns auto-deriving from the child object's `highlightFields` when omitted.
Audit FKs (`created_by` / `updated_by` / `owner_id`) are skipped; a child that
references the parent through several FKs yields **one related list per FK**, and
a self-referential FK surfaces a "children" list.

> **Amended (2026-10-28, #27069).** Two sentences of the paragraph above no
> longer hold. (1) "`true` / omitted shows the child under a single shared
> **Related** tab": an omitted `relatedList` on a `master_detail` FK that sets
> `inlineEdit` (any arm, `true` / `'grid'` / `'form'`) is `'primary'` by
> default, because line items the parent's form edits inline belong in the
> record body (the maintainer's ruling on the card); `relatedList: true` on
> that FK keeps the shared Related tab. On every other FK, omitted still means
> the shared Related tab. (2) "a *prominence* hint, not a layout switch":
> `'primary'` now says WHERE a list is drawn, in the record's body as a
> full-width table rather than as a side card, which on today's tabbed record
> page is still its own tab. It no longer orders lists. The order of a record
> page's related lists is the parent object's `relatedLists` (an ordered list
> of child object names, or `object.field` for one FK); unlisted lists follow
> in the derived order described above (owned first). `false` still
> suppresses a list whatever `relatedLists` says. The read-side table's
> "`'primary'` promotes it to its own tab" stays true on the tabbed page.

> **Amended (2026-11-19, #35597; epic #35590).** Clause (1) of the note above,
> and ruling B on #27055 as #27478 implemented it (the one body-table predicate,
> `isBodyTableRelationship` in `@objectstack/spec/data`), required `inlineEdit`
> on the `master_detail` FK. They no longer do: an omitted `relatedList` on a
> `master_detail` FK is `'primary'` by default whether or not the FK sets
> `inlineEdit`, because a master-detail child is the parent's own rows (the
> maintainer on #35597: 「就是master-detail表类型的子表」). `relatedList: true`
> keeps it a side list (the related column and the related tab), `false` hides
> it, `'primary'` is unchanged, and an omitted `relatedList` on a `lookup` FK
> is still a side list. The predicate stays the one judgement every reader
> follows (the record page, Studio, and the field-group refusal at
> `defineStack` and the publish door). On the record page such a table sits in
> the overview's details column under the header strip and above the field
> sections, in the parent's `relatedLists` order (a field group whose
> `relatedList` names it still places it among the field sections instead,
> and with no field section at all the details node leads and the tables
> follow it), is drawn even when empty, and its totals line is the server's
> (a parent `summary` roll-up when one sums that column over the same rows,
> otherwise an aggregate over all the child rows by the list's own
> condition), never a sum of the rows on show. "Only `inlineEdit` children
> are inlined" (Decision → Derivation rules) is the WRITE side (the parent's
> create/edit form) and is unchanged: a master-detail child that does not set
> `inlineEdit` is a body table on the record page and stays out of the
> parent's form.

> **Amended (2026-11-20, #35889; epic #35590).** The default of the note above
> is withdrawn; the rest of it stands. An omitted `relatedList` on a
> `master_detail` FK is a TAB of the parent's record page (with its count), as
> on a `lookup` FK, `inlineEdit` or not (the maintainer on #35889:
> 「主从子表我认为不应该自动申明放在概览中，除非我通过 fieldGroup 强制指定」,
> 「我们已经开发好的功能也没必要作废」). Such a list becomes a body table only
> where a field group of the PARENT names it (`fieldGroups[].relatedList`, a
> child object name or `object.field`): the record page draws it at that
> group's position, the parent's create and edit forms inline it, and the
> record page's Edit saves the record fields and its rows in one batch
> (#35599); its tab stays on the tab row (on a record page whose object
> declares no `relatedLists`: a declared one decides the tabs, see the next
> note). `relatedList: 'primary'` on the FK
> still makes a body table with no group (and no tab, positioned by a group or not), `true` keeps a tab that no group can
> place, and `false` hides it. The set a field group may name is unchanged
> (`isGroupPlaceableRelationship`, read by the refusal at `defineStack` and at
> the publish door); `isBodyTableRelationship` is still the one body-table
> judgement, now told whether a parent group places the list. The WRITE side
> follows the same group (maintainer ruling B on #35889,
> 「明细表应该改成指看分组的定义了」): "Only `inlineEdit` children are inlined"
> (Decision → Derivation rules) no longer holds. The parent's form, as derived
> from its relationships, inlines a child exactly where a parent field group
> names it (a form view that declares its own subforms still inlines what it
> declares); `inlineEdit` on the FK no longer inlines a child by itself and
> only picks the form factor of a placed one (`'grid'`, `'form'`, or the
> shape-picked default), placed in the form below the record's fields until
> the form places it at the group. A group may name only a list it can place,
> so an `inlineEdit` child on a `lookup` FK, or on a FK declaring
> `relatedList: true`, needs `relatedList: 'primary'` on its FK as well as the
> group (a `master_detail` FK may instead drop `relatedList: true`); a group
> naming a list its FK hides (`false`) is refused.

> **Amended (2026-11-20, #35897 and #35899; epic #35896).** The sentence
> "unlisted lists follow in the derived order described above (owned first)"
> of the 2026-10-28 note no longer holds for a DECLARED `relatedLists`: that
> list is now the record page's tab list (the maintainer on the epic:
> 「删除tab就是不现实」, meaning removing a tab is not showing it; 「其实除了
> overview，我们直接用 relatedLists 是不是就可以」). A side list no entry names
> shows no tab; the listed ones show in the listed order. That includes a child
> list another package adds: it is hidden until the parent names it, and a build
> accepts that name only when the package is in the parent's stack (an extension
> package placing its own list is the epic's child card #35901). The record page's
> three built-in tabs are entries too, by the platform object each draws
> (「三个内置项，是不是可以直接用对应的对象名」): `sys_attachment` (shown only
> when listed, and still only with `enable.files`), `sys_approval_request`
> (when unlisted it follows the listed tabs, and still only on a record with
> requests) and `sys_activity` (the one stream; when unlisted it closes the
> strip). An entry may be `{ list, label, columns }`, giving that list its
> title and columns on the parent; they win over the FK's `relatedListTitle` /
> `relatedListColumns` wherever the list is drawn. Unchanged: an undeclared or
> empty `relatedLists` shows every list in the derived order; `false` still
> suppresses a list whatever `relatedLists` says; body tables are placed by
> the field groups, not hidden by this list. A `master_detail` list that a
> field group places keeps its tab (the note above) only while `relatedLists`
> is undeclared: once it is declared, that list shows a tab only if an entry
> names it, and its body table stays at its group. See
> [ADR-0085](./0085-object-semantic-roles-over-surface-hint-blocks.md)'s note
> of the same date.

> **Note (2026-11-21, #35889, second slice).** The entry form now draws a
> placed child where the record page does, so "placed in the form below the
> record's fields until the form places it at the group" above is superseded.
> A form laid out from the parent's field groups draws the child's table
> after the sections of the groups declared before the placing group and
> before those declared after it; a tabbed form gives it a tab of its own at
> that position, labelled with the group's label (a wizard master-detail form
> is drawn as the simple form, as before). A form whose sections name no
> declared field group, and a child no group places (a form view's own
> subforms), keep the table below the record's fields. The table is the same
> one: it still saves with the record in one batch, and the document totals
> stay at the foot of the form.

The derivation is a pure function — `deriveRelatedLists(objectDef, objects)` in
`@object-ui/app-shell` (`utils/deriveRelatedLists.ts`) — the read-side analogue
of `attachInlineSubforms`. `RecordDetailView` feeds its output into the
synthesized page's `record:related_list` renderers (and the legacy
`DetailView.related`), so both render paths surface the same relationship-derived
lists with no page config. Per-object coarse switches
(`detail.showReferenceRail` / `hideReferenceRail` / `hideRelatedTab`) still
apply on top.

### Runtime backbone (relied upon, not re-litigated here)

- **Atomic write**: parent + children in one `POST /api/v1/batch`; intra-batch
  `{ $ref: <opIndex> }` resolves a child FK to the parent created earlier in the
  same transaction. Edit mode diffs children into create/update/delete ops.
  (Depends on ADR-0034's ambient transaction.)
- **Server-side rollup**: a parent `summary` field is recomputed by the engine
  when children change, inside the same transaction — totals are server-owned,
  not summed on the client.

### Where derivation is wired (objectui)

`MetadataProvider.attachInlineSubforms` scans objects for `inlineEdit`
relationships and merges the resulting child collections into each parent's form
view as `subforms`. Because every form host — the create/edit modal
(`AppContent` → `ModalForm`), `DrawerForm`, full-page `RecordFormPage`, and
`ObjectView`'s own form — already reads `form.subforms`, they all render the
master-detail form for free. `ModalForm`/`DrawerForm` host the master-detail form
inside their envelope and suppress their own footer (the form owns its Save).

## Consequences

- **For authors / AI generators**: master-detail is a one-line modeling decision
  (`inlineEdit: true`) made where the schema is defined — not a UI task. The skills
  (`objectstack-data` → Relationships → Inline Editing; `objectstack-ui` →
  Master-Detail Forms) document the convention.
- **Single source of truth**: relationship + child metadata drive the UI; changing
  a child field updates every parent form. Skins/form types/apps stay consistent.
- **Safe by default**: opt-in per relationship avoids inlining associations.
- **Escape hatches preserved**: `subforms` (view) overrides; a page block handles
  bespoke layouts; explicit `relationshipField`/`columns` override derivation.
- **Read/view mode mirrors the write side** — inline editing applies to
  create/edit forms; the parent's detail page auto-derives related lists from the
  same relationships (`relatedList` opt-out + `relatedListTitle`/`relatedListColumns`
  overrides). No detail-page config for the common case.

## Status of implementation

Shipped and live-verified: spec `field.inlineEdit` (+ `inlineTitle`/
`inlineColumns`/`inlineAmountField`); column/FK derivation; `subforms` on
`ObjectFormSchema`/`FormViewSchema`; rendering in ObjectForm/ModalForm/DrawerForm/
RecordFormPage/ObjectView; `attachInlineSubforms`; server-side `summary` rollup;
atomic `/api/v1/batch` with `$ref`. Covered by unit tests and live browser e2e
(`e2e/live/master-detail.spec.ts`, `form-view-subforms.spec.ts`,
`summary-rollup.spec.ts`).

Read-side mirror shipped: spec `field.relatedList` (+ `relatedListTitle`/
`relatedListColumns`); `deriveRelatedLists` pure helper (unit-tested) wired into
`RecordDetailView` for both the synthesized and legacy detail paths; showcase
demonstrates a zero-config Projects related list on the Account detail page.
