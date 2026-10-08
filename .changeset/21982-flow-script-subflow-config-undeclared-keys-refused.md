---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

A `script` or `subflow` flow node whose `config` carries a key its executor contract does not declare is refused at parse, with a location, in the contract's own words: a `script` `bogusKey`, a `subflow` `timeoutMs` written inside `config`, and the like no longer pass the build doors and registration and then fail every run.

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-script-subflow-config-undeclared-keys-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** The `script` and `subflow` executors parse the node's `config` against a strict contract (`ScriptConfigSchema`, `SubflowConfigSchema`) before they act, and refuse the node on an undeclared key. No door before the run judged one: `registerFlow`'s undeclared-key check reads the node type descriptor's `configSchema`, and these two descriptors publish none, while the build doors' executor-contract arm judged required keys and present values but not key membership. So a `script` node carrying `bogusKey` passed `FlowSchema.parse`, `objectstack validate` and `objectstack compile` (compile copied it into `dist/objectstack.json`), registered, and failed every run that reached the node: ``script 'n': config does not satisfy the script contract — config: Unrecognized key(s) on this script node config: `bogusKey` ``.

**What is refused.** A `script` node, at any depth, whose config carries a key other than `function`, `inputs` and `outputVariable`, or a `subflow` node whose config carries a key other than `flowName`, `input` and `outputVariable`. The refusal is the existing closed-set code `node-config-refused-by-contract`, `params: { nodeType, key }`, one per undeclared key, anchored at the key (`nodes.N.config.bogusKey`), from the one judge `flowNodeConfigRefusals` that `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and `objectstack validate` share. The issue's `code` is `custom`. That covers `FlowSchema`, `defineFlow()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `flows.N.nodes.M.config.<key>`), `os validate`, `os compile`, an artifact's parse, `registerFlow` and the metadata save door.

**What stays as it was.**

- Every other builtin node type: its undeclared keys are judged at registration against its descriptor's `configSchema`, with that check's own prescriptions, and the build doors do not judge them.
- `decision`: it publishes no descriptor `configSchema` either, but its executor parses no contract, so an undeclared key fails no run and stays unjudged.
- A retired `script` key (`actionType`, `template`, `recipients`, `variables`, `script`) keeps its tombstone path.
- A spelling an ADR-0087 D2 conversion still rewrites at load (`functionName` and `input` on a `script`, `flow` on a `subflow`) is converted before the judge at every door that converts first (`defineStack`, `os validate`, `os compile`, `registerFlow`). Met by a direct `FlowSchema.parse` or `defineFlow()`, it is refused like any other undeclared key, as its missing canonical key already was.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a typo of a declared key (`funtion`, `outputVariabel`) | the declared key: `function`, `inputs`, `outputVariable` on a `script`; `flowName`, `input`, `outputVariable` on a `subflow` |
| a value the function or child flow should receive, as its own config key (`config: { function: 'f', taskId: '{record.id}' }`) | inside the input map: `config: { function: 'f', inputs: { taskId: '{record.id}' } }` (`input` on a `subflow`) |
| a `subflow` `config.timeoutMs` | on the node: `{ id, type: 'subflow', timeoutMs: 30000, config: { … } }` |
| a key nothing reads | delete it |

**The one-line fix: rename, move or delete the key the refusal names.** The runtime never ran such a node, so the fix changes nothing a working flow does.

**Who is affected, measured.** At `15ec50e528`, every `script` and `subflow` node authored in this repository's examples, platform objects, apps, scaffolding templates, skills and docs (8 nodes: 6 `script`, 2 `subflow`) carries only declared keys, and so does every one in hotcrm at `c9678036d9` (5 `subflow`, no `script`). The Studio flow designer at the pinned objectui `a58626c88d` writes only declared keys for both types (its `timeoutMs` field writes the node, not `config`), and seeds a new node with an empty `config`. Deployed metadata, and other repositories, were not measured. Where such a node already sits in a stored flow, the whole flow is refused at registration: at boot it is skipped with a warn naming it, its trigger not armed, while the flows beside it register.

**`@objectstack/lint`.** `validateStackExpressions` keeps the pre-conversion tolerance it declares: on a raw source, a `script` node's `functionName` alias stays the callable check's to read, not an undeclared-key error, while every other undeclared `script` key is refused there as at the build doors.

### The kit

- **The refusal.** The key half of the executor-contract arm of `flowNodeConfigRefusals` in `automation/flow-node-config-refusals.ts`, judged for the builtins in the spec's schemaless class (`SCHEMALESS_NODE_CONFIG_SCHEMAS`) that have an executor contract; no new code joins `FLOW_SLOT_REFUSAL_CODES`, and `getBuiltinNodeConfigContracts()` keeps its 13 entries.
- **The ledger.** The D3 semantic entry `flow-script-subflow-config-undeclared-keys-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: the platform cannot know what an undeclared key was meant to be.
