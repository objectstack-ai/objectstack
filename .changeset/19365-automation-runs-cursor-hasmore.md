---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/service-automation': minor
'@objectstack/client': minor
---

feat(automation): `GET /automation/:name/runs` retires `cursor` and computes `hasMore` (#19365)

This door declared a pagination parameter it never spent and then reported, as a
literal, that there was nothing more to fetch. Both halves are closed here, per
the maintainer-approved ruling of 2026-09-21 (decision batch #204 item 2,
letter C of three).

**BREAKING** — `cursor` no longer parses on `ListRunsRequestSchema`, its slot
is gone from `IAutomationService.listRuns`, and `@objectstack/client` no longer
declares or sends it on any of the three run-list surfaces
(`automation.runs.list`, `automation.listRuns`,
`client.environment(id).automation.listRuns`). It was declared on the wire,
*validated* at the boundary, forwarded into the service contract, appended by
the SDK, and read by no implementation. No emit site has ever written the
response half `nextCursor`, and the only ordering this door has is an optional,
non-unique `startedAt` — not a resume point anything could have been built
on — so a caller looping "until the cursor runs out" re-read the first and only
window forever, with no error.

```
FROM  ListRunsRequestSchema.parse({ name: 'f', cursor: 'n_007' })
      -> { name: 'f', limit: 20, cursor: 'n_007' }   // forwarded, then dropped

TO    ListRunsRequestSchema.parse({ name: 'f', cursor: 'n_007' })
      -> throws: '`cursor` was removed from GET /api/automation/:name/runs in
                  @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) …'
```

`cursor` is a `retiredKey()` tombstone rather than a deletion: the request
schema is not `.strict()`, so a bare deletion would have made Zod silently strip
whatever a generated client kept sending — a clean parse and a parameter that
never takes effect, which is this defect re-created one layer down (ADR-0104).
Writing the key is now a `tsc` error and a parse error carrying the
prescription.

**The SDK is retired in the same stroke, and that is what makes the sentence
above true.** Retiring the key in the schema alone would have left the one
generated client this repo ships typing it `string` and sending it into a route
that no longer reads it — the exact ADR-0104 shape the tombstone exists to
prevent, re-created one layer down, for the channel most callers actually reach
this door through. So the option is gone from all three surfaces and no
`?cursor=` is appended on any of them; an untyped caller cannot smuggle it past
the retired schema either, which is pinned. Same call as when #6361 retired the
notifications `cursor`: the client dropped the option and recorded the removal
in its docblock.

```
FROM  client.automation.runs.list('f', { limit: 5, cursor: 'abc' })
      -> GET …/automation/f/runs?limit=5&cursor=abc   // the key is dropped server-side

TO    client.automation.runs.list('f', { limit: 5 })
      -> GET …/automation/f/runs?limit=5
      // `{ cursor }` is now a TS2353 excess-property error; widen `limit`
      // (1..100) and read `hasMore` instead.
```

**⛔ `limit` is NOT retired, and its `.default(20)` stays.** The sibling
`/packages` door retired *its* `limit` alongside `cursor` (#17667) because
nothing read it. That does not transfer, and the ruling says so explicitly: here
`limit` is read end to end — the HTTP boundary enforces the declared `1..100`
range read off the schema itself, the service takes it as an option, and the
engine spends it as the run store's history window. Retiring it would have been
a regression, not a narrowing.

**`hasMore` is now computed, and this is a behaviour change callers can see.**
The door shipped `{ runs, hasMore: false }` with the `false` written as a
literal, beside a list the engine had already cut with `.slice(0, limit)`. A
caller asking for one row of a thousand was handed one row and told that was all
of them. A request whose window is shorter than the matching run set now
receives `hasMore: true` where it previously received `false`; a caller that
read `false` as "this is the whole history" was always wrong and is now told so.
`nextCursor` stays absent — nothing mints one.

Read the new `false` with **one qualification**: unfiltered it is exact, but
under `?status=` it means "no further match inside the window that was scanned"
rather than "none exists", because the durable history source has no status slot
and the window is taken before the filter is applied. Pushing the filter down is
a `RunStore` contract change this card did not scope. The published
`RunListResult.hasMore` docblock and the response schema's own description both
carry that qualification, so a consumer meets it where they meet the field.

**How truncation is established, because the obvious signal is wrong.**
`runs.length === limit` cannot tell a flow holding exactly `limit` runs from one
holding ten thousand; the two windows are byte-identical. So
`AutomationEngine` over-reads its history source by exactly one row and compares
the merged, filtered, ordered set against the caller's window.
`RunStore.listHistory`'s signature is deliberately unchanged — over-reading is
expressible in the `limit` it already takes.

**New:** `IAutomationService.listRunsPage`, an optional member returning
`{ runs, hasMore }` (the shape `IExportService.listExportJobs` already uses,
minus the cursor nothing mints), plus the exported `RunListResult`. The engine
implements it and `listRuns` is its `runs` half, so there is one implementation
and no second copy to rot. A deployment whose automation service does not
implement it answers `501` naming the member, never a `200` carrying a guessed
`hasMore`.

**One strictness regression, stated because it reverses a recorded decision.**
`?cursor=a&cursor=b` used to answer `400 VALIDATION_FAILED` and now answers
`200` with the key ignored, like any other unrecognised query name. #7300
validated the key rather than deciding it, so that a future cursor
implementation would not be the one to discover the type was unenforced; this
ruling decides it instead — there will be no cursor implementation on this
door — so the refusal would be validating a key the contract no longer has.
This route declares no closed query-parameter set, so an unrecognised name has
never been refused here on its own account.

Clause-②: yes

<!-- adr-0087: registered automation-runs-cursor-retired -->
