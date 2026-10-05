---
'@objectstack/spec': minor
---

A flow `approval` node's `config` is judged at parse against the contract the spec declares for it, `ApprovalNodeConfigSchema`, whole: an undeclared key, a refused value and a required key left out are each refused with a location, in the contract's own words.

Clause-②: yes (narrowing)

<!-- adr-0087: registered flow-approval-node-config-contract-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** The approval node's executor parses `node.config` against `ApprovalNodeConfigSchema` before it does anything else and fails the node on any issue. Registration already refused an undeclared key, but a refused value such as `escalation.timeoutHours: 0.5` registered and then failed every run that reached the node, and no build door asked about either: `objectstack validate` and `objectstack compile` exited 0 on an `escalation.bogusKey` or a `timeoutHours: 0.5`, and compile copied it into `dist/objectstack.json`.

**What is refused.** An `approval` node, at any depth, whose `config` the approval contract refuses. The judge is `flowNodeConfigRefusals`, the one `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and `objectstack validate` share; the approval contract joins it as a declared contract map beside the builtin executor contracts, with no plugin loaded. Every issue that contract raises is refused, because the executor refuses on every one:

- an undeclared key, at the key (`nodes.N.config.escalation.bogusKey`, one issue per key, the top level included), and a refused value, at its key (`nodes.N.config.escalation.timeoutHours` for `0.5` under its minimum of 1): the new closed-set code `node-config-refused-by-contract`, `params: { nodeType, key }`, whose message carries the contract's own sentence — for an alias, its did-you-mean (`timeout` → `timeoutHours`);
- a required key left out (`approvers`; `timeoutHours` inside an `escalation` block): `node-config-key-missing`, as for a builtin node, or `node-config-key-required-by-rule` where a rule of the contract requires it.

The issue's `code` is `custom`. That covers `FlowSchema`, `defineFlow()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `flows.N.nodes.M.config.<key>`), `os validate`, `os compile`, an artifact's parse, `registerFlow` and the metadata save door (`422 INVALID_METADATA`).

**What stays accepted, byte for byte.** Every approval node the contract accepts, an `approval_revise` node, and every builtin node: the builtin arm still judges only a key left out, so an undeclared key or a wrong-typed value on a builtin node is judged where it was before. A plugin node type whose contract the spec does not declare stays outside the build doors.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `escalation: { …, bogusKey: 1 }`, or any key the contract does not declare | delete the key, or rename it to the one the refusal's did-you-mean names (`timeout` → `timeoutHours`, `mode` → `behavior`, `quorum` → `minApprovals`) |
| `escalation: { timeoutHours: 0.5 }` | `escalation: { timeoutHours: 1 }` — whole wall-clock hours, at least 1 |
| `escalation: { enabled: false }` with no `timeoutHours` | delete the `escalation` block |
| `steps`, `entryCriteria`, `onApprove`, `onReject` or `rejectionBehavior` on the node | the flow graph, as the refusal's guidance says (successive nodes, the entering edge's `condition`, the `approve` / `reject` out-edges, a back-edge) |
| an approval node with no `approvers` | `approvers: [{ type: 'position', value: '<position>' }]` (or any approver the contract accepts) |

**The one-line fix: write the shape the approval contract declares at the key the refusal names.** The runtime never ran such a node, so the fix changes nothing a working flow does.

**Who is affected, measured.** At `5e0b489bca`, every approval node `config` authored in this repository parses under the contract: `examples/**` (15 nodes, all in the showcase), `content/docs/**` (6 snippets), `skills/**` (5 snippets) and the `packages/qa/dogfood` fixtures (6 nodes), and so does the Studio designer's approval seed at the pinned objectui commit. Deployed metadata, and repositories other than these two, were not measured. Where such a node already sits in a stored flow, the whole flow is refused at registration: at boot it is skipped with a warn naming it, its trigger not armed, while the flows beside it register.

### The kit

- **The refusal.** The declared contract map in `automation/flow-node-config-refusals.ts`, read by the same executor-contract arm of `flowNodeConfigRefusals`; the new code joins `FLOW_SLOT_REFUSAL_CODES`.
- **The ledger.** The D3 semantic entry `flow-approval-node-config-contract-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: the platform cannot know the approvers, the key or the value the author meant.
