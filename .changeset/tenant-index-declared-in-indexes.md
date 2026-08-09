---
"@objectstack/objectql": patch
"@objectstack/driver-mongodb": patch
---

fix(objectql,driver-mongodb): declare the tenant index in `indexes[]`, so a registry-backed object stops reporting itself invalid (#6810)

`applySystemFields` provisioned the injected `organization_id` column with
`indexed: opts.multiTenant`. `indexed` is **not a `FieldSchema` key** — #2377 /
ADR-0049 removed it because a field-level index flag built no index — and
`FieldSchema` is a `strictObject`, so a field carrying it is rejected **by
name**, with a purpose-written message.

`registerObject` runs `applySystemFields` *before* storing and
`getItem('object', …)` serves that post-injection document, so the key travelled
all the way out to `/meta`, where `decorateMetadataItem` re-parsed the served
body and stamped the verdict on it. Measured on every registry-backed object, in
**both** tenancy modes, at **both** read exits:

```
_diagnostics: { valid: false,
  errors: [{ path: 'fields.organization_id', code: 'unrecognized_keys' }] }
```

`_diagnostics` is what Studio renders invalid-metadata banners from and what an
AI author reads to judge a document it produced. So the platform was reporting a
defect on its own column — one the author never wrote and could not fix — and
making the verdict useless as a signal on those objects, because a real
authoring error was indistinguishable from this one.

**Two directions, both of them user-visible:**

- **The false `valid: false` verdict is gone.** A tenancy-enabled object
  registered through the real `SchemaRegistry` now reads back
  `_diagnostics: { valid: true }` at both `/meta` exits, in both tenancy modes.
  Nothing else about the served field changed — `type`, `reference`, and the
  governance keys that decide who may write it are byte-identical.
- **The tenant index moved from a field-level flag to `indexes[]`**, the one
  surface an index is declared on in this system. On a multi-tenant stack the
  object now declares `{ fields: ['organization_id'] }`; on a single-tenant
  stack it declares **nothing** — the absence *is* what `indexed: false` used to
  say, since nothing filters by organization on an unwalled stack.

This is also the first time the intent is actually **enforced**. The sole reader
of the old flag was one line in `driver-mongodb`; `driver-sql` — which every
walled deployment runs — only ever materialized `indexes[]`, so the wall's
hottest predicate ran unindexed no matter what the flag said. Expect the tenant
index to now appear as ordinary index drift on existing SQL tables
(`idx_<table>_organization_id`), created by `os migrate apply` or by the
`autoMigrate: 'safe'` path in dev, like any other declared index.

`driver-mongodb` reads declared `indexes[]` in place of the retired flag. The
generated index name matches the field-level convention already in that file
(`idx_<fields>` / `idx_<fields>_unique`), so a re-synced collection finds its
existing `idx_organization_id` rather than building a second index under a new
name. Declarations are materialized over their columns **verbatim** at every
`unique` scope, `'organization'` included — the same call the driver's
field-level `unique` documents, because it implements no row-level tenancy and
refuses to boot into a multi-tenant deployment (#3724).

No `FieldSchema` change: re-declaring `indexed` would restore exactly the
declared-but-unenforced key #2377 removed.
