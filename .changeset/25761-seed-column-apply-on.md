---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/skills': minor
---

feat(spec,metadata-protocol): a seed dataset column can be written only when its row is created (`columns.<field>.applyOn: 'create'`)

Clause-②: yes
Metadata-protocol: added

A seed is replayed on every dev-server boot and every package re-publish, and an `upsert` replay re-asserts every column a record declares on the row it matched. That reverts the columns an app's own jobs write after the first seed (a status a payment job advances, a flag a renewal job sets), so a re-run undid the jobs' work with nothing in the log.

A seed dataset now takes a per-column write policy, keyed by field name:

```ts
defineSeed(Instalment, {
  externalId: 'code',
  columns: {
    status:      { applyOn: 'create' },
    is_expiring: { applyOn: 'create' },
  },
  records: [{ code: 'INS-001', amount: 1200, status: 'pending', is_expiring: false }],
});
```

- **`applyOn: 'create'`** writes the column when the seed creates the row and leaves it out of every write to a row the seed matched by its `externalId`: an `upsert` replay over an existing row, and every row of an `update` dataset. The matched row keeps the value it holds, while the `always` columns are refreshed. A row whose only differences are create-only columns is not written at all. A create-only reference column on a matched row is not resolved and not deferred to pass 2, so nothing later in the load writes it back. A column of the `externalId` is the key the row was matched by and stays in its update. `insert`, `ignore` and `replace` never update a matched row, so nothing changes on those modes.
- **`applyOn: 'always'`** (the default, and every column without a `columns` entry) is the behaviour before this change.
- The values, the default and the meaning are those of the import door's `FieldMappingEntry.applyOn`. Both doors now read one enum, exported as `ColumnApplyOnSchema` from `@objectstack/spec/data`. `SeedColumnSchema` (with `SeedColumn` / `SeedColumnParsed`) is the per-column shape.
- A `columns` key must name a column the object has: a declared field, or a system column the platform injects on it such as `owner_id`. `defineSeed` refuses one that does not when it runs (and at compile time for an object literal), naming the key with a near miss. The seed loader warns once per dataset when a seed that did not come through `defineSeed` names one.
- `SeedSchema` refuses an unknown key on a column (`unrecognized_keys`), and a dataset-level `applyOn` is pointed at `columns`.

`@objectstack/skills` only regenerates its schema reference indexes, which now list `SeedColumnSchema` and `ColumnApplyOnSchema`.
