---
"@objectstack/cli": patch
---

docs(cli): `invocation.ts`'s `isProcessEntry` doc now names its two siblings

The three-copy `argv[1]`-vs-`import.meta.url` predicate (`isProcessEntry` here,
`isEntrypoint`/`invokedAs` in this repo's `scripts/invoked-as.mjs`, and
objectui's own `scripts/invoked-as.mjs`) carried the "change one, change the
others" sync obligation in only one of the three copies — objectui's. Neither
objectstack copy pointed at the other two, so an agent editing either file
here had no way to discover that a third copy exists elsewhere (#12013).

Both objectstack copies were otherwise correct and are not changed in
substance; only a reciprocal pointer is added to each, comment-only.
