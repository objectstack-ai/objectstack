---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a field that declares `requiredPermissions` is not served to a caller who resolves no permission set, and that caller may not query on it or write it (#21063)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author wrote is rewritten or changes meaning: every field-level requiredPermissions already declared mask on read and deny on write for a caller who does not hold all of it, and this change makes the runtime honour that declaration for the one caller class it skipped. No stored metadata, schema key or published type moves. -->

**BREAKING for callers who resolve no permission set.**

**What changed.** A field that declares `requiredPermissions` is masked on read
and denied on write unless the caller holds all of them (ADR-0066 D3). A caller
who carries a principal but resolves no permission set holds no capability, so
the gate applies to it, but the runtime served that caller the stored value,
let it filter, sort, group and aggregate on the field, and accepted a write
that named it. The explain engine already reported the field hidden for that
caller. Now the field is not served to it (a field that also declares a
`maskingRule` is served masked, as before). A filter, sort key, group key or
aggregate that names the field is refused with `403 PERMISSION_DENIED`, and so
is a write payload that names it, as for any other caller who lacks the
capability.

The published field answers agree with what is served and refused.
`ISecurityService.getReadableFields`, `getQueryableFields` and
`getWritableFields` no longer list such a field for this caller, and neither
does `getMetadataReadableFields` when the deployment's fallback set resolves to
nothing. The write preview answers such a payload as the write path does.

**Who this reaches.** A caller who resolves no permission set but carries a
position, a named permission set or a user id. A caller with none of the three
is handed through untouched, as before, and the field projections say so. A
caller who resolves at least one permission set is unaffected, and so is a
system context. Whether this caller may read or write the object at all is
unchanged.

**What to do.** Nothing, unless such a caller needs the field. A field's
`requiredPermissions` name the capabilities that open it, so give the caller a
permission set that holds all of them, or drop the requirement from the field.
