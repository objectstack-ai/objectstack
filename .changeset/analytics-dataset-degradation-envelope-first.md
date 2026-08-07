---
"@objectstack/service-analytics": patch
---

fix(analytics): a dataset refusal that declares an ADR-0112 envelope is never degraded to an empty result (#5717)

`queryDataset` wraps execution in a catch that exists for one deliberate reason
(#5033): a widget whose backing object is not mounted in this kernel renders
"no data" instead of failing with a 500. The criterion for "not mounted" was
`isMissingSourceError` — a substring match over the error MESSAGE. So the
leniency was available to any error that happened to phrase itself like a
driver, and #5352 / #5367's finding on the REST face — "the wire shape of an
error family must not be a property of its wording" — applied here one level
worse: the outcome was not a wrong status code but a **silent empty result**.
No exception, no 4xx, no 5xx; one `warn` line and a confident empty chart, which
is the "populated table, Total Spend: 0" symptom #5033 was filed about.

One refusal already matched. `dataset-compiler.ts` refuses an `include` naming a
relationship the object graph does not have with

> `[dataset-compiler] dataset "X" includes relationship "R" which does not exist on object "O".`

which carries both `relation` (inside "relationship") and `does not exist` — and
that conjunction was the postgres limb. It has never gone off for one reason:
`queryDataset` compiles **before** the try, so that throw has never been inside
the catch's reach. A mine, wired and unarmed.

**Two independent defences, so the disarming does not depend on either one.**

- **The criterion (main change).** An error carrying an ADR-0112 envelope —
  numeric `status` + non-empty `code`, the same structural fact
  `rest-server.ts`'s `/analytics/dataset/query` catch reads — is re-thrown
  untouched, ahead of any message inspection. Its producer already answered the
  classification question. The status RANGE is deliberately not part of the
  test: a `DATASET_INVALID` / 400 rendered as an empty grid is the loud case,
  but a declared 5xx (`READ_SCOPE_COMPILE_FAILED` — an RLS lowering that failed
  closed) is if anything worse to swallow, since nobody is told at all.
- **The sniffer.** Its postgres limb is now anchored to postgres's actual
  wording (`relation "x" does not exist`) instead of "any sentence containing
  both words" — the same pattern the sibling `missingSourceRelation` already
  used, so "is something missing" and "what is missing" can no longer disagree.

**Observable behaviour change — read this if you alert on empty widgets.** The
guarantee is new, not the status of any shipped message: measured over the 13
real wordings this repo carries (three driver families including sql-prefixed
and schema-qualified forms, the framework's not-registered signals, and this
package's own refusals), exactly one verdict moves — the compiler refusal above,
which reaches callers as `400 DATASET_INVALID` either way because its throw site
sits outside the try. What changes is that a caller-shaped refusal raised
**during execution** can no longer become `{rows: [], fields: [], totals: []}`
by phrasing alone: it now propagates and the route answers its declared code
(4xx as itself, declared 5xx through `ANALYTICS_QUERY_FAILED`). A dashboard that
silently rendered an empty chart for such a refusal will now surface the error.

**#5033's leniency is untouched, and that is asserted rather than claimed.** A
bare driver error is still classified by its words and still degrades: `no such
table` (sqlite/libsql), postgres's real `relation "x" does not exist`, mysql's
`doesn't exist`, the framework's not-registered signals — and a bare error
naming a JOINED table still fails loudly as a cross-datasource dataset. Those
cases are green in all four states of the reverse verification
(`dataset-degradation-envelope.test.ts`), including with both defences reverted.

The compile point deliberately stays outside the try. Moving it in would newly
expose the compiler's own bare invariants and the host-supplied relationship
resolver to this degradation path — widening leniency in the opposite direction
from the fix.
