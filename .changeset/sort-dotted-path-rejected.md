---
"@objectstack/metadata-protocol": patch
---

fix(data): a dotted-path `sort` (`?sort=account.company_name`) is rejected with `400 INVALID_SORT`, not silently unapplied (#4256)

The one sort shape #4226 deliberately left open is now closed. A dotted path
passed the sort gate on its head segment (`account` is a real field) and was
then unusable by every driver: `SqlDriver` handed it to Knex, which rendered
`"account"."company_name"` against a table that was never joined, and the
#3821 unknown-column backstop retried **without the sort**; Mongo and the
memory driver resolved the path against the row itself, where a foreign key is
a scalar id. Result: `200`, every row present, arbitrary order — and since
`sort` + `top` is how a caller asks for "the latest N", an arbitrary N with
nothing in the response to reveal it.

The rejection distinguishes the two mistakes a dotted path can be:

- a head that IS a relationship (`project_id.name`) — the message names the
  relationship it tried to cross and prescribes the supported alternative:
  denormalise the value onto the queried object (formula or rollup field) and
  sort by that;
- a head that is not (`title.length`) — the message states the contract: sort
  reaches only whole columns of the queried object, not values inside them.

An unknown head (`no_such.title`) keeps the existing typo-shaped answer, and a
list carrying both mistakes reports the typo first — the same precedence the
expand gate uses.

**What changes for callers:** requests whose sort crosses a relationship now
fail loudly instead of receiving an ordinary-looking 200 over unordered rows.
A survey of framework, objectui and cloud found zero callers emitting a dotted
sort (objectui's column-header sort keys lookup columns by their flat field
name and loads relations via `$expand`), so the practical blast radius is
hand-authored requests — exactly the callers the silent degradation was
misleading. Internal callers reaching `engine.find()` directly are unaffected,
the same tiering every #4226 gate uses.
