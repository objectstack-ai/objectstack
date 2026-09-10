---
"@objectstack/driver-memory": minor
---

fix(driver-memory): a scalar comparand against a stored ARRAY is read as membership on both filter faces, so a filter written to narrow stops returning rows it never selected (#16838)

`memory-matcher.ts`'s equality arm ended in `value == condition`. Loose `==` converts a stored ARRAY to a primitive — `['a','b']` becomes the string `"a,b"` — so this package's reference matcher and its live query path (`InMemoryDriver.find`, through mingo) answered the same filter two different ways, in both directions at once:

| filter | stored value | reference matcher, before | live query path |
|---|---|---|---|
| `{ tags: 'a' }` | `['a','b']` | no row | the row |
| `{ tags: 'a,b' }` | `['a','b']` | the row | no row |
| `{ tags: 'a' }` | `['a']` | the row | the row |

The second row is the sharper one: a **false positive**, a filter written to narrow returning a row it should not, which on a read scope is a permission concern rather than a degraded filter. The first is fail-open in the other direction and just as silent — `if (!rows.length)` cannot tell "genuinely none" from "the predicate asked the wrong question".

**What changes.** A stored array is now read as its elements, and each is asked the question the arm asks of a scalar: the answer for a row storing an array is the OR of the answers for the rows storing its elements. That is MongoDB's array semantics and therefore mingo's, so the reference face converges on the path this package's users actually run rather than on a third reading nobody wrote. One level only — a nested array is not descended into, matching mingo. `$eq` and `$ne` take the same equality as the implicit spelling, so `$ne` stays the exact complement.

**What does not change.** An array in the **comparand** position is still refused (`INVALID_FILTER` / 400) by the shape gate every face of this package runs; this is the VALUE side, which that door does not judge. The live query path is untouched — it already answered membership — so a caller who only ever used `find()` sees no difference. Callers who compared results against the reference matcher, or who ran it directly as a driver double, will see a stored array select on membership instead of on its joined string.
