---
"@objectstack/spec": patch
---

Reference pages no longer print `@example` and `@category` tag lines as literal text.

A module docblock is JSDoc, so its header carries block tags, and the reference-docs
renderer emitted a tag written on a prose line verbatim — 18 such lines reached 14
customer-facing pages, as `@example Basic field mapping` above a code fence and
`@category Security` at the foot of four `system/` pages. `#13796` removed `@module`
from the page and left these two open, because a blanket `^@\w+` line filter would
have taken reader prose off the page and orphaned the fences below it.

The verdict is per tag, and the axis is the payload rather than the spelling:

- **`@example CAPTION` is REWRITTEN** into that caption, in bold, above the block it
  captions — the shape `@see` already had (`See also: …`). 12 lines across 10 pages.
  Bold rather than a heading because heading renumbering has already run by then, so
  an emitted heading would carry a level chosen blind of the page, add entries to the
  pages' tables of contents, and put a caption in reach of `check:docs-single-h1`.
- **A bare `@example` is DROPPED.** With no payload it is the `@module` case exactly,
  and the fence beneath it is visibly an example without a line announcing one. 2
  lines (`studio/plugin`, `studio/object-designer`), both sitting against the
  `check:skill-examples` opt-in marker that was already dropped there.
- **`@category VALUE` is DROPPED.** 4 lines, all reading `Security`, on four pages that
  already sit under a `system/` section saying as much — and nothing in the repo reads
  the tag: no typedoc or api-extractor (neither is used here), no search index, no
  gate. Routing it into page frontmatter instead would publish a field with no
  consumer. The tag stays in the source, where it is a legitimate JSDoc tag; only the
  rendered page drops it.

No schema behavior changes. The pins assert on the rendered fragment rather than on the
emitted `.mdx`, because `check:docs` compares the artifact against the source and
reproduced all 18 tag lines faithfully.
