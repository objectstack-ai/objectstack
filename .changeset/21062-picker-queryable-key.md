---
'@objectstack/rest': minor
---

fix(rest)!: a public form's lookup picker searches and sorts by the first display field the caller may query, so a picker whose first display field is masked for its caller serves its rows instead of answering 403 (#21062)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a change of which display field the public lookup picker (`GET /forms/:slug/lookup/:field`) searches and sorts by: the first display field the caller may query, by the security service's answer, where it used to be the first display field. No authorable key, spelling, export or stored shape moves: `@objectstack/rest` exports nothing new and nothing less, `FormFieldPublicPickerSchema` keeps parsing every value it parsed, and no stored row is read or rewritten. A picker's `displayFields` keep their meaning as the projected fields. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers which field a picker keys on (not `already-registered`); and the change is route behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this widens what the public lookup picker serves and narrows it in one composition. The narrowing: with a security service that lacks `ISecurityService.getQueryableFields`, or that answers no answer for the object, the picker passes over every display field whose declaration carries a `maskingRule`, for every caller, including a caller the rule is lifted for. So its search and order move to the next display field that declares no rule, and a picker whose display fields all declare a rule is refused `403 PERMISSION_DENIED` without the engine being asked, where it used to be served. The security service this repository ships implements the method, so a deployment using it is not narrowed. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

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
rule is lifted for, keep the first display field as the key, with the security
service this repository ships. A deployment with no security service keeps the
first display field.

**What to do.** Nothing. To choose the field a picker searches when its first
display field is masked for some of its callers, list a field those callers may
query among `displayFields`: the first such entry is the one searched and
sorted on. A picker whose only display fields are masked for its callers is
refused, so give it one they may query.

**What to do after upgrading, if your security service predates `getQueryableFields`.**
Implement `getQueryableFields` on it: it answers which fields a caller may filter,
sort, group or aggregate by, and the picker then keys on the first display field
in that answer. Until it does, give each picker at least one display field that
declares no `maskingRule`, or the picker is refused for every caller.
