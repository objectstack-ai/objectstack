---
"@objectstack/cli": patch
---

Read `doc.tags` from `src/docs/*.md` frontmatter, so a book group's
`include: { tag }` can match on the documented authoring path (#10486).

`DocSchema.tags` was declared in 17.0.0 (#4509, ADR-0049) as the *enforce* half
of enforce-or-remove: the resolver side already compared against it
(`matchesInclude` in `book.zod.ts`) and the REST book-tree route already
forwarded it. But `collect-docs.ts` parsed frontmatter with `frontmatterScalar`
alone — single-line scalars — and had no case for `tags` at all. On the flat
`src/docs/*.md` path the docs actually recommend, a `tags:` block was therefore
dropped without a word: every doc reached `resolveBookTree` with
`tags === undefined`, and a group declaring `include: { tag: 'tutorial' }`
matched nothing and rendered as an empty section.

Two halves:

- **A minimal `frontmatterList`** reading the two ordinary YAML sequence
  spellings — inline `tags: [tutorial, beginner]` and the block form of `- item`
  lines — wired through `DocItem.tags`. The block sequence ends at the next
  frontmatter key, so `group:` after a `tags:` block still parses. An authored
  `tags: []` parses and means what it says: no tags.

- **A loud `docs/frontmatter-tags` warning** whenever `tags:` is present in a
  spelling the reader cannot parse — a bare scalar, an unterminated inline
  sequence, a key with nothing under it. The reader is deliberately minimal and
  is **not** growing into a YAML engine; this is what keeps that minimalism
  honest, by converting the next unanticipated spelling from a silent drop into
  a visible report. The same warning fires when a locale variant
  (`<name>.<locale>.md`) declares `tags:`, since tags belong to the doc rather
  than to one translation and a `DocTranslationItem` carries no such field.

Warnings surface through the paths that already print `DocIssue`s: `os lint`,
`os validate`, and `os compile`. No schema change — `DocSchema.tags` already
declared the key; only the collector could not produce it.
