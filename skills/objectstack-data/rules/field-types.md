# Field Types Reference

Quick reference for choosing the right field type from 49 available options.

> **Config columns list only real `FieldSchema` keys.** Per-type display knobs
> beyond these do **not** exist — an unknown field key is REFUSED at parse
> (`unrecognized_keys`), so don't invent `theme`, `rows`, or
> `fileAttachmentConfig`. Source of truth:
> `node_modules/@objectstack/spec/src/data/field.zod.ts`.

## Text & Content

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `text` | Single-line strings (names, codes, titles) | `maxLength`, `minLength`, `defaultValue` |
| `textarea` | Multi-line plain text (notes, descriptions) | `maxLength`, `minLength` |
| `email` | Email addresses — built-in format validation | `required`, `unique` |
| `url` | Web URLs — built-in format validation | `required` |
| `phone` | Phone numbers | `format` |
| `password` | ⚠️ Masked-on-read input. On a generic object the value is stored **PLAINTEXT at rest** (never hashed — one-way hashing applies only inside the auth subsystem's own identity tables). Prefer `secret` for credentials; a generic `password` field triggers a build warning | `minLength`, `maxLength` |
| `secret` | Reversible **encrypted-at-rest** credential (DB password, API key, token) — encrypted on write via `ICryptoProvider`, masked on read, fail-closed (ADR-0100). **The recommended type for credentials** | — |
| `markdown` | Markdown-formatted content | `maxLength` |
| `html` | Raw HTML content | `maxLength` |
| `richtext` | WYSIWYG rich text editor | `maxLength` |

## Numbers

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `number` | Generic numeric value | `min`, `max`, `precision`, `scale` |
| `currency` | Monetary amounts | `currencyConfig` (precision, currencyMode, defaultCurrency) |
| `percent` | Percentage values (0-100) | `min`, `max`, `precision` |

## Date & Time

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `date` | Date only (no time component) | `defaultValue` |
| `datetime` | Full date + time | `defaultValue` |
| `time` | Time only (no date component) | `defaultValue`, `format` |

## Logic

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `boolean` | Standard checkbox | `defaultValue` |
| `toggle` | Toggle switch (distinct UI from checkbox) | `defaultValue` |

## Selection

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `select` | Single-choice dropdown | `options` (value, label, color, default) |
| `multiselect` | Tag-style multi-choice | `options`, `max` |
| `radio` | Radio button group (fewer choices, always visible) | `options` |
| `checkboxes` | Checkbox group | `options` |

**Critical:** Every option must have lowercase `value` and human-readable `label`.

```typescript
options: [
  { label: 'In Progress', value: 'in_progress', color: '#3498db' },
  { label: 'Done', value: 'done', default: true },
]
```

## Relational

| Type | When to Use | Key Config |
|:-----|:------------|:-----------|
| `lookup` | Reference another object (independent) | `reference`, `lookupFilters`, `multiple`, `deleteBehavior` |
| `master_detail` | Parent–child with lifecycle control | `reference`, `deleteBehavior` (`cascade`/`restrict` — `set_null` is refused) |
| `tree` | Hierarchical self-reference | `reference` |
| `user` | Person picker — a lookup specialized to `sys_user` (assignee, watchers). Stored identically to `lookup` | `multiple` (collaborators), `defaultValue: 'current_user'` |

> **`multiple: true` lookup ≠ junction object.** A multi-value lookup is stored
> and read as an **array of ids** on the record — it is NOT a junction table.
> Reach for a **junction object** (two lookups) only when the relationship
> itself carries attributes (position, added_at, …).

## Media

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `image` | Image files (PNG, JPG, GIF, WebP) | `multiple` |
| `file` | Generic file attachments | `multiple` |
| `avatar` | User/profile picture | — |
| `video` | Video files | — |
| `audio` | Audio files | — |

There is no per-field attachment config (size limits, allowed types, storage) —
storage concerns live outside the field schema.

## Embedded (JSON sub-objects)

Stored as JSON on the parent row — no separate table / FK:

| Type | When to Use |
|:-----|:------------|
| `composite` | Single embedded sub-object with declared sub-fields |
| `repeater` | Repeating embedded sub-object **array** |
| `record` | Name-keyed **map** of embedded sub-objects (insertion order = display order; ADR-0007) |

## Calculated

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `formula` | Computed from an expression referencing other fields | `expression` (CEL, `record.` prefixes), `returnType` (`'number' \| 'text' \| 'boolean' \| 'date'`) |
| `summary` | Roll-up aggregation from child records | `summaryOperations` ({ object, field, function, relationshipField?, filter? }) |
| `autonumber` | Auto-incrementing display format ({0000} counter + optional date / {field} tokens, resets per scope) | `format` (shorthand) / `autonumberFormat` (canonical) — e.g., `"CASE-{0000}"`, `"AD{YYYYMMDD}{0000}"` |

## Enhanced Types

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `location` | Geographic coordinates (lat/lng) | — |
| `address` | Structured address (street, city, country) | — |
| `code` | Syntax-highlighted code editor | `language` |
| `json` | JSON data (untyped escape hatch) | — (validate with a `json_schema` validation rule on the object) |
| `color` | Color picker | — |
| `rating` | Star/heart rating | `max` (default 5) |
| `slider` | Numeric slider | `min`, `max`, `step` |
| `signature` | Digital signature pad | — |
| `qrcode` | QR code / barcode | — |
| `progress` | Progress bar | `min`, `max` |
| `tags` | Free-form tag input | — |
| `vector` | AI/ML embeddings (semantic search, RAG) | `dimensions` (flat sibling, e.g. `1536`) |

## Field Type Decision Tree

```
What kind of data?
│
├── Text?
│   ├── Single line → text
│   ├── Multiple lines → textarea
│   ├── Formatted → richtext / markdown / html
│   ├── Email → email
│   ├── URL → url
│   ├── Phone → phone
│   ├── Credential (API key, token, DB password) → secret (encrypted at rest — NOT password)
│   └── Code → code
│
├── Number?
│   ├── Money → currency
│   ├── Percentage → percent
│   └── Generic → number
│
├── Date/Time?
│   ├── Date only → date
│   ├── Time only → time
│   └── Date + Time → datetime
│
├── True/False?
│   ├── Checkbox → boolean
│   └── Switch → toggle
│
├── Choose from list?
│   ├── Single choice, dropdown → select
│   ├── Single choice, always visible → radio
│   ├── Multiple choice, tags → multiselect
│   └── Multiple choice, checkboxes → checkboxes
│
├── Reference another object?
│   ├── Independent → lookup
│   ├── Owned child → master_detail
│   ├── A person (assignee, watcher) → user
│   └── Hierarchy → tree
│
├── File/Media?
│   ├── Image → image
│   ├── Video → video
│   ├── Audio → audio
│   ├── User photo → avatar
│   └── Generic file → file
│
├── Calculated?
│   ├── Formula → formula
│   ├── Roll-up → summary
│   └── Auto-number → autonumber
│
├── Embedded sub-object (no separate table)?
│   ├── Single → composite
│   ├── Array → repeater
│   └── Name-keyed map → record
│
└── Special?
    ├── Location → location
    ├── Address → address
    ├── Color → color
    ├── Rating → rating
    ├── Signature → signature
    ├── QR code → qrcode
    ├── Progress → progress
    ├── Tags → tags
    ├── JSON data → json
    └── AI embeddings → vector
```

## Common Field Configurations

### Text with Max Length

```typescript
{
  type: 'text',
  maxLength: 255,
  required: true,
}
```

### Email with Uniqueness

```typescript
{
  type: 'email',
  required: true,
  // State the scope (ADR-0120): 'organization' = one holder per organization
  // (NULL-safe), 'global' = one across the whole installation. Bare `true` at
  // field level still means 'organization' and stays valid.
  unique: 'organization',
}
```

### Currency with Precision

```typescript
{
  type: 'currency',
  currencyConfig: {
    precision: 2,
    currencyMode: 'fixed',   // 'fixed' = one currency for the column;
                             // 'dynamic' = per-record `{ value, currency }`
    defaultCurrency: 'USD',  // ISO 4217
  },
}
```

**Currency resolution (ADR-0053).** A displayed amount resolves its symbol
through: the field's own `currencyConfig.defaultCurrency` → the tenant
`localization.currency` default. With neither set, renderers show a plain
grouped number (never a hardcoded `$`). The same chain backs analytics measures
(a measure's explicit `currency` wins over the field/tenant default).

### Select with Default

```typescript
{
  type: 'select',
  required: true,
  options: [
    { label: 'Low', value: 'low' },
    { label: 'Medium', value: 'medium', default: true },
    { label: 'High', value: 'high', color: '#e74c3c' },
  ],
}
```

### Lookup (One-to-Many)

```typescript
{
  type: 'lookup',
  reference: 'account',
  required: true,
  // Structured, picker-honoured filter — the former string[] `referenceFilters`
  // was removed (ADR-0049): it filtered nothing.
  lookupFilters: [
    { field: 'status', operator: 'eq', value: 'active' },
  ],
}
```

### Lookup (Many-to-Many)

```typescript
{
  type: 'lookup',
  reference: 'tag',
  multiple: true,
  max: 10,
}
```

### Master-Detail with Cascade

```typescript
{
  type: 'master_detail',
  reference: 'invoice',
  deleteBehavior: 'cascade',
  required: true,
}
```

### Formula

```typescript
import { F } from '@objectstack/spec';

{
  type: 'formula',
  expression: F`record.amount * record.tax_rate`,  // CEL — `record.` prefixes required
  returnType: 'number',   // 'number' | 'text' | 'boolean' | 'date' (no 'currency')
}
```

### Summary (Roll-up)

```typescript
{
  type: 'summary',
  summaryOperations: {
    object: 'invoice_line_item',   // child object to aggregate
    field: 'amount',               // child field (ignored for count)
    function: 'sum',               // 'count' | 'sum' | 'min' | 'max' | 'avg'
    // relationshipField / filter — optional (see rules/relationships.md)
  },
}
```

### Autonumber

```typescript
{
  type: 'autonumber',
  format: 'CASE-{0000}',
}
```

The `format` is literal text interleaved with `{...}` tokens:

| Token | Renders | Example |
|:------|:--------|:--------|
| `{0000}` | The counter, zero-padded to that many digits (**minimum** width). At most ONE slot. | `CASE-{0000}` → `CASE-0042` |
| `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` | Generation date in the request's business timezone | `AD{YYYYMMDD}{0000}` → `AD202606170001` |
| `{field_name}` | The value of another field **on the same record** | `{plan_no}{000}` → `PLAN-001001` |

**The counter resets per "scope"** — everything rendered *before* the `{0000}` slot. So `AD{YYYYMMDD}{0000}` restarts each day, `{section}{island_zone}{000}` counts per group, `{plan_no}{000}` counts per parent — no separate reset config. A fixed-prefix format (`CASE-{0000}`) has an empty scope → one global counter.

**Rules — get these wrong and records mis-number silently or fail to save:**

1. **Every `{field}` you interpolate must be `required: true`** and set before the record is created. An empty interpolated field makes the record number generation *throw* (the compile lint flags a non-existent field as an error, an optional one as a warning).
2. **Put a delimiter between adjacent variable tokens** — `{section}-{zone}{000}`, not `{section}{zone}{000}`. Without one, `('AB','C')` and `('A','BC')` both render prefix `ABC` and share a counter (to keep numbers unique). The literal separator keeps distinct groups apart.
3. **Pad width is a MINIMUM, not a cap.** `{000}` → `001`…`999`, then `1000` (it grows, never wraps). Size it for readability, not as a ceiling.
4. **Only known tokens are interpolated.** Date tokens are **case-sensitive** — `{yyyy}` parses as a `{field}` reference and renders **empty** (rule 1 applies). Only a spelling no field could have — `{ YYYY }`, `{YYYY-MM}` — is emitted **literally**.

### Vector (AI Embeddings)

```typescript
{
  type: 'vector',
  dimensions: 1536,  // flat sibling — OpenAI ada-002
}
```

There is **no** `vectorConfig` block — an authored `vectorConfig` is refused at
parse. `dimensions` is the flat field-level key.

## Incorrect vs Correct

### ❌ Incorrect — Wrong Type for Email

```typescript
{
  type: 'text',  // ❌ No built-in email validation
  maxLength: 255,
}
```

### ✅ Correct — Use email Type

```typescript
{
  type: 'email',  // ✅ Built-in validation + UI affordances
}
```

### ❌ Incorrect — Uppercase Option Value

```typescript
options: [
  { label: 'Done', value: 'Done' },  // ❌ Uppercase
]
```

### ✅ Correct — Lowercase Option Value

```typescript
options: [
  { label: 'Done', value: 'done' },  // ✅ Lowercase
]
```

### ❌ Incorrect — Missing Reference

```typescript
{
  type: 'lookup',  // ❌ No reference specified
}
```

### ✅ Correct — Specify Reference

```typescript
{
  type: 'lookup',
  reference: 'account',  // ✅ Target object specified
}
```

### ❌ Incorrect — Autonumber interpolating an optional / adjacent field

```typescript
{
  plan_no: { type: 'text' },  // ❌ not required — empty value throws at create
  order_no: { type: 'autonumber', format: '{section}{plan_no}{000}' },  // ❌ no delimiter
}
```

### ✅ Correct — Required field + delimiter between variable tokens

```typescript
{
  plan_no: { type: 'text', required: true },  // ✅ always set before generation
  order_no: { type: 'autonumber', format: '{section}-{plan_no}-{000}' },  // ✅ delimited
}
```
