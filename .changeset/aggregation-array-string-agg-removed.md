---
"@objectstack/spec": major
"@objectstack/objectql": minor
"@objectstack/service-analytics": patch
---

refactor(spec)!: retire `array_agg` / `string_agg` from `AggregationFunction` — `count_distinct` deliberately kept (#6188, ADR-0049)

`AggregationFunction` declared eight functions; the SQL family compiles five.
`SqlDriver.mapAggregateFunc` and the Turso `RemoteTransport.aggregate` each lower
`count`/`sum`/`avg`/`min`/`max` and route everything else to one refusal, so
three of the eight were declared-but-unenforced against the backends this
platform targets — and, worse, the *set* each backend implemented was different,
so "which aggregations can I use" had no answer an author could read off the
schema.

What makes these two sharper than an ordinary inert declaration is that another
package had to carry a denylist for them. `service-analytics` subtracted
`array_agg` and `string_agg` by name in `UNSUPPORTED_AGGREGATES`, because
without that subtraction they reached the Cube strategy's `default` and came
back as `COUNT(*)` — **a row count in place of the value the author asked for**,
with no error and no log (objectui#2945).

**The three unlowered functions were SPLIT, not retired as a block** (maintainer
ruling, 2026-08-07):

- **`count_distinct` STAYS** and takes ADR-0049's *enforce* leg. It is a
  dashboard staple with one portable lowering (`COUNT(DISTINCT x)`), and
  `service-analytics` lowers it already; the SQL-driver implementation follows
  on its own card. Its declaration leads its implementation here by decision,
  not by drift.
- **`array_agg` / `string_agg` take the *remove* leg.** Display conveniences
  with no measured pull, and `string_agg` never had one shape to lower to at
  all: the delimiter is a second argument in PostgreSQL, a `SEPARATOR` clause in
  MySQL and a differently named function in SQL Server.

FROM → TO, both authoring surfaces:

| Was | Now |
|:--|:--|
| `aggregations: [{ function: 'array_agg', field: 'tag', alias: 'tags' }]` | no replacement — read the rows with an ordinary `fields` query and shape them in the caller, or materialise the roll-up as a stored field |
| `aggregations: [{ function: 'string_agg', field: 'name', alias: 'names' }]` | as above |
| `measures: [{ name: 'tags', aggregate: 'array_agg', field: 'tag' }]` | delete the measure — `compileDataset` already refused it by name, so it never produced a number |

The retirement kit:

- This is an enum **VALUE** retirement, so there is no `retiredKey()` tombstone:
  the enum's own error map carries the prescription, keyed on the received value
  so that only the two spellings which used to be legal are told they "were
  removed" (the `crypto.hash` / `HookBodyCapability` precedent, #4391). A
  mis-spelling still gets zod's list of the legal functions. For the same reason
  nothing lands in `RETIRED_KEYS_BY_MAJOR` and the four surface ratchets are
  byte-identical — no def and no authorable key changed.
- **ADR-0087 D2 conversion + D3 chain step**
  (`dataset-measure-array-string-agg-removed`): `os migrate meta --from 16`
  drops any `dataset.measures[]` declaring a retired aggregate, plus any derived
  measure the drop strands, with a notice each. The measure is dropped rather
  than stripped down because one with neither `aggregate` nor `derived` fails
  the dataset's own refinement — a conversion whose output cannot parse is worse
  than none.
- **D3 semantic entry** (`query-array-string-agg-retired`) for
  `QueryAST.aggregations[].function`: a request surface, never stored, so there
  is no source for the chain to rewrite and callers move their own queries.
- The engine's in-memory fallback (`@objectstack/objectql`) drops its arms for
  both functions — a `switch` case on a value the enum no longer has does not
  type-check, and a dead arm is how a retired vocabulary returns by accident.
- `service-analytics`' `UNSUPPORTED_AGGREGATES` is now **empty and kept**: it is
  half of an arithmetic the lockstep suite enforces (`SUPPORTED = spec
  vocabulary − this`), which is what stops the next aggregate added to the spec
  from silently reaching that `COUNT(*)` default.

**Behaviour that actually changes** — this is the rare narrowing that removes
reachable behaviour, and it is worth stating plainly: on `driver-mongodb` and on
the engine's in-memory fallback these two DID compute. A raw QueryAST
aggregation against those backends returned an array or a joined string and will
now be refused at parse. That unpredictability is precisely what the ruling
ended — an aggregation that worked on one backend and failed on another is not a
capability — and both of those backends are inside the #5499 freeze. Their code
is untouched; it is simply no longer reachable through a spec-valid request. On
the dataset path nothing changes: `compileDataset` refused both by name already.

<!-- adr-0087: registered query-array-string-agg-retired, dataset-measure-array-string-agg-removed -->
