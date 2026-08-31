---
"@objectstack/plugin-sharing": patch
---

fix(plugin-sharing): the record-share `$in` guard now tests `record_id` before `String()` coerces it (#13551)

`buildReadFilter` and the bulk-write half of `buildWriteFilter` each turned the
`sys_record_share` rows granted to the caller into the members of a security
predicate, `{ id: { $in: [...] } }`, with the same expression:

```ts
grants.map((g: any) => String(g.record_id)).filter(Boolean)
```

`.filter(Boolean)` reads as "drop rows whose `record_id` is nullish". It cannot:
`String(null)` is `'null'` and `String(undefined)` is `'undefined'`, and both are
truthy. The only value that spelling could drop was the empty string, so the
guard was dead for exactly the case its spelling advertised, and a
`sys_record_share` row with a nullish `record_id` put the literal string
`'null'` into the emitted `$in`.

**Direction — this was not an open bypass, and the repair is not a bypass fix.**
The emitted member is a bogus id that matches no row on any backend, and both
sites are positive polarity (an OR-ed branch beside the owner match, never
negated), so a corrupt row lost its grant rather than widening anyone's scope.
It also took an already-corrupt row to reach at all. What was actually broken is
the guard's honesty: a reader — or an audit asking which security paths already
handle nullish ids — would have counted these two sites as covered when they
provably were not.

Both sites now share one module-private helper that tests the raw column value
first and coerces after, the shape the sibling id-list guards already use
(`plugin-sharing`'s own `sharing-rule-service.ts` and `primary-bu-projection.ts`,
`core`'s `resolve-authz-context.ts`, `plugin-security`'s controlled-by-parent
`masterIds`, `objectql`'s master-detail parent resolution). Factoring it into one
helper is deliberate: the expression stood in two places, and repairing one would
have left the other advertising a guarantee it does not keep.

The non-null path is unchanged. Every non-nullish value still stringifies exactly
as it did — a driver-numeric primary key still becomes its decimal string — and
the empty string, the one value the old spelling really did drop, is still
dropped. The only behavioural difference is that rows with a nullish `record_id`
now contribute no member at all; when they were the *only* grants, the filter
collapses to the plain owner match instead of OR-ing in a branch that matched
nothing.
