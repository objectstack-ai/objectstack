---
"@objectstack/objectql": patch
---

fix(objectql): an unscoped `GET /api/v1/search` stops answering 400 when a federated object is registered and pinyin recall is on — the `__search` companion is no longer declared on objects the platform runs no DDL for (#9469)

On the **stock** showcase configuration an unscoped `GET /api/v1/search` — no
`objects=` parameter — answered **400** for the whole search. Measured on a real
boot, with the scoped query as the control:

```
GET /api/v1/search?q=acme                            → 400 INVALID_FILTER
GET /api/v1/search?q=acme&objects=showcase_account   → 200, 1 hit
```

Nothing in the console was affected, because the console always scopes its
queries with `objects=`. An unscoped search is the obvious first call for a
direct API consumer, so the defect was reachable by every one of them and by no
console user.

**The mechanism, and why it is a producer bug rather than a search bug.** The
hidden `__search` companion column is not metadata — it is a real column the
platform promises to build: the SchemaRegistry declares it at object compile
time and the driver's `syncSchema` materializes it as an additive migration
(ADR-0045). On a **federated** object (ADR-0015) that promise cannot be kept.
The remote database owns the schema, DDL is forbidden, and the schema-sync seam
skips those objects outright. The declaration went on anyway, so the object
carried a field with no column — and `expandSearchToFilter`, which keys the
companion clause on the **declared** field, ORed `{ __search: { $contains: term } }`
into every `$search` against it. The backend then refused a statement it could
not compile, correctly (#8790): the predicate really could not run. From the
server log, verbatim:

```
select * from `customers` where ((lower(`name`) GLOB lower('*acme*')) or …
  or (`__search` GLOB '*acme*')) limit 5 - no such column: __search
```

Every source-column clause was fine; only the companion named a column that does
not exist. The unscoped call is the one that sweeps every registered object, so
it is the only global-search call that included a federated object — which is
why scoping hid it.

**The fix** is one gate at the provisioning seam: an object carrying an
`external` binding gets no companion declaration. The predicate is
`external != null`, deliberately the **same** expression the schema-sync seam
already tests rather than a second question about the same fact, so the two ends
agree by construction — every object the sync seam declines to build a column
for is exactly an object the provisioning seam declines to declare one on.
(Asking the datasource's `schemaMode` here instead would be a second
implementation of one rule, and the SchemaRegistry holds no datasource
definitions at all, so that drift would be structural rather than merely
possible.)

**Scope of the behaviour change**, all of it a restoration:

- unscoped `GET /api/v1/search` returns results instead of 400;
- `?search=` on a federated object's own list endpoint stops refusing — the same
  defect, on a call that never involved global search, and the reason the fix
  lands at the declaration rather than in the global-search sweep;
- federated objects are searched through their source columns, as they were
  before pinyin recall existed;
- pinyin recall is **unchanged** wherever the column is really built, and a
  federated object whose remote table genuinely has a `__search` column keeps
  its recall: the author declares that column as an ordinary field and
  provisioning returns early on an already-present entry.

`/meta` for a federated object no longer advertises a `__search` field it could
never serve.
