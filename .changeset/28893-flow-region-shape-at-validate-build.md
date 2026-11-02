---
'@objectstack/cli': patch
---

fix(cli): `os validate` and `os build` refuse a flow whose structured region the automation engine refuses to register (ADR-0031, #28893)

Clause-②: no (narrowing)
Metadata-protocol: none

**BREAKING** accept-set narrowing at `os validate` and `os build` (`@objectstack/cli`): a stack carrying a flow whose `loop` body, `parallel` branches or `try_catch` region is not single-entry/single-exit or is cyclic, at any depth, or whose `parallel` has fewer than two branches, now fails validation and the build instead of passing and emitting an artifact.

Both commands now hand each flow to the automation engine's own registration verdict: `FlowSchema`, then the spec's `validateControlFlow`. A refused flow is reported by the author-time rule `flow-region-shape-invalid` as `Flow '<name>' would be refused at registration: <where>: <the engine's message>` (exit 1), and the build writes nothing to `dist/`; `os lint` reports it too. Before, both passed it, and the engine refused it at boot with an `[Automation] failed to register flow` warning while the server ran without the flow. What the engine registers is unchanged. The fix is the engine's own sentence, e.g. add one node every exit of the region leads to.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: `os validate` and `os build` now run the check `registerFlow` already runs, with the same function (`validateControlFlow` from `@objectstack/spec/automation`) and its message. Every flow they now refuse was already refused at registration and never ran, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone; the remedy is the engine's own sentence (close the region with one exit node, or give the parallel a second branch). -->
