## Seed Data & Fixtures (`defineSeed()`)

Object definition and seed data live together — a `*.object.ts` usually
pairs with a `*.seed.ts`.

> The factory is `defineSeed` — **not** `defineDataset`, which is the
> unrelated ADR-0021 analytics semantic layer (`@objectstack/spec/ui`).

> ⛔ `sys_organization` is platform-bootstrapped — never a seed target; the
> deployment posture decides how many exist (`rules/security.md`
> § Multi-tenancy).

### Quick start

```typescript
// src/data/index.ts
import { defineSeed } from '@objectstack/spec/data';
import { Status } from '../objects/status.object';
import { Category } from '../objects/category.object';

// Reference data — every environment
export const statusSeed = defineSeed(Status, {
  externalId: 'code',
  mode: 'upsert',
  records: [
    { code: 'active',   label: 'Active',   color: '#2ecc71' },
    { code: 'inactive', label: 'Inactive', color: '#95a5a6' },
  ],
});

// Demo data — dev/test only
export const categorySeed = defineSeed(Category, {
  externalId: 'slug',
  env: ['dev', 'test'],
  records: [
    { slug: 'electronics', name: 'Electronics' },
  ],
});

export const SeedData = [statusSeed, categorySeed];
```

### `Seed` fields

| Field | Default | Purpose |
|:------|:--------|:--------|
| `object` | derived | Auto-set from `objectDef.name` — never write manually |
| `externalId` | `'name'` | Stable business key (or field list) every mode matches on |
| `mode` | `'ignore'` | Import strategy (see below) |
| `columns` | — | Per-column write policy, keyed by field: `{ FIELD: { applyOn: 'create' } }` (below) |
| `env` | `['prod','dev','test']` | Environments where the seed loads |
| `locale` | — (every locale) | BCP-47 tags it loads for; a locale no set of the object names gets none |
| `fallback` | — | `true` on ONE `locale` set per object: also loads for a locale no set names |
| `dependsOn` | — | Objects it loads after when no lookup links them (below) |
| `records` | — | `Partial<Record<keyof object.fields, unknown>>[]` |

Full Zod shape: `node_modules/@objectstack/spec/src/data/seed.zod.ts`.

### Import modes

| Mode | Behavior | Use for |
|:-----|:---------|:--------|
| `ignore` (default) | Create-only: insert a missing row, leave a matched row as is. | Data the customer owns |
| `upsert` | Insert if missing; every replay writes declared columns back. | Reference data kept current |
| `update` | Update only existing rows; never create. | Patching existing config |

`insert` / `replace` are refused (every replay re-inserted each record). With
no single natural key, keep the default mode and set a composite `externalId`
(`['team', 'project']`), or `'id'` when the records carry their own ids.

A seed replays on each boot, install and re-publish. AppPlugin's boot and organization
replays (not a publish or package install) do not re-insert a keyed row a
person deleted; `seed-replayer` with `{ reseed: true }` restores it.

### Columns the app owns after the first load — `columns.FIELD.applyOn`

For a column a job or an admin advances after the first load, declare
`applyOn: 'create'`: written when the seed creates the row, left as the row
holds it on every replay (`update` never writes it).
Each key must be a field of the object or an injected system column —
`defineSeed` refuses one that is not. Same values and meaning as an import
mapping entry's `applyOn` (objectstack-api).

```typescript
defineSeed(Invoice, {
  externalId: 'number',
  mode: 'upsert',
  columns: { status: { applyOn: 'create' } },
  records: [{ number: 'INV-001', status: 'draft', amount: 1200 }],
});
```

### `externalId` selection

**Never use `id`** for generated UUIDs — they
differ across environments.

| Scenario | Key |
|:---------|:----|
| Named entities (country, currency) | `'code'` / `'slug'` |
| Users / contacts | `'email'` |
| Externally sourced | `'external_id'` |

### Relationship references

For `lookup` fields, supply the target record's **natural key**. The
loader resolves it, and lookups order the load:
a child loads after its parent however the array lists them (array order
only breaks ties).

> If a lookup value matches no natural key, the loader falls back to
> resolving it as the target's `id`. Rely on it only for records you didn't
> seed (e.g. a system user).

```typescript
const contacts = defineSeed(Contact, {
  externalId: 'email',
  records: [{
    email: 'john@acme.example.com',
    first_name: 'John',
    account: 'Acme Corporation',
  }],
});
```

A `beforeInsert` hook reading a seeded object no lookup links to needs
`dependsOn: ['crm_rating_band']` (object names). Naming the dataset's own
object, one no dataset of the load seeds (misspelt, or `env`/`locale`-scoped
out), or a cycle refuses the whole load; nothing is written.

**Seed rows obey the object's validation rules** (all but `state_machine`); a
refused row never lands. `os validate` does not run them on seed rows;
`os verify` fails on each dropped row. A rule reading a parent roll-up
(`record.invoice.amount_paid`) sees the total earlier rows left, so children
must fit in record order. ⛔ Never seed the roll-up: a seeded `amount_paid` is
stored as written, and a cap on payments then refuses them all.

### Dynamic values (CEL)

Any field value may be a CEL expression evaluated at install time against
a single per-load pinned `now`. This is the **only** correct way to author
time-based or identity-derived seed values — `new Date()` ships the package
author's clock to every customer.

```typescript
import { cel } from '@objectstack/spec';

defineSeed(Opportunity, {
  records: [{
    name:            'Acme Q3 Renewal',
    close_date:      cel`daysFromNow(45)`,
    created_at:      cel`now()`,
    owner_id:        cel`os.user.id`,   // installer
    organization_id: cel`os.org.id`,
  }],
});
```

Stdlib in seed context: `now()`, `today()`, `daysFromNow(n)`, `daysAgo(n)`,
`isBlank(v)`, `coalesce(v, fallback)`. Scope: `os.user`, `os.org`, `os.env`.
See **objectstack-formula** for the full contract.

**Determinism gate:** two `os build` runs with no source change must
produce byte-identical `dist/objectstack.json`.

### Seed best practices

| Practice | Why |
|:---------|:----|
| TypeScript: `defineSeed()`, never `SeedSchema.parse()` | Lose compile-time field checks otherwise |

**Fictional is fine; malformed is not.** A seed row passes the same field
validation as a user's insert; a refused value leaves the table short or empty
while sibling rows point at records that do not exist.
`os validate` / `os build` refuse such a value first, at the
record's field — run them before trusting the load. So never mask or
placeholder a sample value: no `138****4207`,
`***`, `XXX`, `N/A`, `—`, `TBD`. Invent a plausible well-formed one — `+86 138
0013 8000` for a `phone`, `liyy@example.com` for an `email`,
`https://example.com/a` for a `url`; a `select` value is an option `value`,
never its label. Never downgrade a field type (an `address` to `text`) to make a
seed load.
