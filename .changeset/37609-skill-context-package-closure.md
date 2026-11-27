---
'@objectstack/metadata-core': patch
'@objectstack/core': patch
'@objectstack/lint': patch
---

fix(lint): a skill's `context` naming a pack a declared dependency in the artifact ships no longer warns `ai-skill-context-unknown`

Clause-②: yes (widening)
Metadata-protocol: none

`ai-skill-context-unknown` judged a skill's `context` against the stack's own `aiContexts` only, so `os validate`, `os build` and `os lint` warned in their per-package pass about a pack that a package the skill's package depends on ships, though the MCP skill prompt resolves that pack. The rule now resolves `context` by the one ADR-0150 D3 rule the prompt uses, over the stack's own packs and the packs of the artifact's other packages, in the skill's package closure (its declared dependencies plus every `sys` package). A pack a declared dependency in the artifact ships gets no warning. A pack that only a sibling package outside the closure ships still warns, naming the holder and saying to declare the dependency. A pack two packages in reach both ship warns, naming both. A pack no package in the artifact ships warns as before.

`@objectstack/metadata-core` now exports the ADR-0150 D3 resolution rule, `resolvePackageScopedHolders`, with its holder source, refusal, refusal error class and vocabulary (`packageScopedHolderSource`, `PackageScopedNameRefusedError`, `PACKAGE_SCOPED_TYPES`, `BARE_NAME_ONE_HOLDER_TYPES` and the rest of that module). They moved there from `@objectstack/core` so lint, which depends on metadata-core and never on a runtime, can call the same rule. `@objectstack/core` re-exports every name under the same spelling, and each value is the very object metadata-core exports, so `instanceof PackageScopedNameRefusedError` holds whichever package a caller imports it from.

Nothing to migrate: every `@objectstack/core` import of these names keeps working unchanged.
