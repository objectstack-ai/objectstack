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

- **No `unique` type** (removed from the spec) — enforce uniqueness
  with a **unique index** ([see below](#uniqueness--use-unique-indexes)).
- **No `async` / `custom` type** — external checks and arbitrary validation
  code belong in a `beforeInsert` / `beforeUpdate` **lifecycle hook**
  (see [references/data-hooks.md](../references/data-hooks.md)).

## Expression Syntax

`condition` / `when` are **CEL predicates** (ADR-0032). Author them with the
`P` tag from `@objectstack/spec`; a plain string is also accepted and parsed
as CEL. Record fields are addressed as `record.<field>`; on update the prior
row is available as `previous.<field>`. CEL operator and null-handling rules:
see **objectstack-formula**.

**⚠️ CRITICAL:** For `script` **and** `cross_field`, the predicate expresses
the **failure** condition — validation **fails** when it evaluates to `true`.

## Script Validation

```typescript
import { P } from '@objectstack/spec';

const validations = [
  {
    name: 'prevent_past_dates',
    type: 'script',
    condition: P`record.due_date < today()`,  // ❌ Fails when this is TRUE
    message: 'Due date cannot be in the past',
    severity: 'error',
    events: ['insert', 'update'],
  },
];
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
> same as an explicit `null`. Use `isBlank(v)` to catch `null` and
> empty strings together.

## Uniqueness — Use Unique Indexes

There is **no `unique` validation type**. Uniqueness — including composite
uniqueness — is declared as a unique **index** on the object:

```typescript
indexes: [
  { fields: ['email'], unique: 'organization' },              // one per organization
  { fields: ['department', 'email'], unique: 'organization' }, // composite, per organization
  { fields: ['hostname'], unique: 'global' },                 // one across the installation
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
import { defineHook, HookContext } from '@objectstack/spec/data';

const taxIdCheck = defineHook({
  name: 'tax_id_external_check',
  object: 'account',
  events: ['beforeInsert', 'beforeUpdate'],
  handler: async (ctx: HookContext) => {
    if (ctx.input.tax_id && !(await verifyTaxId(ctx.input.tax_id))) {
      throw new Error('Invalid tax ID');
    }
  },
});
```

## Validation Properties

### Severity Levels

```typescript
severity: 'error'    // Blocks save (default)
severity: 'warning'  // Allows save, shows warning
severity: 'info'     // Informational only
```

**Blocking rests on a human judgement.** A machine-inferred signal — a score, a
duplicate guess, anything the system decided — may `warning`, never `error`.
Only a value a person wrote may block a save. Do not add an override flag to
soften a block either: an escape hatch around a rule is evidence the rule should
have been a warning.

### Events

```typescript
events: ['insert']              // Only on create
events: ['update']              // Only on update
events: ['insert', 'update']    // On create and update (default)
```

> Validation rules run only on the insert/update write path — there is no `'delete'`
> event (a delete carries no record payload to validate). To block or guard a deletion,
> use a `beforeDelete` lifecycle hook instead (see `references/data-hooks.md`).

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
