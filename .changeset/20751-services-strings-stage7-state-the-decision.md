---
'@objectstack/service-analytics': patch
---

Analytics filter refusals, the no-strategy diagnostic and the cube-gate warning no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Some strings the analytics service shows to callers, authors and operators pointed at an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- The two field-reference refusals (a `{ $field }` comparand the SQL lowering cannot render, and a `{ $field }` used as a `$between` bound) say the engine path's driver enforces the cross-field rules (declared same-table columns only, never the tenant-isolation column, one comparison class) with metadata it owns, so those rules are enforced in one place. The bound refusal also says `FieldReferenceSchema` was removed from the `$between` endpoint union rather than implemented there, since nothing asked for it.
- The no-strategy diagnostic for a cross-field filter on a deployment with no aggregate bridge says the same about the engine path.
- The `where` refusals: an undefined comparand is refused rather than read as null, on the SQL drivers and on this door alike; a field constraint with zero operators is refused on every backend, because neither "every row" nor "no row" is the author's intent; a field constraint mixing `$` operators with bare keys is refused by both doors in the package; and the two filter-array refusals say a filter array is lowered at every door or refused, never dropped, so it means the same rows whichever door it enters. Where the undefined-comparand refusal cited a tracker number for the silent widening, it now says that a dropped predicate widens the query; the mixed-wrapper refusal already said so and only drops its citation.
- The dotted-measure refusal drops its citation; the sentence already says measures do not traverse relationships and that the prefix used to be dropped silently.
- The warning logged when no object-registry hook is configured says the inactive gate is the one that answers 404 `CUBE_NOT_FOUND` for a name that is neither a registered cube nor a registered object.

Text only: no status, error code, field, route or control flow moves. A client or log filter that matches the old text (for example a tracker-number suffix) needs the new spelling.
