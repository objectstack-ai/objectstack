# Relationship Patterns

- [Relationship Types](#relationship-types)
- [Patterns](#patterns) — [lookup](#one-to-many-lookup) · [master_detail](#one-to-many-master_detail) · [Junction Object](#many-to-many-junction-object) · [tree](#hierarchical-tree-self-reference)
- [Delete Behaviors](#delete-behaviors) · [Roll-up Summaries](#roll-up-summaries)
- [Inline Editing (Master-Detail Entry)](#inline-editing-master-detail-entry) · [Detail-page related lists](#detail-page-related-lists-the-read-side-mirror)
- [Incorrect vs Correct](#incorrect-vs-correct)

## Relationship Types

| Type | Lifecycle | Required | Sharing | Roll-ups | Use Case |
|:-----|:----------|:---------|:--------|:---------|:---------|
| `lookup` | Independent | Optional by default | Independent | Supported via `summary` | "Related to" |
| `master_detail` | Coupled (cascade delete) | Forced only under `controlled_by_parent`, unless the optional master (below); else lint-warned | Inherits parent; read-on-master opt-ins (below) | Supported via `summary` | "Owned by" |
| `tree` | Self-reference | Optional — and so is `reference`, which when written must name this object itself; any other object is refused at parse, not lint-warned | N/A | Not available | Hierarchical |

## Patterns

### One-to-Many: lookup

```typescript
export default ObjectSchema.create({
  name: 'contact',
  sharingModel: 'public_read_write',
  fields: {
    first_name: { type: 'text', required: true },
    account_id: {
      type: 'lookup',
      reference: 'account',
      required: false,
    },
  }
});
```

### One-to-Many: master_detail

```typescript
// Parent: Invoice
export default ObjectSchema.create({
  name: 'invoice',
  sharingModel: 'public_read_write',
  fields: {
    invoice_number: { type: 'text', required: true },
    total: {
      type: 'summary',
      summaryOperations: {
        object: 'invoice_line_item',
        field: 'amount',
        function: 'sum',
      },
    },
  }
});

// Child: Line Item (owned by parent)
export default ObjectSchema.create({
  name: 'invoice_line_item',
  sharingModel: 'controlled_by_parent',
  fields: {
    invoice_id: {
      type: 'master_detail',
      reference: 'invoice',
      deleteBehavior: 'cascade',
      required: true,
    },
    product: { type: 'text', required: true },
    amount: { type: 'currency', required: true },
  }
});
```

#### Writes under `controlled_by_parent` — two opt-ins

A `controlled_by_parent` detail row naming a master inherits its access: reads are scoped
to accessible masters and, by default, **every write needs edit on the master**.
An opt-in on the detail asks *read* on it instead:

```typescript
sharingModel: 'controlled_by_parent',
sharing: { controlledByParent: { writeRequiresMasterRead: true } },  // or ownerMayEdit
```

- `ownerMayEdit: true` widens only the row owner's (`owner_id`) by-id update; every
  other write, on-behalf-of included, still needs master edit.
- `writeRequiresMasterRead: true`: whoever reads the master inserts, updates and
  deletes the detail under its own object permissions, RLS and FLS (re-points and
  each opted-in chain hop too; on-behalf-of, both users must read the master). The
  ownership floor (rows you created) still binds predicate and, for both users, on-behalf-of
  updates and deletes. Refused beside `ownerMayEdit: true`, which it covers. Lint
  `security-controlled-by-parent-owner-policy-without-opt-in` is silent here.

The detail's own row policies AND in under both. Each is refused at parse under any
other `sharingModel` and one level up (`sharing.KEY`).

#### Optional master — a detail row with no master

"A rep sees the contacts of the accounts they own; a contact need not have an
account": the detail's **only** `master_detail` declared `required: false`, never
an owner field copied by hooks:

```typescript
account: { type: 'master_detail', reference: 'account', required: false },
```

A row with no master is its owner's (`owner_id`): the owner or View All on the
detail reads it, the owner or Modify All writes it (no owner: View All / Modify
All only). An insert naming no master is admitted. Setting a master asks edit
on it, emptying one edit on the stored master (both even under `ownerMayEdit`;
read for both under `writeRequiresMasterRead`). A
chain hop with no master ends there under the same rule. Refused beside a
second `master_detail` or as `readonly`/`system`; `ObjectSchema.create()` reads
an omitted `required` as `true`.

**Import resolves a detail's name within its master** when the row sets that
master (one reference column to it) or the lookup's `dependsOn` sibling: a tie
there is `reference_ambiguous`, another master's detail `reference_not_found`.

### Many-to-Many: Junction Object

```typescript
export default ObjectSchema.create({
  name: 'project_assignment',
  sharingModel: 'public_read_write',
  fields: {
    project_id: {
      type: 'lookup',
      reference: 'project',
      required: true,
    },
    employee_id: {
      type: 'lookup',
      reference: 'employee',
      required: true,
    },
    role: { type: 'text' },
    hours_allocated: { type: 'number' },
  },
  indexes: [
    { fields: ['project_id', 'employee_id'], unique: 'organization' },
  ],
});
```

### Hierarchical: tree (Self-Reference)

```typescript
export default ObjectSchema.create({
  name: 'category',
  sharingModel: 'public_read',
  fields: {
    name: { type: 'text', required: true },
    parent_category: {
      type: 'tree',
      reference: 'category',
      required: false,
    },
  }
});
```

## Delete Behaviors

Configure `deleteBehavior` on `master_detail` — `cascade` or `restrict` **only**;
an authored `set_null` is refused at publish (it would orphan the detail row).

| Behavior | Effect | Use Case |
|:---------|:-------|:---------|
| `cascade` | Delete all child records | Invoice → Line Items |
| `restrict` | Prevent parent deletion if children exist | Department → Employees |

The walk also reads `lookup` and `tree` (`set_null` by default — the field is
cleared; a `multiple` field loses only that member — or an authored `cascade` /
`restrict`), and a `user` field only when it declares a value: deleting the user
then cascades, clears or refuses exactly as a `lookup` does; undeclared, the
field keeps the deleted user's id. `restrict`, and `set_null` on a `required`
field (a `multiple` one only when the removal would empty it), refuse the delete
with `409 DELETE_RESTRICTED`.

## Roll-up Summaries

A parent `summary` field aggregates a child collection. The engine recomputes it
**server-side** whenever a child is inserted/updated/deleted (inside the same
transaction as the write, so it's consistent).

```json
{
  "type": "summary",
  "summaryOperations": { "object": "invoice_line", "field": "amount", "function": "sum" }
}
```

`object` is the child object to aggregate, `field` its field (ignored for
`count`), `function` one of `count` / `sum` / `min` / `max` / `avg`. Optional:
`relationshipField` (auto-detected from the child's `master_detail`/`lookup`
field referencing this parent when omitted) and `filter` (below).

Empty collections roll up to `0` for `count`/`sum`, `null` for `min`/`max`/`avg`.

**Pick the function from the request's own words, and put every qualifier in
`filter`.** "how many" / "number of" → `count`; "total" / "sum" → `sum`;
"average" → `avg`. A qualified roll-up — "completed task count", "open ticket
count", any "done / pending / overdue / STATE" count or sum — carries that
condition in `filter` (a query `where` FilterCondition, ANDed with the
parent-FK match). Dropped, the field counts EVERY child and shows a plausible
wrong total that no check on the parent can see — worse than a visible 0. This
is also how one child feeds several totals: completed / in-progress / overdue
task counts are three `summary` fields over the same child, differing only in
`filter`. A select's value in `filter` is its option `value`, never its label;
operator and compound forms work
(`filter: { status: { $in: ['received', 'partial'] } }`). A **rate** (occupancy,
completion rate = a child count ÷ a capacity) is a `formula` over a working
`summary` — author the summary first; the rate computes only once it does.

**The recompute runs only on a child write.** A `summary` declared after its
parent rows exist reads `NULL` on every existing parent until a child of it is
written. The backfill is `os migrate summary-nulls --apply`
(`--recompute-undefined-on-empty OBJECT.FIELD` for a `min` / `max` / `avg`
declared late) — never an edit to a child. Declare the summary with the object
where you can; declared late, run the migration before you call the number ready.

**Never finish with `security-rollup-source-unreadable` standing.** The total
covers every child row and answers only to the parent field's own access, so
`os build` warns for each permission set that reads the summary but not the
child object, the aggregated field, or a field `filter` tests. Decide per set
from the request: it sees the children → grant the read; the total but not the
children → keep the column readable and add `rollupSourceUnreadableReason` to
the set's entry for it (the warning becomes a note quoting the reason; refused
blank or beside `readable: false`); neither → mask the summary on that set,
after removing any Modify All it holds on the parent (it overrides the mask).
Never add the reason to silence a total the request withholds: mask it.

A permission set (in TypeScript, the argument of `definePermissionSet(...)`)
with no `task` read — warned; `task_count` masked — resolved; `hours_total`,
which clients are meant to see, acknowledged — a note:

```json
{
  "name": "client_viewer",
  "objects": { "project": { "allowRead": true } },
  "fields": {
    "project.task_count": { "readable": false },
    "project.hours_total": { "readable": true, "rollupSourceUnreadableReason": "Clients see progress totals, not tasks" }
  }
}
```

## Inline Editing (Master-Detail Entry)

Declare inline editing **on the relationship**, in the data model — not in a form
view. Set `inlineEdit: true` on the child's `master_detail` (or `lookup`) field
that points back to the parent. The parent's **standard** create/edit form then
renders an editable grid for these children and saves parent + children in **one
atomic transaction**. A parent or child declaring `enable.apiMethods` must list
`'bulk'`, or that save is refused `405 OBJECT_API_METHOD_NOT_ALLOWED`.

```typescript
// On the CHILD object's FK field:
export default ObjectSchema.create({
  name: 'invoice_line',
  sharingModel: 'controlled_by_parent',
  fields: {
    invoice: {
      type: 'master_detail',
      reference: 'invoice',
      inlineEdit: true,            // ← edited inline within the Invoice form
      inlineTitle: 'Line Items',   // optional grid title
      // inlineColumns / inlineAmountField — optional overrides; columns are
      // otherwise derived from this object's fields.
    },
    quantity: { type: 'number' },
    amount:   { type: 'currency' },
  },
});
```

**Set `inlineEdit` only for true line-item / composition children** (invoice
lines, order items, expense lines) — the things a user enters *together with*
the parent. **Leave it off for associations** (comments, attachments, activity,
audit): those are also `master_detail` (cascade delete) but should NOT clutter
the parent's entry form — surface them as related lists on the detail page.

The rendering side, `subforms` overrides included: objectstack-ui → Master-Detail Forms.

#### Inline-edit form factor (`grid` vs `form`)

`inlineEdit` also picks how the children are entered:

```typescript
inlineEdit: true       // auto — pick grid/form from the child's shape (default)
inlineEdit: 'grid'     // editable line-item grid (fast bulk entry; thin children)
inlineEdit: 'form'     // read-only list; "Add" / per-row edit opens the FULL form
```

**`true`** / omitted — **smart default**: picks `form` when the child has
rich/form-only fields (textarea, file, image, json, location…) or more than ~8
editable fields, else `grid`. Set the string to override.

**Modeling a `'grid'` line item for the full editor.** The grid lights up extra
behaviors purely from how you model the child + parent:

```typescript
// Parent
Invoice = {
  fields: {
    tax_rate: Field.number({ label: 'Tax Rate (%)' }),          // → live Subtotal/Tax/Total stack
    total: Field.summary({ summaryOperations: {
      object: 'invoice_line', field: 'amount', function: 'sum' } }),
  },
}
// Child line
InvoiceLine = {
  fields: {
    invoice:  Field.masterDetail('invoice', { inlineEdit: 'grid' }),
    position: Field.number({ defaultValue: 0 }),
    product:  Field.lookup('product', { required: true }),
    description: Field.text(),
    quantity: Field.number({ required: true, defaultValue: 1 }),
    unit_price: Field.currency(),
    amount:   Field.currency({ expression: 'record.quantity * record.unit_price' }),
  },
}
```

- **Computed column** — a *stored* `currency`/`number` field with an `expression`
  renders read-only and recomputes live in the grid, then persists. Keep it
  stored (NOT a `formula` field) so the parent `summary` can roll it up; the
  engine computes it from the row the write stores, so a client-sent value
  never stands. It reads only that row: a related record's value
  (`record.product.unit_price`) keeps what it held at this row's last write
  (warning `stored-expression-cross-record-input`), so it stays a `formula`
  (read time, not totallable) or a snapshot a flow on the related object
  writes; repair a field left stored with `os migrate stored-expressions
  --object OBJECT --field FIELD --changed --apply`. The clock (`now()`,
  `today()`, `daysFromNow()`, `daysAgo()`), the acting user, `can()` and
  `hasCapability()` are fixed at the write (warning
  `stored-expression-volatile-input`): a `formula` keeps them current (the
  clock: a scheduled flow too).
- **Catalog auto-fill** — a `lookup` line field + sibling columns whose names
  match fields on the referenced record (e.g. `unit_price`, `description`) →
  picking a record fills those cells.
- **Sort field** — a numeric `position` / `sort_order` / `sequence` field is
  auto-detected, hidden from the grid, and stamped on drag-reorder.

### Detail-page related lists (the read-side mirror)

You usually don't declare the **related list** on the parent's record detail page: every child relationship
is shown **by default** — a `master_detail` child as a body table, a `lookup`
child as a panel. `inlineEdit` plays no part: it governs entry in the parent's
form only. The relationship flags *refine* that:

```typescript
project: {
  type: 'master_detail',
  reference: 'project',             // no relatedList: a body table
  relatedListTitle: 'Tasks',
  relatedListColumns: ['title', 'status', 'priority', 'due_date'],
},

// Suppress a noisy association from the detail page entirely:
audit_ref: { type: 'master_detail', reference: 'invoice', relatedList: false },
```

`relatedList` is tri-state — placement:

- `'primary'` — a full-width table in the record's detail body. Default for a `master_detail` FK.
- `false` — the child object is not shown on the parent record page.
- `true` — an auxiliary panel on the record page. Default for a `lookup` FK.
- Order is the parent's: `relatedLists: ['task', 'event.related_to']` (child, or
  `object.field`) lists those first. A child in the stack with no inbound FK is
  refused everywhere; one that exists nowhere is refused by `os validate` /
  `os build` (which leave a `sys_` / `cloud_` / `ai_` or sibling-artifact name
  to the runtime) and by a metadata write naming no package — a write into a
  package stores it, and the page places nothing.

`relatedListTitle` / `relatedListColumns` override the derived title / columns;
otherwise columns auto-derive from the child object's
`highlightFields`. Audit FKs
(`created_by`/`updated_by`/`owner_id`) never become related lists. A child that
references the parent through several FKs (e.g. `primary_account` +
`partner_account`) yields **one related list per FK**; a self-referential FK
(a hierarchy) surfaces a "children" list.

## Incorrect vs Correct

### ❌ Incorrect — Using lookup When master_detail is Needed

```typescript
export default ObjectSchema.create({
  name: 'invoice_line_item',
  fields: {
    invoice_id: {
      type: 'lookup',  // ❌ Child can exist without parent — use the master_detail pattern above
      reference: 'invoice',
    },
  }
});
```

### ❌ Incorrect — Native Many-to-Many

```typescript
{
  type: 'many_to_many',  // ❌ Not a valid field type — use a junction object
  reference: 'tag',
}
```

## Record owner, and other people on a record

Beyond `SKILL.md` § Relationship Patterns: a handler the request names apart
from the owner is a `user` field that grants no access, with a label
no other visible field carries, injected ones included: `owner_id` (Owner, 负责人),
`created_by` (创建人), `updated_by` (更新人), `created_at` (创建时间), `updated_at`
(更新时间). `ownership: 'none'` only for a shared catalog or a pure junction table.

A multi-value `lookup` is read as that array: reference its elements
positionally (`record.tags[0]` in a flow's CEL).
