---
'@objectstack/spec': patch
---

Type-check the TSDoc code examples in `packages/spec/src` — the ADR-0033 authoring channel

`check:skill-examples` now scans a third surface: `packages/spec/src/**` TSDoc blocks,
alongside `skills/` + `content/docs` and the client SDK sources. A schema's `@example`
is what an AI author copies, and it sits inches from the tombstone written for that same
reader — but nothing compiled it, so an example could name a retired key, a renamed
export or a tightened union and stay green indefinitely. (`check:doc-formula-expressions`
walks the same blocks but judges *formula expressions*, never TypeScript.)

This is a new `SURFACES` entry, not a second extractor: the existing marker/tsc pipeline
was already surface-parameterised. Compilation stays **opt-in** via the `os:check`
marker, which matters more on this root than anywhere else — of its 146 fenced ts blocks,
128 carry no imports of their own and three more are ellipsis-placeholder prose
(`defineStack({ ... })`) that is correct as documentation and can never compile. Six
self-contained blocks are marked and now compile against the built declarations.

The marker is an inert HTML comment, as on the other surfaces, and is stripped from
generated reference pages rather than published to them.
