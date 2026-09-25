---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: both analytics doors refuse the two `$icontains` comparands `FILTER_TEXT_CASES` declares refused, an empty one and a non-string one, each door in its own envelope (#20068)

Clause-②: no (narrowing)

<!-- adr-0087: already-registered filter-icontains-comparand-refused-at-parse -->

**BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. An `$icontains` condition whose comparand is the empty string, or is not a string at all (a number, a boolean, `null`, a `Date`), used to compile on the analytics compilers. It is now refused before any SQL statement runs or any `engine.aggregate` call is made. It ships as `minor` under the launch-window convention for accept-set narrowings.

`@objectstack/spec` declares both refusals as data: `FILTER_TEXT_CASES` carries a REJECTION row for an empty `$icontains` comparand and one for a non-string comparand, each `INVALID_FILTER` naming `$icontains`. It publishes the discrimination as `isRefusedTextComparand` and the reason as `textComparandRefusalReason`. The spec's parse door (`FilterConditionSchema`) and `driver-sql` already refused both. This package never asked, so one filter got two answers. Both analytics doors now call the published predicate and seat the published reason in their own envelope.

| where the condition sits | before | now |
|:--|:--|:--|
| a caller's `where`, a dataset `filter` or a measure `filter`, either spelling, at any depth | `''` matched every row whose column has a value; a non-string was bound as its text and matched nothing. Native SQL, the `/analytics/sql` echo and `AnalyticsService.query` all served it | `INVALID_FILTER` / 400, with the spec's reason, naming `$icontains` |
| a row-level read scope, on the native SQL face and the echo | the same predicate: `''` admitted every row that has a value | `READ_SCOPE_COMPILE_FAILED` / 500, with the message withheld |
| a row-level read scope, on the ObjectQL face | the driver refused it as `INVALID_FILTER` / 400, and the message named the policy's field and comparand | `READ_SCOPE_COMPILE_FAILED` / 500, with the message withheld |

The migration is the ledger entry named above: write a non-empty string, or drop the condition. An empty comparand was a predicate that constrained nothing, so the repair is to delete the condition. A number, boolean or `null` comparand is written as the string it was meant to match, or the operator was the wrong one.

Over HTTP, `POST /api/v1/analytics/query`, `/analytics/sql` and `/analytics/dataset/query` already refused a caller-authored condition carrying either comparand, at their body parse (`400 VALIDATION_FAILED`). What this changes for an HTTP caller is the read scope. A row-level read scope supplied by the host (`getReadScope`) is refused in the withheld envelope on every analytics face. It is no longer served on the native SQL face, and it is no longer answered with a 4xx that carries policy content on the ObjectQL face. The CEL policy lowering never emits `$icontains`, and a filter placeholder never resolves to an empty string.

Who is affected: nothing in this repository's examples, seeds, docs or package sources authors either comparand; every hit outside tests is a code comment. Stored datasets, dashboard filters and host-supplied read scopes in a deployment were NOT measured. A stored row saved before the parse-door refusal can still carry an empty comparand, and it is now refused at query time, where it used to answer every row that has a value.

Not changed: a non-empty string comparand, whatever its case or content; an object or array comparand, still refused in its existing sentence; the non-text-column constant for an accepted comparand. `$contains`, `$notContains`, `$startsWith` and `$endsWith` keep their answer to an empty comparand: the table has no REJECTION row for them, and widening by analogy is the table's decision.
