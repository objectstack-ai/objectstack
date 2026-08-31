---
'@objectstack/spec': patch
---

fix(spec): drop the dead `'status'` member from `SEARCHABLE_ENUM_TYPES` (#13695)

`SEARCHABLE_ENUM_TYPES` in `packages/spec/src/data/search-fields.ts` declared
`new Set(['select', 'status'])`, but `'status'` is not — and has never been —
a member of the 49-value `FieldType` enum. The entry could never match a real
field's `type`, so it changed no accept/reject behaviour and matched no field
in any object: dead vocabulary that invited the next reader to believe a
`status` field type exists.

Verified before removal (not read): `FieldType.options` has 49 members,
`'status'` is absent, `'select'` is present; no in-flight plan for a `status`
field type exists anywhere in the tree.

Grade: `patch`, argued rather than defaulted. Not `skip-changeset` — this
touches published package source, not just docs/tests — and not a no-op
either: this closes a real probe gap. The existing `[#6934]` pins in
`search-fields.test.ts` check the four search vocabularies against **each
other** (pairwise disjointness) but never against `FieldType` itself, so a
pure ghost member — matching nothing, rather than overlapping something —
passed every existing pin silently. This PR adds a `[#13695]` pin asserting
`SEARCHABLE_ENUM_TYPES ⊆ FieldType`, scoped to that one set; a parallel ghost
finding in `SEARCH_AUTO_EXCLUDED_TYPES` (`'object'`, `'grid'`, `'geometry'`,
`'encrypted'` are also not `FieldType` members) is filed separately and left
untouched here.
