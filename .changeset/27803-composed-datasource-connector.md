---
'@objectstack/spec': patch
---

fix(spec)!: `composeStacks` refuses a datasource whose `external.connector` names no connector instance the composed inputs declare (#27803)

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package's public surface changes. `composeStacks` now applies, over every input, the cross-reference rule strict `defineStack` already applies to one stack (ADR-0015 amendment D7): a datasource's `external.connector` must name a declared connector instance with a provider and an auth credential. The refused artifacts are authoring defects that a `strict: false` input carried past the per-stack pass, fixed by declaring the instance or correcting the name in the package source. There is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** accept-set narrowing in `composeStacks` (and so in `os build` on a multi-package artifact).

- **Before.** `defineStack` judged a datasource's `external.connector` against its own stack's `connectors` only, and an input built with `strict: false` skipped that judgement. Composing such an input carried a dangling name, a catalog descriptor (no `provider`) or an instance with no `auth` into the artifact with no verdict. The datasource then had no credential to borrow, found only when it first connected.
- **Now.** The composition's artifact pass judges every input's datasources against the connectors of every input, with the same three findings as the per-stack check, under the `STACK_CROSS_REFERENCE_INVALID` envelope (422). A datasource in one input that borrows an instance another input declares composes. A connector name two inputs declare is judged against the later entry, which is the one the runtime keeps.
- **Unchanged.** A strict `defineStack` refuses a dangling name in its own stack as before, so an artifact built from strict inputs that each resolve their own references is refused only when a later input replaces the borrowed instance under the same name.

**The remedy.** Declare the connector instance the datasource borrows (a `connectors` entry with a `provider` and an `auth` credential) in one of the composed packages, or correct the name. If the upstream needs no credential, drop `external.connector` from the datasource.
