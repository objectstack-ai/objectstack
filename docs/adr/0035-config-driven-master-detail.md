# ADR-0035: Config-driven master-detail (declare on the relationship, forms derive)

**Status**: Accepted
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
- **Read/view mode** is unaffected — inline editing applies to create/edit forms;
  detail pages use related lists.

## Status of implementation

Shipped and live-verified: spec `field.inlineEdit` (+ `inlineTitle`/
`inlineColumns`/`inlineAmountField`); column/FK derivation; `subforms` on
`ObjectFormSchema`/`FormViewSchema`; rendering in ObjectForm/ModalForm/DrawerForm/
RecordFormPage/ObjectView; `attachInlineSubforms`; server-side `summary` rollup;
atomic `/api/v1/batch` with `$ref`. Covered by unit tests and live browser e2e
(`e2e/live/master-detail.spec.ts`, `form-view-subforms.spec.ts`,
`summary-rollup.spec.ts`).
