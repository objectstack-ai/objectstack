---
"@objectstack/spec": patch
---

docs(spec): the published `explain` payload contract now names BOTH zero-rows sentinels

`ExplainDecision.readFilter` and `ExplainRecordAttribution.rowFilter` are the
machine artifact behind the explain prose, and their published description
enumerated the zero-rows vocabulary as a closed two-item list: `null` =
unrestricted, `{ id: '__deny_all__' }` = zero rows.

That enumeration had grown incomplete. A fail-closed RLS denial — the "no
active organization" path, which composes plugin-security's `RLS_DENY_FILTER`
and is guaranteed to return zero rows — is reported with verdict `denies` and
`allowed: false`, while the payload keeps reporting the predicate that was
ACTUALLY composed: an `id` equality against `__rls_deny__` plus a colon and a
UUID-shaped suffix. So a reader of the contract met a zero-rows shape the
contract did not name.

Both fields now name both shapes, say that the RLS denial is published as
composed (and can therefore ride inside an `$and` composite on `readFilter`),
and say which fields are the DECISION — `allowed` and the `rls` layer's
`verdict` for `readFilter`; `outcome` / `matchesRecord` and the layer's
`verdict` for `rowFilter` — so a consumer that pattern-matches the payload
alone to detect "zero rows" is told it must match both.

`readFilter` carried its enumeration in a JSDoc block only, which no generator
reads: its published description cell and its JSON Schema `description` were
both EMPTY. It now carries a `.describe()`, so the reference page and the
emitted JSON Schema publish the vocabulary instead of nothing.

Text only. `readFilter` / `rowFilter` remain `z.unknown()`, no accepted value
changes, no emitted payload changes, and the two sentinels are not unified —
the sentinel vocabulary itself is a separate, deployment-facing decision.
