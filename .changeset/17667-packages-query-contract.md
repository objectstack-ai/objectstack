---
'@objectstack/spec': minor
---

feat(spec): the `/packages` doors declare the query parameters they execute, and stop declaring the two they never did (#17667)

`GET /api/v1/packages` diverged from its own declared request contract in BOTH
directions, on the same door, with the same `200`. This aligns the declaration
with the reads, per the maintainer-approved ruling of 2026-09-13 (decision batch
#126 item 1, route 2 of three).

**BREAKING** — `limit` and `cursor` no longer parse on
`ListInstalledPackagesRequestSchema`, and `limit`'s `.default(50)` is gone with
them. Both were declared here and read by nothing: the serving door filters on
`status` / `type` and then returns every remaining row, so no page was ever
withheld and no continuation token was ever minted. The response half's
`nextCursor` has never been emitted, so a caller looping "until the cursor runs
out" re-read the first and only page forever, with no error and no `400`.

```
FROM  ListInstalledPackagesRequestSchema.parse({})
      -> { limit: 50 }                    // a cap the server has never applied
      ListInstalledPackagesRequestSchema.parse({ limit: 1, cursor: 'x' })
      -> { limit: 1, cursor: 'x' }        // both dropped on the wire, 200, every row

TO    ListInstalledPackagesRequestSchema.parse({})
      -> {}                               // no window is declared, because none exists
      ListInstalledPackagesRequestSchema.parse({ limit: 1 })
      -> throws: '`limit` / `cursor` were removed from GET /api/v1/packages in
                  @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) …'
```

**Read the removed default, not just the removed key.** `limit` carried
`.default(50)`, so a reader of the published schema — an SDK, codegen, an AI
client — was entitled to believe an unparameterised list is capped at 50 rows.
It has never been capped at all. Nothing parses a query string through this
schema, so that default has never been stamped onto anything; there is nothing
to send instead and nothing to restore. **A client that sized a buffer or a
page control to the declared 50 should size it to the installed set instead** —
which is a bounded table of tens of rows, which is also why paging was removed
rather than implemented.

Both keys are `retiredKey()` tombstones rather than deletions: the schema is not
`.strict()`, so a bare deletion would have made Zod silently strip whatever a
generated client kept sending — a clean parse and a parameter that never takes
effect, which is this defect re-created one layer down (ADR-0104). Writing
either key is now a `tsc` error and a parse error carrying the prescription.

**The other direction, and nothing on the wire changes for it.** Three query
parameters the doors already executed were declared by no request schema, so
they were invisible to anything generated from the contract:

| door | parameter | now declared on |
|---|---|---|
| `GET /api/v1/packages` | `type` — exact match against `manifest.type` | `ListInstalledPackagesRequestSchema` |
| `GET /api/v1/packages/:id` | `version` — exact installed-version scope; `latest` reads the installed row | `GetInstalledPackageRequestSchema` |
| `DELETE /api/v1/packages/:id` | `keepData` — keep object tables, remove metadata only | `UninstallPackageApiRequestSchema` |

No accept set moves: the doors served all three before and serve them
identically now. `overwrite`, the fourth parameter the ruling named, was already
declared on `PackageInstallRequestSchema` and needed nothing.

**`hasMore` stays the constant `false` it already was, and is now true by
construction rather than by coincidence**: with no `limit` and no `cursor` to
ask with, nothing can request a page, so there is never a next one to announce.

Clause-②: yes

<!-- adr-0087: registered packages-list-pagination-retired -->
