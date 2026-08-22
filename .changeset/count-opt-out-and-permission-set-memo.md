---
"@objectstack/metadata-protocol": minor
"@objectstack/plugin-security": patch
---

Stop issuing two DB queries for questions already answered earlier in the same
request (#10757). One authenticated `GET /data/:object?$top=1` measured **24 DB
queries before, 23 after** — **22** when the caller opts out of the count.
Measured with `X-OS-Debug-Timing: json` on `pnpm dev:crm`, whose `Server-Timing`
carries `db;dur=…;desc="N queries"`.

**`$count=false` now skips the COUNT query** (`@objectstack/metadata-protocol`).
The parameter has been declared (`ODataQuerySchema.$count`), aliased on the wire
(`$count` → `count`), reserved out of the implicit-field-filter bucket,
arity-checked and boolean-coerced for a long time — and then deleted unread, so
every paginated list ran `engine.count()` whether or not the caller wanted a
total. It is honoured now:

```
GET /data/task?$top=25              → { records, total, hasMore }   (unchanged)
GET /data/task?$top=25&$count=true  → { records, total, hasMore }   (unchanged)
GET /data/task?$top=25&$count=false → { records, hasMore }          (no COUNT query)
```

Read the shape of that carefully before adopting it:

- **Only an explicit `false` opts out.** An ABSENT `$count` still counts and
  still reports `total`. OData reads absent as "omit the count", and taking that
  reading here would silently strip `total` from every existing caller — none of
  them send the parameter, all of them read the number. The asymmetry is
  deliberate and pinned by tests.
- **`total` is OMITTED, never estimated.** `FindDataResponse.total` is declared
  optional ("if requested"), so absent is the declared shape for "not
  requested". A caller that opted out and then reads `total` gets `undefined`,
  not a plausible-looking guess — guard the read (`total ?? undefined`) or do
  not send `$count=false`.
- **`hasMore` is still answered**, from the page alone: a full page means there
  may be more. Same page-local rule the `$search` path already uses.

**A find and its COUNT resolve permission sets once, not twice**
(`@objectstack/plugin-security`). `findData` answers a paginated list with two
engine operations, and the security middleware runs on both; each pass re-read
`sys_permission_set` for the same context with identical bindings. The
resolution is now memoized per execution context — a `WeakMap` keyed on the
context object, which is built once per request and collected with it, so
nothing outlives the caller it was resolved for — and **retired by any write**:
a process-wide epoch is bumped on every `insert`/`update`/`delete` the engine
middleware sees, ahead of the `isSystem` bypass so a seeder, a package publish
or an auto-org-admin grant invalidates too. A context whose grants are rewritten
in place re-resolves as well (the memo key covers `positions`, `permissions`,
`principalKind` and the presence of `userId`). No authorization answer is reused
across a write, across a context, or across a request.

Not a fix for the whole cost: the remaining ~22 queries per authenticated
request are session resolution, grant resolution, localization and metadata
reads that repeat on every request. Removing those needs cross-request caching
with an invalidation design, which is deliberately not in this change.
