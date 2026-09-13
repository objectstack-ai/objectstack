---
'@objectstack/spec': patch
---

`search-fields.ts`'s module docblock says `$search` expands to an `$or` of `$icontains`, the operator the engine actually emits

The docblock's ENGINE bullet claimed `@objectstack/objectql`'s
`expandSearchToFilter` expands a `$search` term into an `$or` of **`$contains`**
clauses. It has compiled to `$icontains` since objectstack#7641:
`packages/objectql/src/search-filter.ts:23` carries the ruling verbatim — *"The
case-insensitive operator is `$icontains`, NOT `$contains`. `$contains` is
contractually case-SENSITIVE (#4706 Q2 = A)"* — and both return paths of
`fieldClausesForTerm` (`:109`, `:111`) emit `$icontains`.

**Why the distinction is worth a clause rather than a word swap.** `$contains`
is contractually case-SENSITIVE, so a reader who trusted the old sentence built
an ingress gate, a test or a driver **stricter** than the platform is — a false
refusal, not a leak. The corrected bullet now says that in one clause, so the
next reader of this module does not have to reconstruct it from two other
packages.

⛔ No behaviour changes. This is a module docblock; the engine has been right
since #7641 and no accept set, authorable key or published behaviour moves.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` ships `dist`, and
this TSDoc is emitted into `dist/data/index.d.ts` and `dist/data/index.d.mts` —
measured on the built artifact, with the old spelling absent from all 216 built
files afterwards and the docblock's own neighbouring sentence present at 2 as
the lit control. `src/data/search-fields.ts` is not a `.zod.ts`, so it is not
shipped as source; the emitted declarations are the whole of its published
reach, and they change.

The sibling INGRESS sentence two lines below — `@objectstack/metadata-protocol`
`findData` refusing a `$searchFields` override the resolved set does not admit
(#4254) — was measured on the same tip and is unchanged: `findData` still calls
`assertSearchFieldsAreSearchable`, which resolves through this module's own
`resolveSearchFieldResolution` rather than re-implementing the rule.
