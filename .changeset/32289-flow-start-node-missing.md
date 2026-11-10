---
'@objectstack/lint': minor
---

fix(lint)!: a flow whose top-level nodes hold no start node is refused at build, at a live save and at publish (`flow-start-node-missing`), while a draft still saves with the finding

Clause-②: yes (narrowing) — `os validate`, `os build`, `os lint` and the flow live save and publish doors refuse a flow they accepted before; `@objectstack/lint` also exports the rule id `FLOW_START_NODE_MISSING`, and `RULE_EXPLANATIONS` gains its entry.
Metadata-protocol: narrowed
Skills-docs: none — no page in `skills/**` or `content/docs/**` says a flow with no start node is refused at the parse or stored; every flow they teach opens with a start node. The trigger tables that still promise `422 FLOW_NO_START_NODE` for a stored start-less flow are follow-up #32288's. The reasoning ships as the `os explain flow-start-node-missing` entry.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: FlowSchema keeps its shape and meaning, and lint now refuses a flow whose top-level nodes hold no start node. Such a flow never ran (a run begins at the start node, and the engine already refuses to register it), and no rewrite keeps what the author meant: the start node carries the trigger, which only the author knows. -->

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os lint` and at the flow doors (`PUT /api/v1/meta/flow/NAME` live save, the per-item and package publish; Studio, REST and MCP authors), through the gating `lintFlowPatterns` rule.

- **Before.** A flow whose top-level `nodes` held no `start` node (an empty list included) parsed, built and was stored live by the metadata save door, which answered `200`. The author learned of the defect only from a later read (`registration: refused`, since the engine refuses to register it) or from a trigger that never ran.
- **Now.** `flow-start-node-missing` (severity `error`) names the flow at `flow 'NAME' · nodes`, the node types it found, why the flow can never run, and the fix. A live save and a publish answer `422 INVALID_METADATA` with the rule in `issues[]`. A draft save still stores, with the finding in its `_diagnostics`, so a designer can keep saving a flow mid-edit.
- **Scope, matching the engine's registration check.** Zero start nodes only: a flow with two registers and runs from the first, and `flow-node-unreachable` names the extra one. Only the flow's own graph: a start node inside a region body does not count. A flow whose `nodes` is not a list is left to the flow parse, which refuses it first.
- **`os explain flow-node-unreachable`.** Its sentence saying the flow parse refuses a flow with no start node was false and is corrected: the parse accepts it, and the new rule names it.

**What an author does.** Nothing for a flow with a start node. For a refused flow: add a node with `type: 'start'` to the top-level `nodes` and an edge from it to the first step; a record-change or schedule flow declares its trigger in that node's `config`.
