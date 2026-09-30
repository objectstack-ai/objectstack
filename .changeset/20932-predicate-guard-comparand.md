---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a field the caller may not read is refused as a cross-field comparand exactly as it is refused as a filter key (#20932)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal of a QUERY at the security layer's field predicate guard: a query that names a field the caller's field-level permissions hide as a cross-field comparand now answers the 403 PERMISSION_DENIED the same field already answers as a filter key. No authorable key, spelling, export or stored metadata shape moves: FieldReferenceSchema, every filter shape and every object definition parse as before, and @objectstack/plugin-security exports nothing new and nothing less (collectConditionFields, collectQueryFields and assertReadableQueryFields keep their signatures). There is nothing for objectstack migrate meta to rewrite, since what changes is which caller may run a query, not what any metadata says. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers a permission verdict and this diff adds none (not registered / already-registered); and the change is runtime behaviour, not a declaration (not runtime-interface-only / type-surface-only). -->

**BREAKING for queries that compare a column against a field the caller may not read.**

**What changed.** The security layer refuses a query that filters, sorts, groups or aggregates by a field the caller's field-level permissions hide, with `403 PERMISSION_DENIED`: which rows answer would disclose the value that the field mask withholds from the result. A cross-field comparand (`FieldReferenceSchema`, "compare against another column of the same row") reads the field it names in the same way, and it is now collected into the same set and judged by the same rule. A hidden field named as a comparand, in any position the filter grammar admits for one, in `where`, `having` or a per-aggregation `filter`, answers the same `403 PERMISSION_DENIED`, in the same words, as the same field written as a filter key. This covers `engine.find`, `findOne`, `count`, `aggregate` and the bulk `update` / `delete` predicate, and every route that reaches them. Before, such a comparison was answered.

**What is not affected.** A comparand naming a field the caller may read answers as before. A system context, and a caller with no permission sets, are unaffected. Row-level policies may still compare against fields the caller cannot read, because they are applied after the guard. A comparand the filter grammar refuses is still refused; when it names a hidden field, that refusal may now be the `403` rather than `400 INVALID_FILTER`, as it already was for a hidden filter key.

**If a query stopped answering for some users,** it compares against a field those users may not read. Grant that field's read permission to the users who need it, or compare against a field they can read.
