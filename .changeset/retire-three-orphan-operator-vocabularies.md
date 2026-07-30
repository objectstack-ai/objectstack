---
"@objectstack/spec": major
---

refactor(spec)!: retire three orphan operator vocabularies (objectui#2945 Track A)

An audit of every comparison/aggregation vocabulary the spec ships
(objectstack-ai/objectui#2901) found the operator vocabularies had multiplied
past what any code consults. Three had **no importer at all** — not in this
repo, not in objectui, not in cloud — and each contradicted the vocabulary that
is actually enforced. Removed rather than reconciled: a second name for one
concept is how they drifted apart in the first place.

**`AggregationFunctionEnum`** (`shared/enums.zod.ts`). Its own doc comment
claimed it was *"used across query, data-engine, analytics, field"*. It was used
by nothing. `AggregationFunction` (`data/query.zod.ts`) is the vocabulary the
query engine, `service-analytics`' dataset compiler and the native-SQL strategy
all gate on — and the two disagreed: this one carried
`percentile`/`median`/`stddev`/`variance`, that one carries
`array_agg`/`string_agg`. It also exported a *type* named `AggregationFunction`
while `data/query.zod.ts` exports a *value* of that name, so the two occupied
the same identifier in different declaration spaces with different members.

**`FilterOperator`** + `EventFilterCondition` + `EventFilterSchema`
(`api/websocket.zod.ts`), reached from `EventSubscriptionSchema.filters`. No
runtime ever evaluated an event filter — `matchesSubscription` matches on object
name and event type only (`contracts/realtime-service.ts`) — and the
subscription shape the transports actually carry is the separate, deliberately
unvalidated `filters: z.unknown()` on `SubscriptionEventSchema`
(`api/realtime.zod.ts`). So this was a *second* modelling of event filtering
that described a capability no code provided: a subscriber who set `filters`
received every event regardless.

The `filters` **key stays**, now typed `z.unknown()` with the same
NOT-YET-ENFORCED marker as its `api/realtime.zod.ts` counterpart. Retiring an
object key requires a tombstone plus a conversion (ADR-0104), which is the right
rule and the wrong trade here — there is no author to migrate for a shape nothing
validated, and Track A is meant to carry no migration. The two subscription
surfaces now describe event filtering identically, and neither implies an
enforcement that does not exist. Whichever grows real filtering should lower onto
`AST_OPERATOR_MAP` rather than reintroduce a vocabulary of its own.

**`ODataFilterOperatorSchema`** (`api/odata.zod.ts`). Nothing parses an OData
`$filter` against it — `$filter` is carried as an opaque string on
`ODataQuerySchema` and as the `odata` adapter template in
`query-adapter.zod.ts` — and an enum mixing operators with `(`/`)` could not
validate an expression anyway, since it describes tokens, not a grammar. A real
implementation needs a parser, and that parser should lower onto
`AST_OPERATOR_MAP` like every other entry point.

**Breaking, in the narrowest sense.** All three were reachable as public
exports (`@objectstack/spec/shared` and `@objectstack/spec/api`), so this is a
`major`. No consumer exists to break: verified by grep across framework
`packages/` + `apps/`, objectui, and cloud. Nothing is *narrowed* — no accepted
value stops being accepted, so no already-stored metadata or in-flight payload
changes meaning. That is what made this the one track of objectui#2945 that was
safe to start; narrowing `VALID_AST_OPERATORS` or retiring a
`VIEW_FILTER_OPERATORS` alias is not, and remains blocked on #3948.

The generated artefacts move with the deletions, as the ratchets require:
`json-schema.manifest.json` drops the five unpublished schemas,
`authorable-surface.json` the seven keys of the two deleted objects,
`api-surface.json` the eight exports, and the three reference-doc pages are
regenerated.

Verified: full `@objectstack/spec` suite **6917 tests across 266 files**, plus
`tsc --noEmit`, `check:docs`, `check:api-surface`, `check:authorable-surface` and
`check:skill-docs`, all clean.
