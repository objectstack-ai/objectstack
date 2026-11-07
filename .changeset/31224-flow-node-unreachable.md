---
'@objectstack/lint': minor
---

fix(lint)!: a flow node no edge path from the start node reaches is refused at build and publish (`flow-node-unreachable`), because a run never executes it

Clause-②: yes (narrowing) — `os validate`, `os build`, `os lint` and the flow save and publish doors refuse a flow they accepted before; `@objectstack/lint` also exports the rule id `FLOW_NODE_UNREACHABLE`, and `RULE_EXPLANATIONS` gains its entry.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` and `content/docs/**` teach only wired top-level flows; the edgeless examples in `content/docs/automation/flows.mdx` are region bodies, which this rule does not judge. The reasoning ships as the `os explain flow-node-unreachable` entry.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed: FlowSchema keeps its shape and meaning, and lint now refuses a graph whose node no edge from the start node reaches. Such a node never ran (a run starts at the start node and follows edges), so there is no rewrite that keeps what the author meant: the author wires the node in or deletes it, and the finding says which node. -->

**BREAKING** accept-set narrowing in `os validate` / `os build` / `os lint` and at the flow publish doors (`PUT /api/v1/meta/flow/NAME` live save, the per-item and package publish; Studio, REST and MCP authors), through the gating `lintFlowPatterns` rule.

- **Before.** A flow whose top-level node had no edge path from the start node (`nodes: [start, stamp, end]`, `edges: [start → end]`) parsed, built, saved, published and registered, and reported itself as configured. The engine starts a run at the start node and follows edges, so `stamp` never ran, and nothing said so.
- **Now.** `flow-node-unreachable` (severity `error`) names each such node: `flow 'NAME' · node 'ID' (TYPE)`, why it never runs, and the fix. A draft save still stores, with the finding in its `_diagnostics`, so a designer that deletes a node and leaves its successor unwired can keep saving; the publish refuses it.
- **A second start node.** A run starts at the first start node, so a second one is reported too; its hint says to delete the extra start rather than wire an edge into it.
- **What counts as reaching a node.** Every edge type: default, conditional, fault and back. A `boundary_event` node, and the nodes only it leads to, are not judged (they are reached by attachment, not by an edge).
- **Not judged.** Nodes inside a region body (a region is a single-entry acyclic graph that the region validator already holds, so all of it is reached); a flow with no start node; a flow with an edge whose endpoint names no node (the flow parse refuses that first).
- **Why lint and not the flow parse.** The metadata save door parses `FlowSchema` on every save, drafts included, and the Studio designer's node delete can leave a successor unwired. A parse rule would refuse that draft save outright.

**What an author does.** Nothing for a flow whose nodes are all wired from the start node. For a refused node: add an edge into it from a node that runs, or delete the node. A refused node never ran, so neither choice changes what the flow did.
