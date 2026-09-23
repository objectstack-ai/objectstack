## Seed Data & Fixtures (`defineSeed()`)

Object definition and seed data live together — a `*.object.ts` usually
pairs with a `*.seed.ts` (fixtures, reference rows, bootstrap data).
`defineSeed()` is type-safe: TypeScript checks every record's field keys
against the object definition.

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
  mode: 'upsert',
  env: ['dev', 'test'],
  records: [
    { slug: 'electronics', name: 'Electronics' },
  ],
});

export const SeedData = [statusSeed, categorySeed];   // parents first
```

### `Seed` fields

| Field | Default | Purpose |
|:------|:--------|:--------|
| `object` | derived | Auto-set from `objectDef.name` — never write manually |
| `externalId` | `'name'` | Stable business key used for upsert / update lookup |
| `mode` | `'upsert'` | Import strategy (see below) |
| `env` | `['prod','dev','test']` | Environments where the seed loads |
| `records` | — | `Partial<Record<keyof object.fields, unknown>>[]` |

Full Zod shape: `node_modules/@objectstack/spec/src/data/seed.zod.ts`.

### Import modes

| Mode | Behavior | Use for |
|:-----|:---------|:--------|
| `upsert` (default) | Update by `externalId`, insert if missing. Idempotent. | Reference data, bootstrap rows |
| `insert` | Insert all; fail on duplicate `externalId`. | Append-only / audit tables |
| `update` | Update only existing rows; never create. | Patching existing config |
| `ignore` | Insert; silently skip duplicates. | Additive bootstrap |
| `replace` ⚠️ | Delete everything, then insert. **Data loss.** | Cache / lookup tables only — never user data |

### `externalId` selection

Pick a stable natural key. **Never use `id`** — UUIDs differ across
environments.

| Scenario | Key |
|:---------|:----|
| Named entities (country, currency) | `'code'` / `'slug'` |
| Users / contacts | `'email'` |
| Externally sourced | `'external_id'` |
| Generic | `'name'` (default) |

### Relationship references

For `lookup` fields, supply the **natural key** of the target record (not
its UUID). The seed runner resolves at load time. Order seeds so parents
appear before children in the exported array:

> If a lookup value matches no natural key, the loader falls back to
> resolving it as the target's `id` — so a reference to an existing record
> by internal id resolves instead of dangling to null. Natural keys remain
> the portable default; rely on the id fallback only for records you didn't
> seed (e.g. a system user).

```typescript
const contacts = defineSeed(Contact, {
  externalId: 'email',
  records: [{
    email: 'john@acme.example.com',
    first_name: 'John',
    account: 'Acme Corporation',   // natural key of an Account record
  }],
});
```

### Dynamic values (CEL)

Any field value may be a CEL expression evaluated at install time against
a single per-load pinned `now`. This is the **only** correct way to author
time-based or identity-derived seed values — `new Date()` ships the package
author's clock to every customer and breaks build determinism.

```typescript
import { defineSeed } from '@objectstack/spec/data';
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

**Determinism gate:** two consecutive `os build` runs with no source
changes must produce byte-identical `dist/objectstack.json`. CEL + pinned
`now` is what guarantees that — using `Date.now()` will fail CI.

### Seed best practices

| Practice | Why |
|:---------|:----|
| Always use `defineSeed()`, never `SeedSchema.parse()` | Lose compile-time field checking otherwise |
| Prefer natural keys (`code` / `email` / `slug`) | Portable across environments |
| Default to `upsert` | Idempotent re-runs |
| Scope demo data with `env: ['dev','test']` | Keep noise out of prod |
| Order seeds parent → child in the exported array | References resolve at load time |
| Use `replace` only on cache/lookup tables, with comments | Data-loss footgun |
