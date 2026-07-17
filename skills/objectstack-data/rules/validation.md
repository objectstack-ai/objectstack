# Validation Rules

Comprehensive guide for implementing validation rules in ObjectStack.

## Available Rule Types

The **complete** set of `type` discriminators accepted by `ValidationRuleSchema`:

| Type | Purpose | When Validation Fails |
|:-----|:--------|:---------------------|
| `script` | CEL predicate over the record | When predicate evaluates to `true` |
| `state_machine` | Legal state transitions | When transition not allowed |
| `format` | Regex or built-in format | When format doesn't match |
| `cross_field` | CEL predicate comparing fields | When predicate evaluates to `true` |
| `json_schema` | Validate JSON field | When JSON doesn't match schema |
| `conditional` | Apply nested rule when a predicate holds | When nested rule fails |

There is no other type. In particular:

- **No `unique` type** (removed from the spec in #1475) — enforce uniqueness
  with a **unique index** ([see below](#uniqueness--use-unique-indexes)).
- **No `async` / `custom` type** — external checks and arbitrary validation
  code belong in a `beforeInsert` / `beforeUpdate` **lifecycle hook**
  (see [hooks.md](./hooks.md)).

## Expression Syntax

`condition` / `when` are **CEL predicates** (ADR-0032). Author them with the
`P` tag from `@objectstack/spec`; a plain string is also accepted and parsed
as CEL. Record fields are addressed as `record.<field>`; on update the prior
row is available as `previous.<field>`. CEL uses `==`, `!=`, `&&`, `||`,
`!` — not SQL's `=`, `AND`, `IS NULL`.

**⚠️ CRITICAL:** For `script` **and** `cross_field`, the predicate expresses
the **failure** condition — validation **fails** when it evaluates to `true`.

## Script Validation

```typescript
import { P } from '@objectstack/spec';

validations: [
  {
    name: 'prevent_past_dates',
    type: 'script',
    condition: P`record.due_date < today()`,  // ❌ Fails when this is TRUE
    message: 'Due date cannot be in the past',
    severity: 'error',
    events: ['insert', 'update'],
  },
]
```

### Common Script Patterns

```typescript
// Prevent negative values
condition: P`record.amount < 0`

// Require field when another field has value
condition: P`record.status == 'approved' && isBlank(record.approver_id)`

// Date range validation
condition: P`record.end_date < record.start_date`

// Conditional required field
condition: P`record.type == 'enterprise' && isBlank(record.account_manager)`
```

> On **insert**, an optional field omitted from the payload reads as `null`
> in the predicate — `record.due_date == null` matches an omitted field the
> same as an explicit `null` (#1871). Use `isBlank(v)` to catch `null` and
> empty strings together.

## Uniqueness — Use Unique Indexes

There is **no `unique` validation type**. Uniqueness — including composite
uniqueness — is declared as a unique **index** on the object:

```typescript
indexes: [
  { fields: ['email'], unique: true },               // single-field uniqueness
  { fields: ['tenant_id', 'email'], unique: true },  // composite uniqueness
]
```

The database enforces the constraint; duplicate writes are rejected at the
driver layer. See [indexing.md](./indexing.md) for index options.

## State Machine Validation

```typescript
validations: [
  {
    name: 'status_flow',
    type: 'state_machine',
    field: 'status',
    transitions: {
      draft: ['submitted', 'cancelled'],
      submitted: ['in_review', 'cancelled'],
      in_review: ['approved', 'rejected'],
      approved: ['published'],
      rejected: ['draft'],
      published: [],  // Terminal state
      cancelled: [],  // Terminal state
    },
    message: 'Invalid status transition',
    severity: 'error',
  },
]
```

## Format Validation

```typescript
validations: [
  // Built-in formats
  {
    name: 'email_format',
    type: 'format',
    field: 'email',
    format: 'email',  // Built-in: email, url, phone, json
    message: 'Invalid email format',
  },

  // Custom regex — the key is `regex`, not `pattern`
  {
    name: 'sku_format',
    type: 'format',
    field: 'sku',
    regex: '^[A-Z]{3}-\\d{4}$',  // e.g., ABC-1234
    message: 'SKU must be format: XXX-0000',
  },
]
```

## Cross-Field Validation

Same inverted semantics as `script` — the predicate is the **failure**
condition. `fields` lists the fields involved (used for error targeting).

```typescript
validations: [
  {
    name: 'date_range',
    type: 'cross_field',
    condition: P`record.end_date <= record.start_date`,  // ❌ TRUE = invalid
    message: 'End date must be after start date',
    fields: ['start_date', 'end_date'],
  },
  {
    name: 'discount_limit',
    type: 'cross_field',
    condition: P`record.discount_amount > record.subtotal * 0.5`,
    message: 'Discount cannot exceed 50% of subtotal',
    fields: ['discount_amount', 'subtotal'],
  },
]
```

## JSON Schema Validation

```typescript
validations: [
  {
    name: 'config_schema',
    type: 'json_schema',
    field: 'config',
    schema: {
      type: 'object',
      properties: {
        timeout: { type: 'number', minimum: 0 },
        retries: { type: 'integer', minimum: 1, maximum: 5 },
        enabled: { type: 'boolean' },
      },
      required: ['timeout', 'enabled'],
      additionalProperties: false,
    },
    message: 'Invalid configuration format',
  },
]
```

## Conditional Validation

Shape is `when` / `then` / `otherwise` — `when` is a CEL predicate, `then`
is a **single** nested rule applied when it holds, `otherwise` (optional) a
single rule applied when it doesn't. There is no `validations: []` array —
compose multiple checks as multiple top-level rules or nested conditionals.

```typescript
validations: [
  {
    name: 'enterprise_requires_manager',
    type: 'conditional',
    when: P`record.type == 'enterprise'`,
    message: 'Enterprise account validation',
    then: {
      name: 'manager_required',
      type: 'script',
      condition: P`isBlank(record.account_manager)`,
      message: 'Enterprise accounts must have an account manager',
    },
  },
]
```

With an `otherwise` branch:

```typescript
{
  name: 'payment_validation',
  type: 'conditional',
  when: P`record.order_total > 10000`,
  message: 'Order validation',
  then: {
    name: 'manager_approval_required',
    type: 'script',
    condition: P`isBlank(record.manager_approval_id)`,
    message: 'Orders over $10,000 require manager approval',
  },
  otherwise: {
    name: 'payment_method_required',
    type: 'script',
    condition: P`isBlank(record.payment_method)`,
    message: 'Payment method is required',
  },
}
```

## External / Custom Validation → Lifecycle Hooks

Calling an external API, hitting another object, or running arbitrary code is
**not** a validation type. Implement it as a `beforeInsert` / `beforeUpdate`
lifecycle hook and throw on failure — the typed, supported extension point:

```typescript
import { Hook, HookContext } from '@objectstack/spec/data';

const taxIdCheck: Hook = {
  name: 'tax_id_external_check',
  object: 'account',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx: HookContext) => {
    if (ctx.input.tax_id && !(await verifyTaxId(ctx.input.tax_id))) {
      throw new Error('Invalid tax ID');
    }
  },
};
```

## Validation Properties

### Severity Levels

```typescript
severity: 'error'    // Blocks save (default)
severity: 'warning'  // Allows save, shows warning
severity: 'info'     // Informational only
```

### Events

```typescript
events: ['insert']              // Only on create
events: ['update']              // Only on update
events: ['insert', 'update']    // On create and update (default)
events: ['delete']              // Only on delete
```

### Priority

```typescript
priority: 0      // System validations (run first)
priority: 100    // Application validations (default)
priority: 1000   // User validations (run last)
```

Lower numbers execute **first**.

## Incorrect vs Correct

### ❌ Incorrect — Script Logic Inverted

```typescript
{
  type: 'script',
  condition: P`record.amount > 0`,  // ❌ Fails when amount > 0 (inverted!)
  message: 'Amount must be positive',
}
```

### ✅ Correct — Script Logic

```typescript
{
  type: 'script',
  condition: P`record.amount <= 0`,  // ✅ Fails when amount <= 0
  message: 'Amount must be positive',
}
```

### ❌ Incorrect — SQL Syntax in a CEL Predicate

```typescript
{
  type: 'script',
  condition: "status = 'approved' AND approver_id IS NULL",  // ❌ not CEL
  message: 'Approved records need an approver',
}
```

### ✅ Correct — CEL Predicate

```typescript
{
  type: 'script',
  condition: P`record.status == 'approved' && isBlank(record.approver_id)`,
  message: 'Approved records need an approver',
}
```

### ❌ Incorrect — Validation Fires Too Often

```typescript
{
  type: 'script',
  condition: P`record.status == 'draft'`,
  message: 'Record is still in draft',
  // ❌ No events — runs on all operations
}
```

### ✅ Correct — Validation Scoped to Events

```typescript
{
  type: 'script',
  condition: P`record.status == 'draft'`,
  message: 'Cannot publish draft records',
  events: ['update'],  // ✅ Only validate on update
}
```

## Common Patterns

### Prevent Backdating

```typescript
{
  name: 'no_backdate',
  type: 'script',
  condition: P`record.effective_date < today()`,
  message: 'Effective date cannot be in the past',
  events: ['insert'],
}
```

### Require Approval for High Values

```typescript
{
  name: 'high_value_approval',
  type: 'conditional',
  when: P`record.amount > 10000`,
  message: 'High-value transaction validation',
  then: {
    name: 'approval_required',
    type: 'script',
    condition: P`isBlank(record.approved_by)`,
    message: 'High-value transactions require approval',
  },
}
```

### Email Domain Whitelist

```typescript
{
  name: 'email_domain',
  type: 'format',
  field: 'email',
  regex: '^[a-zA-Z0-9._%+-]+@(company\\.com|partner\\.com)$',
  message: 'Email must be from company.com or partner.com',
}
```

### Phone Number Format

```typescript
{
  name: 'phone_format',
  type: 'format',
  field: 'phone',
  regex: '^\\+?[1-9]\\d{1,14}$',  // E.164 format
  message: 'Phone must be in international format (+1234567890)',
}
```

### Composite Uniqueness (Tenant + Email)

Not a validation — declare a unique index on the object:

```typescript
indexes: [
  { fields: ['tenant_id', 'email'], unique: true },
]
```

## Best Practices

1. **Use declarative validation first** — Only use script validation when declarative rules don't fit
2. **Severity matters** — Use `warning` for soft rules, `error` for hard rules
3. **Events scope** — Only validate on relevant operations to avoid overhead
4. **Priority order** — System validations first (0-99), app validations second (100-999), user validations last (1000+)
5. **Clear error messages** — Tell users exactly what's wrong and how to fix it
6. **State machine for workflows** — Use state_machine instead of complex script logic
7. **Uniqueness is an index concern** — Declare `indexes: [{ fields, unique: true }]`, never a script-based existence check
8. **External checks are hooks** — Call APIs from `beforeInsert`/`beforeUpdate` hooks, not validations
9. **Cross-field for comparisons** — More efficient than script validation
10. **Test thoroughly** — Validate edge cases, nulls, empty strings

## Performance Considerations

- **Script validations are expensive** — Use sparingly, prefer declarative rules
- **Priority affects order** — Lower priority = runs first
- **Unique indexes are enforced by the database** — no per-write query cost beyond index maintenance
- **State machine is optimized** — Better than complex conditional logic
