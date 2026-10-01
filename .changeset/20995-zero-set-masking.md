---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a field whose masking rule applies is served masked to a caller who resolves no permission set, and that caller may not filter, sort, group or aggregate on it (#20995)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author wrote is rewritten or changes meaning: every maskingRule already declared that it applies to every non-system caller who does not hold all of the field's requiredPermissions, and this change makes the runtime honour that declaration for the one caller class it skipped. No stored metadata, schema key or published type moves. -->

**BREAKING for callers who resolve no permission set.**

**What changed.** A field that declares `maskingRule` is masked for every
non-system caller unless the caller holds all of the field's
`requiredPermissions`. A caller who carries a principal but resolves no
permission set holds no capability, so the rule applies to it, but the runtime
served that caller the stored value and let it filter, sort, group and
aggregate on the field. That caller is now served the masked value. A filter,
sort key, group key or aggregate that names the field is refused with
`403 PERMISSION_DENIED`, as it already was for any other masked caller. A write
that sends the masked placeholder back is refused with `400 VALIDATION_ERROR`, so
a client that saves the record it was served cannot overwrite the stored value
with its mask.

The published field answers agree with what is served.
`ISecurityService.getQueryableFields` no longer lists such a field for this
caller, so a door that compiles its own query refuses it the same way.
`getReadableFields` still lists it, because a masked field is a served column.

**Who this reaches.** A caller who resolves no permission set but carries a
position, a named permission set or a user id. A caller with none of the three
is handed through untouched, as before, and the field projections say so. A
system context is unaffected.

**One more refusal, by the same rule.** If the object's security posture cannot
be read, this caller's request is now refused, as every other caller's already
is. The masking rules come from that posture, so they cannot be known without
it.

**What to do.** Nothing, unless such a caller needs the stored value. A field's
`requiredPermissions` are the gate that lifts its mask, so give the caller a
permission set that holds all of them, or drop the `maskingRule`. A query that
must sort or search on the field needs the same.
