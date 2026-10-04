---
'@objectstack/spec': minor
---

A flow `create_record`, `update_record` or `delete_record` node whose `objectName` is `sys_metadata` or `sys_metadata_history` is refused at parse, with the runtime's prescription: change metadata through the metadata API.

Clause-②: yes (narrowing)

<!-- adr-0087: registered flow-write-node-stored-metadata-target-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** App-authored work may not write the two stored-metadata tables: the metadata protocol is their only writer, where a change is validated and its provenance is recorded, and a flow is app-authored automation. The runtime already enforces that at the node: the three write nodes refuse such a target before they resolve a filter, compute a field or call the data engine, under every run identity. But `FlowSchema` still accepted the flow, so `objectstack validate` passed it, the metadata save door answered 200 for it and `registerFlow` registered it, and the author learned otherwise only at its first run.

**What is refused.** A `create_record`, `update_record` or `delete_record` node, at any depth including an ADR-0031 region body, whose `config.objectName` is a string naming `sys_metadata` or `sys_metadata_history`. The issue's `code` is `custom`, at `nodes.N.config.objectName`, and its message names the node type and the table and ends with the runtime's prescription. The judge is `flowNodeConfigRefusals`, the one `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and `objectstack validate` share, and its membership test is the kernel's own `isStoredMetadataBodyObject`, the predicate the runtime judges by. That covers `FlowSchema`, `defineFlow()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `flows.N.nodes.M.config.objectName`), `os validate`, an artifact's parse, `registerFlow` and the metadata save door (`422 INVALID_METADATA`). The refusal joins the closed flow slot refusal set as `write-node-stored-metadata-target`, with `params: { nodeType, objectName }`.

**What stays accepted, byte for byte.** A `get_record` node on those tables (a read is not a write; the runtime judges its reach at the run), a write node whose `objectName` is dynamic (a `{token}` template or an expression envelope: the parse cannot read it as a name, and the runtime judges the name it hands the data engine), and every write node on any other object.

**One prescription sentence.** `@objectstack/spec/kernel` now exports `STORED_METADATA_BODY_PRESCRIPTION`, the sentence the hook refusal and this flow refusal both end on. It was the hook refusal's private constant, moved unchanged.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a `create_record` / `update_record` / `delete_record` node with `objectName: 'sys_metadata'` or `objectName: 'sys_metadata_history'` | change metadata through the metadata API (`PUT /api/v1/meta/:type/:name`) instead, and delete the node |
| a write node on any other object, a `get_record` node, or a dynamic `objectName` | unchanged |

**The one-line fix: delete the node, or point its `objectName` at the object the flow really means to write, and make the metadata change through the metadata API.** The runtime never ran such a write, so removing it changes nothing a flow does.

**Who is affected, measured.** No authored flow writes either table in this repository's `packages/**`, `examples/**`, `skills/**`, `content/docs/**` or `docs/**` at `417443eb27` (229 write-node declarations); the only hits are the runtime's own tests of its node refusal. Deployed metadata was not measured. Where such a node already sits in a stored flow, the whole flow is refused at registration: at boot it is skipped with a warn naming it, its trigger not armed, while the flows beside it register.

### The kit

- **The refusal.** A third arm of `flowNodeConfigRefusals` (`automation/flow-node-config-refusals.ts`), beside the executor-contract arm and the decision arm.
- **The ledger.** The D3 semantic entry `flow-write-node-stored-metadata-target-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: a refused node carries no intent a rewrite could keep.
