---
'@objectstack/lint': patch
'@objectstack/cli': patch
---

feat(lint): `os lint` refuses a flow whose structured region the automation engine refuses to register (`flow-region-shape-invalid`, ADR-0031)

Clause-②: no (narrowing)
Metadata-protocol: none

**BREAKING** accept-set narrowing at `os lint` (`@objectstack/cli`, through the `@objectstack/lint` rule table): a stack carrying a flow whose `loop` body, `parallel` branches or `try_catch` region is not single-entry/single-exit or is cyclic, at any depth, or whose `parallel` has fewer than two branches, now fails `os lint` (exit 1) instead of passing. `os validate` and `os build` already refused it; their verdicts are unchanged.

- **One rule for all three commands.** The check is now the author-time rule `flow-region-shape-invalid` (`validateFlowRegionShape` and `FLOW_REGION_SHAPE_INVALID`, exported from `@objectstack/lint`). It calls the automation engine's own registration verdict, `FlowSchema` then the spec's `validateControlFlow`, and its message is the engine's refusal behind the flow's name. `os explain flow-region-shape-invalid` prints the full reasoning.
- **What changes at `os validate` and `os build`.** They refuse the same flows as before, now from the rule table, so the refusal prints under `Author-time rules failed` and appears once. Under `--json` it is a rule finding (`rule`, `where`, `path`, `message`, `hint`), in `errors` for `os validate` and in `issues` for `os build`. A flow in a multi-package artifact is located at its place in the artifact's flows (`flows[N]`), with the flow's name in `where`.
- **A flow the flow schema refuses** is reported by the same rule as one that could not be judged, with the schema's issues, never passed. `os validate` and `os build` refuse such a flow at the schema step already; `os lint`, which does not parse, now reports it here.
- **Not judged:** a cycle in a flow's top-level graph, outside any region.

**The remedy.** Fix the flow the way the engine's sentence says: add one node every exit of the region leads to, remove the edge that loops back inside the region, or give the `parallel` a second branch.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `os lint` now runs the check `registerFlow`, `os validate` and `os build` already run, with the same function (`validateControlFlow` from `@objectstack/spec/automation`) and its message. Every flow it now refuses was already refused by `os validate`, `os build` and at registration, and never ran, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->
