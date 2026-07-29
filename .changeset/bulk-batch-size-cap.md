---
"@objectstack/spec": minor
"@objectstack/rest": minor
---

fix(spec,rest): the batch-size cap is enforced now, and each bulk endpoint has one Zod source (#3939)

`max 200` was declared in four places and enforced in one.

`batch.zod.ts` put `.min(1).max(200)` on `BatchUpdateRequestSchema`,
`UpdateManyRequestSchema` and `DeleteManyRequestSchema`, and the docs repeated
it — but no per-object bulk route validated against those schemas, so
`createMany` / `updateMany` / `deleteMany` / `/data/:object/batch` all accepted
an unbounded list. The only route that capped anything was the cross-object
`/batch`, and it checked the *configured* `maxBatchSize` rather than the
hardcoded 200 — so even the one enforcement point disagreed with the schema.

That stopped being cosmetic with #3897, which made `deleteMany` delete per id by
primary key (so `deleteBehavior` cascades run and every row gets its own
result). A 10k-id body is now 10k sequential engine round-trips inside a single
request, where before it was one statement that mostly failed anyway.

**The cap moved to the routes, and the schemas gave it up.** Batch size is
deployment policy — `RestServerConfig.batch.maxBatchSize`, 1..1000, default 200
— so a hardcoded bound in the spec could only ever be a second, wrong answer
(a deployment raising the limit to 500 would still have been refused at 200).
All five bulk routes now call one `enforceBatchSize` helper with the configured
value and answer with one envelope:

```json
{ "error": "Batch too large: 500 records (max 200)", "code": "BATCH_TOO_LARGE",
  "count": 500, "max": 200, "object": "account" }
```

The cross-object route is included: it used to answer with a bare `error` string
and no `code` for a client to key on.

**One Zod source per bulk endpoint (Prime Directive #7).** Each of these
endpoints had *two* schemas, and they had already drifted into disagreeing about
more than counts: `UpdateManyRequestSchema` described its rows with
`BatchRecordSchema`, whose `id` and `data` are optional because the generic
`/batch` route serves create (no id) and delete (no data) through the same
shape — so the declared contract accepted `{}` rows that `updateManyData`, which
reads `record.id` and `record.data` unconditionally, could never process. The
enforced shape lived in the *other* copy, in `protocol.zod.ts`.

The wire body is now the single source (`UpdateManyRequestSchema` /
`DeleteManyRequestSchema`, with the new `UpdateManyRecordSchema` for a row), and
the protocol schemas are that plus the `object` the route takes from the URL
path (#3933) — `UpdateManyRequestSchema.extend({ object })`. The derivation runs
that direction because `protocol.zod` already imports `batch.zod`; the reverse
would be a cycle.

**Behaviour changes.**

- A bulk request over the configured cap is `400 BATCH_TOO_LARGE` instead of
  being executed. Deployments that were quietly relying on unbounded batches
  should raise `batch.maxBatchSize` (up to 1000) rather than discover the cap in
  production.
- `.min(1)` is gone with `.max(200)`: an empty batch is a no-op returning
  `total: 0`, which is what these routes already did, rather than a validation
  error the schema claimed but nothing raised.
- `UpdateManyRequest` now types (and validates) `records` as
  `{ id: string; data: Record<string, unknown> }[]`. Callers already had to send
  that — the route has validated the strict shape since #3933 — but the declared
  type was looser.
- New export: `UpdateManyRecordSchema` / `UpdateManyRecord`.
