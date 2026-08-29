---
'@objectstack/driver-mongodb': patch
---

`driver-mongodb` refuses an aggregate function it does not lower, instead of
answering it as a silent SUM (#12818).

`buildAccumulator`'s `switch` on `agg.function` ended with
`default: return { $sum: fieldRef ?? 0 }`, so ANY name this driver does not
lower — a typo (`median`), a miscased spelling (`COUNT_DISTINCT`), a function
added to the contract but not to this file, or an unnarrowed `method` arriving
from `StrategyContext.executeAggregate` (#12776) — was answered as a **sum of
that column**, under the alias the caller asked for, with no error, no envelope
and no log. It is the worst available answer precisely because it is
arithmetically plausible: a dashboard tile renders the number without complaint,
so nothing downstream can tell "your function ran" from "your function was
silently replaced". The field-less spelling was quieter still — `{ $sum: 0 }`,
i.e. `0`, which reads as "no matching rows".

The refusal is the two-class ADR-0112 envelope both SQL faces already answer
with (#5907), first sentence for first sentence, so one condition cannot have
two wire identities depending on which backend served it:

- a name the Query Protocol does not declare answers `INVALID_QUERY` / **400**
  and names the declared vocabulary (`@objectstack/spec AggregationFunction`);
- a DECLARED name this backend does not lower answers `NOT_IMPLEMENTED` / **501**
  and names what it does lower. That class is empty today — every member of
  `AggregationFunction` lowers here — and is pinned as a positive assertion, so
  the day the spec grows a function this driver misses, the suite goes red
  rather than quietly stopping to cover anything.

Judged case-sensitively, which is what the enum is: `COUNT_DISTINCT` is not
`count_distinct`, and telling its author the backend has a capability gap would
be false.

**Graded `patch`, deliberately.** No correct query's answer moves: all six
declared functions and the two retired ones this face still lowers
(`array_agg` / `string_agg`, an existing divergence from the SQL faces, recorded
and filed as #13075 rather than closed here) are byte-identically unchanged,
pinned by controls that compute their values in the same suite. The only inputs
whose behaviour changes are ones this driver was already answering *wrongly*, so
there is no working capability being removed — the same shape, in this same
package, that #10576's per-aggregation-`filter` refusal shipped as a patch.

Nothing to migrate. A caller that was reaching the old `default` arm was reading
a SUM in place of the function it asked for; the refusal now names the function
and the remedy.
