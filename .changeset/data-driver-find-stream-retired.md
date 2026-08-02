---
"@objectstack/spec": major
"@objectstack/driver-sql": major
"@objectstack/driver-memory": major
"@objectstack/driver-mongodb": major
---

refactor(spec,drivers)!: retire `IDataDriver.findStream` — a required method with no caller, whose two main implementations did the opposite of what it promised (#4484, ADR-0049 enforce-or-remove)

`findStream` was a **required** method on the driver contract — every driver and
every test double had to implement it — documented as the read

> Optimized for large datasets to avoid memory overflow.

Three things were true about it at once, and each is worse in the light of the
others.

**Nothing called it.** Not the query engine (there is no `stream` entry on it),
not REST export, not import, not any bulk-read path. Repo-wide, outside the
contract declaration and the three driver implementations, every single hit was
a test double — and roughly twenty of those satisfied the required method like
this:

```ts
findStream() { throw new Error('not implemented'); }
```

Twenty stubs that throw, across four packages, for years, and no test ever went
red. That is not an anecdote about test hygiene; it is the proof of absence. A
method whose every double throws is a method nothing reaches.

**Two of the three implementations inverted its one guarantee.** `SqlDriver` and
`InMemoryDriver` both did this:

```ts
const results = await this.find(object, query, options);  // ← the entire result set
for (const row of results) yield row;
```

The whole table is resident in memory before the first `yield`. A caller who
believed the doc comment and reached for `findStream` precisely because a result
set was too large would have hit the overflow it existed to prevent, at exactly
the scale where it mattered. `SqlDriver` carried a `TODO: Use Knex .stream()`
admitting it.

**The one real implementation dropped a parameter.** `MongoDBDriver._findStream`
did walk a cursor — but it was the only read in that driver never routed through
`buildFindOptions`, so it hardcoded `projection: { _id: 0 }` and silently
discarded `query.fields`. (#4459 unified `find`/`findOne` onto `buildFindOptions`
and recorded in its TSDoc that `_findStream` was left out. This removal subsumes
that divergence rather than fixing it — there is nothing left to fix it for.)

Rather than manufacture a caller to justify three implementations, the method is
retired. If a cursor-based read is wanted, it should arrive **with** the caller
that needs it, so the contract can be shaped by a real requirement instead of
being reverse-engineered from a doc comment nobody could test.

**Migration.**

| Wrote | Write instead |
| --- | --- |
| `for await (const row of driver.findStream(obj, q)) { … }` | page `driver.find(obj, { ...q, limit, offset })` in a loop |
| `findStream(…) { … }` on your own driver | delete the method (see below) |
| `findStream() { throw new Error('ni'); }` in a test double | delete the line |

Paging `find()` is not a downgrade from what `findStream` actually did: on SQL
and memory it is strictly better (bounded pages instead of one full
materialisation), and the paged read is the one with an **enforced** guarantee —
`IDataDriver.find` requires a total order across the whole walk, checked by the
shared `PAGINATION_CASES` / `PAGINATION_UNORDERED_CASES` fixtures in
`data/pagination-conformance.ts`. `findStream` never had a conformance case at
all.

**Driver authors: nothing breaks on you.** An implementation left in place still
compiles — an extra method is not an error on a class or a widened object — it is
simply never reached, so deleting it is cleanup you can do whenever. The break is
on the **caller** side: `driver.findStream(...)` no longer type-checks, and there
were no callers.

**No tombstone, deliberately.** The other v17 retirements tombstone their key so
authoring it fails loudly with a prescription. That would be noise here.
`DriverInterfaceSchema` describes a contract that code *implements*; nothing in
either repository ever ran a driver object through `.parse()`, so a
`retiredKey()` there would carry its prescription to no one. The channel that can
carry it is `tsc`, and `tsc` reports it where it is actionable — at a call site.
The key is removed from the schema and from `IDataDriver`, and the retirement is
registered as the `data-driver-find-stream-retired` semantic entry in the
protocol-17 chain step (ADR-0087 D3), so `spec-changes.json`, the generated
upgrade guide and the `spec_changes` MCP tool all carry it. There is no
`os migrate meta` step: a driver is code, never stack metadata, so the chain has
no source to rewrite.

**Left standing on purpose:** `DriverCapabilities.streaming`, the capability flag
whose only referent was this method. It has no readers either (and the values
written into it were already wrong — `SqlDriver` declared `streaming: false`
while implementing `findStream`, `InMemoryDriver` declared `true` for the
copy-everything version), but removing a key from the capabilities literal breaks
every driver that writes it, third-party included, and the same audit should
cover the other ~30 flags in one pass rather than one at a time. Tracked as
#4634.
