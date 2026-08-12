---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): refuse a dotted `fields`/`$select` entry instead of widening the response to every field (#7532)

`POST /api/v1/data/:object/query` with `{"fields":["name","account.name"]}` answered
`200` carrying **every** business field — strictly more data than was asked for — and
no resolved `account.name`. `GET /api/v1/data/:object?$select=name,account.name` did
the same. A parameter whose entire purpose is to return LESS had "return more" as its
failure mode, pointing away from both FLS and data minimisation.

`assertProjectionFieldsExist` validated only `f.split('.')[0]`, so a dotted entry
cleared the #4226 unknown-name gate on its **head** segment (`account` really is a
field) and travelled on to the driver as a projection column. Measured on a real
`SqlDriver` (better-sqlite3):

```
no projection                  -> account amount created_at id name status updated_at
fields ['name']                -> name                        (a plain name narrows)
fields ['name','account.name'] -> account amount created_at id name status updated_at
fields ['account.name']        -> account amount created_at id name status updated_at
```

The dotted rows are byte-identical to no projection at all. Knex renders
`"account"."name"` against a table that was never joined, sqlite answers `no such
column`, and the driver's #3821 recovery ladder retries `select('*')` because rows
matter more than the projection.

A dotted entry on this axis is now `400 INVALID_FIELD`, with the `unknown` > `dotted`
precedence {@link assertSortFieldsExist} already applies, so the two axes report the
same complaint first. The message names the relationship it tried to cross and sends
the caller to `expand` — the sanctioned door for related data here — or to
denormalising the value onto the queried object. A dotted path whose head is a real
but non-reference column gets its own wording, since `expand` would be the wrong
prescription for it.

This also settles the second half of the report: an unknown **plain** column was a
`400` while an unknown **dotted** one was a `200` with every field, so one mistake got
opposite verdicts on one endpoint depending on how it was spelled. Both doors —
`POST /query` body `fields` and `GET ?$select=` — fold into the same slot before the
gate and are pinned separately.

Nothing that worked stops working: no driver ever resolved these paths. Plain
projections still narrow, unknown plain columns still refuse per #4226, an unknown
head still gets the unknown-name verdict with its did-you-mean, and `expand` still
delivers related records. The engine's internal-caller projection tolerance and
`SqlDriver`'s recovery ladder are deliberately untouched — refusing at ingress is what
stops a request reaching them with a projection no driver can apply.
