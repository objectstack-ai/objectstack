---
'@objectstack/skills': patch
---

docs(skills): four published skills follow merged code — audit sealing, the compare widget's date key, i18n wording, nested relation conditions

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/lifecycle.md` § Sealing: each sealed hour becomes one checkpoint, or consecutive checkpoints of at most 10,000 rows, per organization chain; `chainField` (optional, default `tenant_id`) names the chain column and is fixed once checkpoints exist; `os audit verify` exits 1 on a changed row or a chain fault, `listed_twice` included. The graded eval case in `evals/objects-fields-relationships.json` says the same.

`skills/objectstack-ui/rules/dashboards.md` § `compareTo`: a compare widget's window reaches the dataset query as a time dimension named after the date-range field, so the dataset declares a date dimension of that name (or one over a related-record date path), else `400 INVALID_FIELD`.

`skills/objectstack-i18n/SKILL.md`: the stale aside about the schema docstring is gone (activity-milestone summaries keep their `{field}` tokens); the wiring sentence is a statement again ("You do not need to wire this plugin"); `getSourceLocale()` returns the declared locale only, else `undefined`; the i18n routes answer signed-in callers, and the locales answer carries the declared `fallbackChain`.

`skills/objectstack-query/SKILL.md` and `rules/filters.md`: on a read verb a single-valued relation condition is one in-database subquery per relationship, up to three relationships, on drivers declaring `readableIdsLeaf` (MongoDB and OData refuse it); the 1000-id cap stays only where ids are still read. `filters.md` § Operator Reference lists one example per operator; the SQL equivalents live in `SKILL.md` **Filter Operators**.

No token ceiling moved: every addition is paid by a deletion in the same file.
