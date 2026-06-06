# Relationship Patterns

Guide for modeling relationships between objects using `lookup`, `master_detail`, and junction patterns.

## Relationship Types

| Type | Lifecycle | Required | Sharing | Roll-ups | Use Case |
|:-----|:----------|:---------|:--------|:---------|:---------|
| `lookup` | Independent | Optional by default | Independent | Not available | "Related to" |
| `master_detail` | Coupled (cascade delete) | Always required | Inherits parent | Supported via `summary` | "Owned by" |
| `tree` | Self-reference | Optional | N/A | Not available | Hierarchical |

## When to Use lookup vs master_detail

### Use `lookup` When:
- Child record can exist independently
- Parent deletion should not affect child
- No roll-up aggregations needed
- Relationship is optional
- **Example:** `task.assigned_to → user` (task can exist without assignment)

### Use `master_detail` When:
- Child record is meaningless without parent
- Parent deletion should cascade to children
- Need roll-up summaries (count, sum, min, max, avg)
- Relationship is mandatory
- **Example:** `invoice_line_item.invoice_id → invoice` (line items belong to invoice)

## Patterns

### One-to-Many: lookup

```typescript
// Parent: Account
export default ObjectSchema.create({
  name: 'account',
  fields: {
    name: { type: 'text', required: true },
  }
});

// Child: Contact (independent lifecycle)
export default ObjectSchema.create({
  name: 'contact',
  fields: {
    first_name: { type: 'text', required: true },
    account_id: {
      type: 'lookup',
      reference: 'account',
      required: false,  // Contact can exist without account
    },
  }
});
```

### One-to-Many: master_detail

```typescript
// Parent: Invoice
export default ObjectSchema.create({
  name: 'invoice',
  fields: {
    invoice_number: { type: 'text', required: true },
    total: {
      type: 'summary',
      reference: 'invoice_line_item',
      summaryType: 'sum',
      summaryField: 'amount',
    },
  }
});

// Child: Line Item (owned by parent)
export default ObjectSchema.create({
  name: 'invoice_line_item',
  fields: {
    invoice_id: {
      type: 'master_detail',
      reference: 'invoice',
      deleteBehavior: 'cascade',  // Delete line items when invoice deleted
      required: true,
    },
    product: { type: 'text', required: true },
    amount: { type: 'currency', required: true },
  }
});
```

### Many-to-Many: Junction Object

```typescript
// Side A: Project
export default ObjectSchema.create({
  name: 'project',
  fields: {
    name: { type: 'text', required: true },
  }
});

// Side B: Employee
export default ObjectSchema.create({
  name: 'employee',
  fields: {
    name: { type: 'text', required: true },
  }
});

// Junction: Project Assignment
export default ObjectSchema.create({
  name: 'project_assignment',
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
  validations: [
    {
      name: 'unique_assignment',
      type: 'unique',
      fields: ['project_id', 'employee_id'],
      message: 'Employee already assigned to this project',
    },
  ],
});
```

### Hierarchical: tree (Self-Reference)

```typescript
export default ObjectSchema.create({
  name: 'category',
  fields: {
    name: { type: 'text', required: true },
    parent_category: {
      type: 'tree',
      reference: 'category',  // Self-reference
      required: false,
    },
  }
});
```

## Delete Behaviors

Configure `deleteBehavior` on `master_detail` relationships:

| Behavior | Effect | Use Case |
|:---------|:-------|:---------|
| `cascade` | Delete all child records | Invoice → Line Items |
| `restrict` | Prevent parent deletion if children exist | Department → Employees |
| `set_null` | Set child reference to null | Manager → Employees (manager leaves) |

```typescript
{
  type: 'master_detail',
  reference: 'parent_object',
  deleteBehavior: 'cascade',  // or 'restrict' or 'set_null'
}
```

## Roll-up Summaries

A parent `summary` field aggregates a child collection. The engine recomputes it
**server-side** whenever a child is inserted/updated/deleted (inside the same
transaction as the write, so it's consistent and never summed on the client).

```typescript
// On the PARENT object:
{
  type: 'summary',
  summaryOperations: {
    object: 'invoice_line',        // child object to aggregate
    field: 'amount',               // child field to aggregate (ignored for count)
    function: 'sum',               // 'count' | 'sum' | 'min' | 'max' | 'avg'
    // relationshipField: 'invoice' // optional; auto-detected from the child's
                                     // master_detail/lookup field referencing
                                     // this parent when omitted
  },
}
```

Empty collections roll up to `0` for `count`/`sum`, `null` for `min`/`max`/`avg`.
Pairs naturally with inline editing (below): the parent total updates atomically
as line items are saved.

## Inline Editing (Master-Detail Entry)

Declare inline editing **on the relationship**, in the data model — not in a form
view. Set `inlineEdit: true` on the child's `master_detail` (or `lookup`) field
that points back to the parent. The parent's **standard** create/edit form then
renders an editable grid for these children and saves parent + children in **one
atomic transaction** — with no form-view config and no bespoke page. The UI is
derived from metadata (relationship FK + child fields → grid columns).

```typescript
// On the CHILD object's FK field:
export default ObjectSchema.create({
  name: 'invoice_line',
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

A form view may still set `subforms` to override the derived columns/order, but
the relationship `inlineEdit` is the primary, zero-config path. See the
objectstack-ui skill (Master-Detail Forms) for the rendering side.

## Incorrect vs Correct

### ❌ Incorrect — Using lookup When master_detail is Needed

```typescript
// Invoice line items should NOT be independent
export default ObjectSchema.create({
  name: 'invoice_line_item',
  fields: {
    invoice_id: {
      type: 'lookup',  // ❌ Child can exist without parent — wrong!
      reference: 'invoice',
    },
  }
});
```

### ✅ Correct — Using master_detail for Owned Children

```typescript
export default ObjectSchema.create({
  name: 'invoice_line_item',
  fields: {
    invoice_id: {
      type: 'master_detail',  // ✅ Child owned by parent
      reference: 'invoice',
      deleteBehavior: 'cascade',
      required: true,
    },
  }
});
```

### ❌ Incorrect — Native Many-to-Many

```typescript
// ObjectStack does not have native many-to-many type
{
  type: 'many_to_many',  // ❌ Not a valid field type
  reference: 'tag',
}
```

### ✅ Correct — Junction Object Pattern

```typescript
// Create explicit junction object with two lookup fields
export default ObjectSchema.create({
  name: 'post_tag',
  fields: {
    post_id: { type: 'lookup', reference: 'post', required: true },
    tag_id: { type: 'lookup', reference: 'tag', required: true },
  },
});
```

## Best Practices

1. **Use lookup by default** — Only use master_detail when lifecycle coupling is required
2. **Unique constraints on junctions** — Prevent duplicate many-to-many entries
3. **Meaningful junction names** — Use descriptive names like `project_assignment` not `project_employee`
4. **deleteBehavior on master_detail** — Always specify cascade/restrict/set_null
5. **Required on master_detail** — Child should always require parent
6. **Roll-ups for aggregation** — Use summary fields on parent for counts/sums
7. **referenceFilters for scoping** — Limit lookup options to relevant records

## Performance Considerations

- **Index foreign keys** — Always create indexes on lookup/master_detail fields
- **Avoid deep hierarchies** — tree relationships > 5 levels can impact query performance
- **Junction table indexes** — Composite index on both foreign keys in junction tables
- **Summary field caching** — Roll-up summaries are cached and updated on child changes
