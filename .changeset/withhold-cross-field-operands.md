---
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

fix(driver-sql,driver-turso): a cross-field `$field` refusal stops naming the two columns it compared (#7929, #7988)

`INVALID_FILTER` / 400 is unchanged, and every filter that was refused is still
refused. What the caller no longer receives is the **predicate**: the referenced
column, the target column, the operator, the list index, and the boundary reason.
The full diagnostic now goes to the driver's server-side log instead
(`SqlDriver.logger`, the sink a host already injects; `TursoDriver` hands the
same sink to its remote transport).

**Why.** An administrator's CEL sharing/permission rule compiles to
`{ $field: path }` and is ANDed into the caller's query by the security
middleware (ordinary CRUD reads) or by the analytics read-scope merge. The driver
receives one `FilterCondition` with nothing marking which subtree the caller
wrote, so when the reference failed one of the four cross-field rulings the
refusal handed a tenant an administrator's policy — measured end to end: the
referenced column, the column it was compared against, and, on the tenant arm,
a sentence naming **which column is the tenant-isolation column** of the object.
A dotted reference came back as `sharing_rule.manager_budget`, verbatim, inside
`error.message`.

**⚠️ This is a real diagnostic regression for authors, and it is deliberate.**
An author debugging their **own** cross-field filter now gets the same redacted
message — nothing in the query tells the driver whether the reference was theirs
or a policy's, so the withhold cannot be conditional without inventing a guess.
Their message is not destroyed, it is relocated: the full text, naming both
columns, is in the server log for whoever operates the deployment. A follow-up
card restores the author-facing text behind a spec-declared provenance mark set
at both merge boundaries; until it lands, an author debugging a cross-field
filter needs the server log or a `matchesFilter` run in memory.

What a caller still gets: the same `code` and `status`, which of the three
cross-field refusal classes fired, and the capability statement (same-table
declared columns, same type class, tenant-isolation column excluded) — none of
which is derived from the filter that was sent.

Scope note: five operators used to answer a `{ $field }` comparand with their own
comparand-shape refusal (`$icontains`, `$like`/`$ilike`, `$null`, `$exists`),
each rendering the reference into its message, while the same reference at
`$contains` was answered by the cross-field refusal. They now all answer with the
cross-field refusal — one condition, one answer, and the redacted one.
