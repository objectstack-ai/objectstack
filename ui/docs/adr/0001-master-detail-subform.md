# ADR-0001: Master-Detail Subform (parent + line items, entered and viewed together)

**Status**: Accepted — implementing (2026-06-05)
**Author**: ObjectUI renderer team
**Consumers**: `@object-ui/fields`, `@object-ui/plugin-form`, `@object-ui/plugin-detail`, every app that ships a header→lines object pair (expense claim + lines, purchase order + lines, contract + obligations, order + items, …)

---

## TL;DR

ObjectStack apps constantly model a **parent record with a set of child line
items** — an expense claim with expense lines, a purchase order with order
lines, an invoice with invoice items. Users expect to **enter the header and
its lines in one screen**, and to **see (and inline-edit) the lines on the
record page**.

Today the ObjectUI renderer cannot do this. The protocol already expresses the
relationship (`master_detail` field with `deleteBehavior: 'cascade'`), but the
renderer is missing the UI primitive:

- `GridField` is a **read-only stub** (shows `"N rows"` in edit mode).
- There is **no editable child-grid / subform** component.
- `dataSource.create()` writes a **single object**; there is no parent+children
  transactional create, and the backend exposes **no `/batch` endpoint**
  (verified: `POST /api/v1/batch` → 404).
- `RelatedList` (detail page) is **read-only** — no inline create/edit.

This ADR introduces a **master-detail subform** capability, entirely
**renderer-side** (no protocol change):

1. **`LineItemsField`** — a controlled, editable child-grid widget (array of
   row objects; per-cell field widgets; add/delete/edit; running total).
2. **`MasterDetailForm`** — composes parent fields + `LineItemsField` and
   orchestrates a **client-side transactional create**: create parent → set FK
   on each child → bulk-create children → roll the line total up onto the
   parent. Best-effort rollback if children fail.
3. **`record:line_items`** — the same grid bound to an **existing** parent on a
   record/detail page (loads children by FK and persists inline edits
   immediately).

---

## Context

### The requirement (from the user)

