---
"@objectstack/spec": patch
---

**docs(spec): `fields` stops prescribing a dotted path no driver resolves (#7601)**

Six in-repo surfaces offered `fields: ['owner.name']` as the supported way to read
one related column. No driver ever implemented it — measured on a real `SqlDriver`,
a dotted projection is byte-identical to no projection at all, because Knex renders
`"account"."name"` against a table that was never joined and the #3821 recovery
ladder retries `select('*')`. Since #7532 those surfaces are additionally
contradicted by a `400 INVALID_FIELD` at the ingress gate
(`assertProjectionFieldsExist`). The migration tooling was the sharpest case: both
protocol-17 upgrade prescriptions routed authors off `query.joins` and off the
retired `{ field, fields, alias }` form directly into the refused spelling.

This aligns the declaration to the enforcement. The normative `fields` `.describe()`
now names `expand` as the sanctioned mechanism for related data — its nested
`QueryAST` both filters (`where`) and selects (`fields`) the related record's
columns — and carries the sharp edge that was pinned but never documented: **the
projection must retain the foreign-key column.** `fields: ['title']` with
`expand: 'project_id'` resolves nothing, because the relation is carried by that
key; adding `'project_id'` makes it work. Where the value is wanted on the queried
object itself, the honest remedy is to denormalise it onto that object (a stored
field, written when the source changes) — the same remedy the sort axis prescribes
(#6924). Both retirement prescriptions and the two tombstone rejection messages now
say the same thing, and the JSON Schema artifacts and reference docs regenerate from
the source.

**No schema change.** `FieldNodeSchema` stays `z.string()`: the refusal of dotted
projections is a *semantic* verdict, made at the ingress gate where the field map is
available to judge against — not a *shape* check. Narrowing the type would duplicate
that gate and refuse the registry-less internal callers the ingress deliberately
tolerates. Every input that parsed before this change parses byte-identically after
it, and the type/runtime pins that assert so are kept and renamed
(`fieldNodeDottedNotNarrowed`) so they read as the non-narrowing guard they are
rather than as an endorsement of a feature that does not exist.

Prose, prescriptions and generated artifacts only — no wire, stored-data or
validation behaviour changes.
