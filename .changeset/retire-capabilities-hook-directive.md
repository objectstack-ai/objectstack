---
"@objectstack/cli": minor
---

**BREAKING** Retire the `@capabilities` hook-body directive comment (#10917).

`os build` no longer reads a `@capabilities` line out of a handler body, and the
docs no longer teach one. A body's capabilities are either inferred from its
source, or declared as data in `body.capabilities` on the hook or action — the
route that is measured to survive the build, and now the only way to name a token
the code itself does not reveal.

**Nothing an author wrote has to change.** The directive was read off the
handler's stringified source, and `loadConfig` runs every config through
`bundle-require` and esbuild, which strips `//` line comments before the handler
is ever a runtime function. Measured on all four ordinary authoring shapes —
`objectstack.config.ts`, `.js`, `.mjs`, and a handler imported from a local
module — it reached the extractor from none of them: the build exited 0, printed
nothing, and shipped the inferred capabilities alone. A config that still carries
the comment builds to the same artifact before and after this release, so
deleting it is optional and changes no output. What is gone is the wrong
convention it taught, silently, to everyone who copied it out of the docs — a
handler asking for more than inference derived was refused by the sandbox at
runtime, far from the cause.

Ruled under ADR-0049 enforce-or-remove: a capability declaration nothing parses is
a false promise, and this one could not even be typed wrongly-but-visibly, because
every authoring path deleted it before the extractor looked.

The retirement kit: the override branch in `extract-hook-body.ts` and the two unit
tests that pinned it are gone; the extractor header and
`content/docs/automation/hook-bodies.mdx` record the removal instead of the
spelling; the `os build`-level test keeps pinning both halves — the comment
contributing nothing, and `body.capabilities` surviving — and a unit pin standing
on the one shape where the override ever fired now asserts it grants nothing.

<!-- adr-0087: not-required (no-migration-prescription) The retired surface is a COMMENT inside a hand-written handler, not metadata. It has no spec schema, no defKey:name row in authorable-surface, and nothing that `objectstack migrate meta` can reach or rewrite, so no ADR-0087 ledger entry is expressible for it; inventing one would misdate a retirement the registry cannot honestly carry. It was also inert on every measured authoring path, so no consumer has a rewrite to perform at all — keeping the comment and deleting it produce the same build output. -->