> 录入报销单的时候需要同时录入明细，查看的时候也是这样。
> ("When entering an expense claim I need to enter the line items at the same
> time, and view them the same way.")

This is the canonical **master-detail** (a.k.a. header/lines) pattern. It is
not specific to expenses — `../templates` and `../hotcrm` are full of it:

| App | Parent | Child | Modeling today |
| --- | --- | --- | --- |
| expense (templates) | `expense_report` | `expense_line` | FK lookup, **two-step** entry (create report, navigate to add lines) |
| expense (live backend) | `expense_claim` | `expense_line` | **`master_detail`** FK (`deleteBehavior: cascade`) |
| procurement | `procurement_order` | lines | **JSON array** on the parent (no per-line query) |
| contracts | `contracts_contract` | `contracts_obligation` | FK lookup, separate forms |

The templates resort to two workarounds, both documented in their own source as
compromises: **(a)** a separate child object with a FK, entered on its own form
and shown as a read-only related list; or **(b)** a `Field.json()` array on the
parent, edited as raw JSON. Neither delivers "enter header + lines together".

### What the protocol already supports (no change needed)

`@objectstack/spec` `data/field.zod.ts` defines `master_detail` as a first-class
field type with cascade semantics:

```
'lookup', 'master_detail',  // Dynamic reference
...
// For `master_detail` fields, the parent record controls the lifecycle of
// child records (e.g., cascade delete).
deleteBehavior: 'set_null' | 'cascade' | 'restrict'   // default 'set_null'
Field.masterDetail(reference, config)  // → { type: 'master_detail', ... }
```

`ui/view.zod.ts` even references a `master-detail` widget and `split`
(master-detail) form/list layouts. **The gap is the renderer, not the
protocol** — consistent with the project's broader SDUI posture.

### Live verification target

The running backend (`:3000`) has a real master-detail pair with **no UI and no
data yet**, making it the ideal end-to-end verification target:

```
expense_claim (parent)
  claim_number, title, applicant, department, reason, submitted_at,
  total_amount, currency, claim_status, manager_approver, finance_reviewer,
  payment_status, remarks

expense_line (child)
  expense_claim  → master_detail(expense_claim)   ← the relationship
  expense_date, category, description, merchant_vendor, amount,
  tax_amount, receipt_file, billable_to_client
```

### Runtime constraint that shapes the design

Lifecycle **hooks cannot perform nested writes** — the QuickJS hook sandbox
crashes on re-entrant `ctx.api.object(...).update(...)`. Both the expense and
procurement templates state this explicitly and therefore treat the header
total as a **stored field maintained by the client**, not a hook-computed
rollup. Two consequences for this design:

1. The **line total rollup must happen client-side** (the subform computes it
   and writes it onto the parent), not in a child hook.
2. There is no server-side transaction spanning parent+children, and no
   `/batch` endpoint. The renderer must **orchestrate the multi-object write on
   the client** and degrade gracefully on partial failure.

---

## Decision

Build three renderer-side pieces. **No `@objectstack/spec` change.**

### 1. `LineItemsField` (`@object-ui/fields`)

A controlled component — `value: Row[]`, `onChange(rows)` — that finishes what
the dormant `GridFieldMetadata` type promised.

- Renders an editable table: one column per configured child field, one row per
  line, an "Add row" affordance, and a per-row delete.
- Each cell dispatches to the **existing field widgets** by column type
  (`text | number | currency | select | date | lookup`), so we reuse validation
  and formatting rather than reinventing inputs.
- Computes and displays a **running total** of a configured numeric column
  (e.g. `amount`).
- Honors `min_rows` / `max_rows` / `allow_add` / `allow_delete` from the
  existing `GridFieldMetadata`.
- Read-only mode renders the same table without inputs (replaces the
  `"N rows"` stub) — this is the **view** half of the requirement.

Column config (reuses the existing `GridColumnDefinition` shape — keyed by
`name`, as that type declares; the examples here said `field` until
objectui#3951 aligned the renderer to the declared spelling):

```ts
{
  name: 'amount',
  label: 'Amount',
  type: 'currency',        // text | number | currency | select | date | lookup
  options?: [...],         // for select
  reference?: 'category',  // for lookup
  width?: number,
  required?: boolean,
}
```

### 2. `MasterDetailForm` (`@object-ui/plugin-form`)

Composes the **parent form fields** and one or more `LineItemsField`s for child
collections, owning a **single submit**:

```
submit():
  1. validate parent + every line
  2. parentId = parentId ?? (await dataSource.create(parentObject, parentValues)).id
  3. rows' = rows.map(r => ({ ...r, [relationshipField]: parentId }))
  4. created = dataSource.bulk?.(childObject,'create',rows')          // preferred
              ?? Promise.all(rows'.map(r => dataSource.create(childObject, r)))
  5. if (totalField) dataSource.update(parentObject, parentId, { [totalField]: sum })
  6. on child failure → best-effort cleanup of the just-created parent/children,
     surface the error, keep the form open with entered data intact
```

Edit mode (existing parent) diffs current vs. original rows and issues
create / update / delete per line.

Rationale for **client orchestration** over a server batch: no `/batch`
endpoint exists, hooks can't do the cross-object write, and the templates
already maintain rollups client-side. This matches the platform's actual
contract instead of inventing one.

### 3. `record:line_items` component (`@object-ui/plugin-detail`)

Registers `record:line_items` so a **record/detail page** (or a `slotted` page
slot) can drop in the children grid bound to the current record:

```jsonc
{
  "type": "record:line_items",
  "properties": {
    "childObject": "expense_line",
    "relationshipField": "expense_claim",
    "totalField": "total_amount",
    "columns": [
      { "name": "expense_date", "type": "date" },
      { "name": "category", "type": "lookup", "reference": "expense_category" },
      { "name": "description", "type": "text" },
      { "name": "amount", "type": "currency" }
    ]
  }
}
```

With `parentId` from record context it loads children by FK and persists inline
edits immediately — covering "查看的时候也是这样" (view + inline edit). This also
addresses the templates' documented "add a Files/lines panel to a slotted page"
fork point: the children grid is now a registered slot component instead of
forcing the page to `kind: 'full'`.

### Schema surface (additive, renderer-internal types only)

`MasterDetailForm` schema (extends the existing object-form schema):

```ts
{
  type: 'object-master-detail-form',
  objectName: 'expense_claim',         // parent
  mode: 'create' | 'edit',
  recordId?: string,                   // edit mode
  sections: [...],                     // parent fields (unchanged)
  details: [{
    childObject: 'expense_line',
    relationshipField: 'expense_claim',
    totalField: 'total_amount',        // optional rollup target on parent
    title: 'Line Items',
    columns: GridColumnDefinition[],
    minRows?, maxRows?,
  }]
}
```

---

## Consequences

**Positive**

- The header+lines pattern becomes **declarative SDUI** — apps describe it in
  metadata; no bespoke React per app.
- The dormant `GridFieldMetadata` type finally has a renderer; `GridField` edit
  mode stops being a stub.
- Slotted record pages gain an "add a child grid" path without going
  `kind: 'full'`.
- Zero protocol change; works against the existing data API.

**Negative / risks**

- **Non-atomic writes.** Without a server transaction, a partial failure
  (parent created, child N fails) is possible. Mitigation: validate everything
  before writing, create children via `bulk` (one call), best-effort cleanup,
  and keep the form populated so the user can retry. A future server `/batch`
  endpoint can make this atomic without changing the component API.
- **Client-side rollup** can drift if lines are edited by another client.
  Acceptable: matches the platform's current "stored header field" contract; a
  server aggregation in a fork supersedes it transparently.
- Lookup-in-grid cells add fetch volume; mitigated by batch label resolution
  (the pattern `RelatedList` already uses).

**Out of scope (follow-ups)**

- Atomic server `/batch` create (separate, server-side ADR).
- Drag reorder of lines (`allow_reorder`), grouping/subtotal rows.
- A `master_detail` *field widget* auto-selected from object metadata (this ADR
  drives the grid from explicit column config first).

---

## Rollout plan

1. `LineItemsField` editable grid + unit tests (add/delete/edit/total).  ← core
2. `MasterDetailForm` + submit orchestration + unit tests (parent→children FK,
   bulk path, failure cleanup) with a mock dataSource.
3. Register `record:line_items` (detail/view, inline CRUD against existing
   parent).
4. **End-to-end browser verification** against the live `expense_claim` /
   `expense_line`: enter a claim header + 2 lines, submit, confirm parent and
   both children exist via the data API, and the total rolled up.
5. Follow-ups (atomic batch, reorder) tracked separately.

Verification is the gate: the feature is "done" only when a claim with lines is
created end-to-end through the running console.

---

## Amendment (2026-06-07): spreadsheet-style line-item editor

`grid` mode evolved from a "table of inputs" into an enterprise line editor (the
QuickBooks / Stripe / NetSuite pattern), in `GridField` (`@object-ui/fields`) so
every inline grid benefits. All of it is driven from the DATA MODEL — no UI
config — so the standard derived form picks it up automatically.

- **Computed read-only columns.** `GridColumn.computed`/`expr` (derived from a
  child field's `expression`) render read-only and recompute live from sibling
  cells via a tiny safe arithmetic evaluator (`evalArith`, `computeRow` — `+ - *
  / %`, parens, `record.<field>` refs; never `eval`/`Function`). The computed
  value is written back into the row so it persists and the running total
  reflects it. The field stays a **stored** `currency`/`number` (not a `formula`
  field) so the parent `summary` rollup keeps working — the server only treats
  `type:'formula'` as computed, so a stored field's `expression` is a client
  compute hint. `deriveDetail.amountField` now prefers the computed / last
  currency column over the first numeric.
- **Trailing "ghost" row.** The grid always renders one empty line (index-stable
  keys so focus/caret survive); typing materialises a real row + a new ghost.
  Blank/ghost rows are filtered from the batch (`isBlankRow` in `masterDetailTx`).
- **Item typeahead auto-fill.** `LookupField` gains `onSelectRecord(record)` and
  a `compact` (single-line, borderless) mode for grid cells; `GridField`'s
  `lookupAutofillPatch(columns, col, record)` copies the picked record's fields
  into same-named sibling columns (opt out: `autofill: false`).
- **Keyboard nav** (Enter / Arrow Up-Down move between rows in a column),
  **role-based column widths**, **inline per-cell validation** (required-empty
  cells flag in place), **duplicate**, and **drag-to-reorder** (a `sort_field`
  config — auto-derived from a `position`/`sort_order`/… child field — stamps
  `row[sortField] = index` so order persists).
- **Per-row "expand to full form"** is gated: shown in `form` mode (it *is* the
  editor) and in `grid` mode only when the grid omits fields (no redundant
  expand on a thin line).
- **Document totals stack.** `MasterDetailForm` renders a live Subtotal / Tax /
  Total block under the lines when the parent form has a tax-rate field
  (`taxRateField`, default `tax_rate`), read via scoped event delegation on the
  form host (no coupling into `ObjectForm` internals).
- **Layout.** The line-item section is a light label + the grid's own bordered
  table — not a `Card` wrapping an already-bordered grid (that double-framed it
  and `p-6` wasted the table's width).

Showcase: `showcase_invoice` + `showcase_invoice_line` + `showcase_product`
exercise the whole set. See the objectstack-ui / objectstack-data skills for the
data-model recipe.

---

## Addendum (2026-07, #2679): persistence unified behind `DataSource.batchTransaction`

The original design above persisted the parent and its children with a
**client-orchestrated** write plus **best-effort cleanup** on partial failure
(create the parent, then the children, and if a child fails delete the
just-created parent). That cleanup was an atomicity anti-pattern — racy, unable
to undo side effects (hooks/rollups/webhooks already fired), and a second
behavior to maintain alongside the server's real transaction.

Superseded in part by #2679 (tracking framework #1604 / framework ADR-0034
item 4):

- `batchTransaction` is now a first-class (optional) method on the `DataSource`
  contract (`@object-ui/types`), typed via `BatchTransactionOperation`.
- `MasterDetailForm` and `LineItemsPanel` always build one ordered operation
  list and hand it to `runBatchTransaction(dataSource, ops)` — no
  master-detail-specific orchestration or compensation remains in the form.
- The non-atomic fallback is isolated to a single, tested helper
  (`emulateBatchTransaction` in `@object-ui/core`): sequential writes with
  `$ref` resolution and best-effort compensation. `ObjectStackAdapter` uses the
  server's atomic `POST /api/v1/batch` and only falls back to emulation when the
  endpoint is absent (404/405) or the runtime can't do transactions (501).
- Hard removal of the emulation is gated on the server advertising a batch
  capability via discovery (not yet advertised), so the fallback stays for now.

## Addendum (2026-07, #2694): batch transport goes through the client SDK

Follow-up to the #2679 unification above, now that `@objectstack/client@^16`
(framework #3271) ships `data.batchTransaction` and is the ObjectUI dependency
floor:

- `ObjectStackAdapter.batchTransaction` calls the typed SDK method
  `client.data.batchTransaction(operations)` directly. The transitional
  hand-rolled `fetch('/api/v1/batch')` branch — a feature-detect shim kept while
  the SDK method was unreleased — has been removed. Per AGENTS.md §7, adapter
  data always flows through `@objectstack/client`, never a raw `fetch`.
- Behavior is unchanged: the SDK still drives the server's atomic
  `POST /api/v1/batch`, and the adapter still degrades to
  `emulateBatchTransaction` when this backend lacks the endpoint (404/405) or its
  runtime can't do transactions (501). Every other status surfaces to the caller.
- The non-atomic emulation itself is untouched (still gated on a
  discovery-advertised batch capability, not yet advertised).
