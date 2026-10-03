---
'@objectstack/service-analytics': patch
---

The read-scope comparand refusals, the native-SQL cross-field backstop and the two display-SQL echo refusals no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings the analytics service shows to operators and callers pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- The read-scope compiler's undefined-comparand refusal says an undefined comparand is refused rather than read as null, on the SQL drivers and on this door alike. Its refusal of a non-boolean `$null`, `$exists` or `$empty` comparand says a non-boolean comparand for any of the three is refused rather than coerced, on every driver and on this door alike. Both still say they fail closed, and that the producer to fix is whoever built the read scope, never the caller of the query.
- The native-SQL strategy's cross-field backstop and the `/analytics/sql` echo's refusal of a field-reference comparison say the engine path's driver enforces the cross-field rules (declared same-table columns only, never the tenant-isolation column, one comparison class) with metadata it owns, so those rules are enforced in one place, next to the metadata they read.
- That echo refusal and the echo's unmapped-operator refusal say the echo renders every predicate the query runs with, or refuses.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
