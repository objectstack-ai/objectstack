---
'@objectstack/rest': patch
---

fix(rest): a public form's lookup picker searches and sorts by the first display field the caller may query, so a picker whose first display field is masked for its caller serves its rows instead of answering 403 (#21062)

Clause-②: no

**What changed.** The public lookup picker (`GET /forms/:slug/lookup/:field`)
matches the visitor's search and orders its rows by one key. That key used to
be the first entry of `publicPicker.displayFields`. It is now the first entry
the caller may query on, as the security service answers it
(`ISecurityService.getQueryableFields`). A field whose masking rule applies to
a caller is served to that caller masked, and the engine refuses to search or
sort on it with `403 PERMISSION_DENIED`. A picker whose first display field
declares such a rule therefore answered `403` to every caller the rule applies
to, on every request. It now serves its rows, sorted and searched on the next
display field the caller may query. The masked field is still returned in each
row, masked, as before.

**When no display field is queryable** for the caller, the picker answers
`403 PERMISSION_DENIED` with the engine's refusal for those fields, without
running a query.

**Unchanged.** A picker with no masked display field, and a caller the masking
rule is lifted for, keep the first display field as the key. A deployment with
no security service keeps the first display field. A security service that
cannot say which fields are queryable (it predates the method, or has no answer
for the object) gets the fallback its contract prescribes: every display field
whose declaration carries a `maskingRule` is passed over, whoever the caller is.

**What to do.** Nothing. To choose the field a picker searches when its first
display field is masked for some of its callers, list a field those callers may
query among `displayFields`: the first such entry is the one searched and
sorted on. A picker whose only display fields are masked for its callers is
refused, so give it one they may query.
