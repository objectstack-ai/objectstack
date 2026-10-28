# ADR-0035: Config-driven master-detail (declare on the relationship, forms derive)

**Status**: Accepted · **Amended** (2026-10-28, [#27069](https://github.com/objectstack-ai/objectstack/issues/27069), maintainer rulings on that card: 「A」, an ordered list on the parent, and 「明细行的子表放在右侧合适嘛？」 / 「他如果做到放在基本信息下面，而条款和备注在后面」, line items in the record body) — `relatedList: 'primary'` is a **placement** (the record body, as a full-width table), no longer a prominence hint that orders lists; the order is the parent object's `relatedLists`; and an omitted `relatedList` on a `master_detail` FK that sets `inlineEdit` is now `'primary'` by default. See the note under the read-side table.
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
