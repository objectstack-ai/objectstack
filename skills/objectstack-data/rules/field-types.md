# Field Types Reference

Quick reference for choosing the right field type from 48 available options.

## Text & Content

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `text` | Single-line strings (names, codes, titles) | `maxLength`, `minLength`, `defaultValue` |
| `textarea` | Multi-line plain text (notes, descriptions) | `maxLength`, `rows` |
| `email` | Email addresses — built-in format validation | `required`, `unique` |
| `url` | Web URLs — built-in format validation | `required` |
| `phone` | Phone numbers | `format` (custom regex) |
| `password` | Masked / hashed input | `minLength`, `hashAlgorithm` |
| `markdown` | Markdown-formatted content | `maxLength` |
| `html` | Raw HTML content | `maxLength`, `sanitize` |
| `richtext` | WYSIWYG rich text editor | `maxLength` |

## Numbers

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `number` | Generic numeric value | `min`, `max`, `precision`, `step` |
| `currency` | Monetary amounts | `currencyConfig` (precision, currencyMode, defaultCurrency) |
| `percent` | Percentage values (0-100) | `min`, `max`, `precision` |

## Date & Time

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `date` | Date only (no time component) | `defaultValue`, `min`, `max` |
| `datetime` | Full date + time | `defaultValue`, `timezone` |
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
| `lookup` | Reference another object (independent) | `reference`, `referenceFilters`, `multiple` |
| `master_detail` | Parent–child with lifecycle control | `reference`, `deleteBehavior` (cascade/restrict/set_null) |
| `tree` | Hierarchical self-reference | `reference` |

Set `multiple: true` on lookup for many-to-many via junction.

## Media

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `image` | Image files (PNG, JPG, GIF, WebP) | `fileAttachmentConfig` (maxSize, allowedTypes, storage) |
| `file` | Generic file attachments | `fileAttachmentConfig`, `allowedExtensions` |
| `avatar` | User/profile picture | `fileAttachmentConfig`, `cropAspectRatio` |
| `video` | Video files | `fileAttachmentConfig`, `maxDuration` |
| `audio` | Audio files | `fileAttachmentConfig`, `maxDuration` |

All use `fileAttachmentConfig` for size limits, allowed types, virus scanning, and storage provider.

## Calculated

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `formula` | Computed from an expression referencing other fields | `expression`, `resultType` |
| `summary` | Roll-up aggregation from child records | `summaryType` (count/sum/min/max/avg), `summaryField`, `reference` |
| `autonumber` | Auto-incrementing display format ({0000} counter + optional date / {field} tokens, resets per scope) | `format` (e.g., `"CASE-{0000}"`, `"AD{YYYYMMDD}{0000}"`) |

## Enhanced Types

| Type | When to Use | Config |
|:-----|:------------|:-------|
| `location` | Geographic coordinates (lat/lng) | `defaultZoom`, `enableSearch` |
| `address` | Structured address (street, city, country) | `countryFilter`, `autocomplete` |
| `code` | Syntax-highlighted code editor | `language`, `theme` |
| `json` | JSON data | `schema` (JSON Schema for validation) |
| `color` | Color picker | `format` (hex/rgb/hsl), `alpha` |
| `rating` | Star/heart rating | `max` (default 5), `icon` |
| `slider` | Numeric slider | `min`, `max`, `step` |
| `signature` | Digital signature pad | `signatureConfig` |
| `qrcode` | QR code generator | `qrConfig` |
| `progress` | Progress bar | `min`, `max`, `showPercentage` |
| `tags` | Free-form tag input | `max`, `delimiter`, `caseSensitive` |
| `vector` | AI/ML embeddings (semantic search, RAG) | `vectorConfig` (dimensions, distanceMetric, indexType) |

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
  unique: true,
}
```

### Currency with Precision

```typescript
{
  type: 'currency',
  currencyConfig: {
    precision: 2,
    currencyMode: 'multi',  // or 'single'
    defaultCurrency: 'USD',
  },
}
```

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
  referenceFilters: {
    status: 'active',
  },
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
{
  type: 'formula',
  expression: 'amount * tax_rate',
  resultType: 'currency',
}
```

### Summary (Roll-up)

```typescript
{
  type: 'summary',
  reference: 'invoice_line_item',
  summaryType: 'sum',
  summaryField: 'amount',
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
4. **Only known tokens are interpolated.** Date tokens are **case-sensitive and exact** (`{YYYY}`, not `{yyyy}` or `{YYYY-MM}`). An unrecognized `{...}` is emitted **literally** into the number — `{ YYYY }` (spaces) renders the text `{ YYYY }`.

### Vector (AI Embeddings)

```typescript
{
  type: 'vector',
  vectorConfig: {
    dimensions: 1536,  // OpenAI ada-002
    distanceMetric: 'cosine',
    indexType: 'hnsw',
  },
}
```

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
