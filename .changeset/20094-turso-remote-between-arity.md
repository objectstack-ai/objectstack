---
'@objectstack/driver-turso': patch
---

fix(driver-turso): in remote mode, a `$between` that is not two bounds is refused with `INVALID_FILTER` / 400 and its message names no field or value (#20094)

Clause-②: no

In remote mode, `TursoDriver` lowers `$between` to `$gte` / `$lte` before the filter reaches its transport. When the range was not two bounds (`[x]`, `[x, y, z]`, `[]`, a number, a string, `null` or an object), the lowering threw a plain `Error` with no `code` and no `status`. Its message named the object and field and repeated the value, and every caller got it, including when the range came from a read scope such as `plugin-security`'s RLS or sharing predicate. Local mode refuses the same filter with `INVALID_FILTER` / 400 and withholds the field.

The lowering now passes such a range on as written, and the transport refuses it the way it refuses every other filter it cannot compile:

- `INVALID_FILTER` / 400, the code and status local mode answers;
- the message states the refusal's class, `Operator "$between" in this filter requires a [min, max] value array.`, behind the transport's `[RemoteTransport]` prefix, and says the field is withheld;
- the field and the value go to the driver's logger, at `warn`.

Remote mode rebuilds every filter node before the transport sees it, so no provenance mark reaches the transport. As with the transport's other refusals, a filter marked as the caller's own therefore also gets the withheld message in remote mode. Local mode gives that caller the full text.

Not changed: which filters are refused, local mode's answers, and how a two-bound `$between` is lowered, including the whole-day upper bound for a bare `YYYY-MM-DD` on a `datetime` field.
