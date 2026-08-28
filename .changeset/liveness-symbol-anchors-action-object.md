---
"@objectstack/spec": patch
---

chore(spec): re-anchor the `action` and `object` liveness ledgers to consuming symbols (#13003)

Adoption batch 1 of the symbol-anchor citation grammar landed by #12516. The
`liveness/` ledgers ship inside this package's npm tarball (they are named in
`files`), so this is a published-data change even though no runtime behaviour
moves and no schema key changes.

Twenty `path:NNN` evidence citations across `liveness/action.json` and
`liveness/object.json` are now written `path#symbol`, each re-closed by reading
the code on the current tree rather than by shifting a line number. A symbol
moves with its consumer, so the pointer survives the in-file drift that rots a
line, and goes red when the consumer is renamed or deleted — a direction a
stale line can never produce.

What the re-closure found, which is the reason the migration is not mechanical:
fourteen of the fifteen `object.json` citations were pointing at the wrong place
already, every one of them IN RANGE and so invisible to all three existing
checks. They had drifted onto a docblock about aggregate-function lowering, a
job-scheduling block, a neighbouring `const`, and — for `object.enable.clone` —
a sort-node normalizer roughly 6,700 lines from its actual reader. Three had
additionally moved package: the `ownership`, `managedBy` and `tenancy.enabled`
readers now live in `@objectstack/spec` itself, and one of those citations
carried a parenthetical (`applySystemFields reads schema.ownership`) that the
re-read falsified outright — that function's nine `ownership` occurrences are
all comments about a decision it delegates.
