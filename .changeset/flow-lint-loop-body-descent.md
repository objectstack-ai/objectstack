---
"@objectstack/lint": patch
---

fix(lint): the flow rule family now descends into `loop` bodies and every other nested region (#5383)

The flow anti-pattern rules read a flow's `nodes` / `edges` **flat off the top
level**, so every rule in the family was blind to anything authored inside an
ADR-0031 container — a `loop` body, a `parallel` branch, a `try_catch`
try/catch. Loop bodies are where a lot of real branching lives (a per-item gate
inside a sweep is the standard shape for a scheduled flow), so this was a large
share of authorable flow metadata that no flow rule inspected.

Measured in a real app: 8 `decision` nodes carried the inert singular
`config.condition` that `flow-inert-node-condition` exists to catch, all 8
inside a `loop` body, and `pnpm lint` reported none of them. The identical key
on a **top-level** decision in the same repo fired immediately — same key, same
node type, only the nesting depth differed. The blind spot also explains its own
survival: the gate visibly worked where it could see, so the top-level copies
got cleaned up while the nested ones read as approved.

Rules now reported at every depth: `flow-inert-node-condition`,
`flow-decision-unconditional-branch`, `flow-branch-label-unmatched`,
`flow-default-edge-with-condition`, `flow-multiple-default-edges`,
`flow-double-brace-interpolation`, `flow-bare-dollar-reference`,
`flow-date-equality-filter`, `flow-phantom-aggregation`,
`flow-error-label-not-fault`, and the `flow-approval-revise-*` family. Note the
severity asymmetry this closes: `flow-default-edge-with-condition` is a
build-stopping `error` that until now could not see a contradiction authored one
level down.

A finding inside a region carries the region scope in its `where`, so the
message still points at exactly one node — `flow 'x' · loop 'sweep' body ·
node 'y' (decision)`, matching the scope vocabulary the engine's registration
pass already uses. Findings on a flow's own graph are unchanged, byte for byte.

Two details worth knowing if you consume these findings:

- Each region is scanned against **its own** `edges`. The branch-routing rules
  reason about a node together with its out-edges, and a region is a
  self-contained sub-graph, so a nested decision's out-edges live in the
  region's own edge list.
- `flow-double-brace-interpolation` / `flow-bare-dollar-reference` scan a node's
  config recursively, and a container's config physically contains its
  descendants'. A nested hit was therefore already *visible* before this change
  — but attributed to the enclosing `loop` rather than the node carrying the
  string. Such a finding now names the right node, and is still reported exactly
  once.

`flow-runas-unscoped` deliberately keeps looking at top-level nodes only:
widening a build-gating rule is its own change with its own blast radius, and is
tracked separately.
