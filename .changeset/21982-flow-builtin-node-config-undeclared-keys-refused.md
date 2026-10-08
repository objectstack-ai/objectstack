---
'@objectstack/spec': minor
'@objectstack/service-automation': patch
'@objectstack/metadata-protocol': minor
---

A key a builtin flow node's executor contract does not declare is refused at parse, with a location, on every builtin but `try_catch`: a `notify` `bogusKey`, a screen field's `visibleIf`, a `create_record` `fieldValues`, an `http` `outputVariable` and the like no longer pass `objectstack validate` and `objectstack compile` and then get the whole flow refused at registration.

Clause-②: yes (narrowing: an undeclared config key on 10 more builtins, every strict-contract builtin but try_catch, is refused at the build doors and the save door, where it passed; widening: a save door with no flow canonicalizer judges the D2-converted body, so a D2 alias spelling it refuses today, script functionName / input and subflow flow, is accepted again, as at every other door)

<!-- adr-0087: registered flow-builtin-node-config-undeclared-keys-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** Each of these executors parses the node's `config` against a strict contract before it acts. The build doors' executor-contract arm judged required keys and present values on these types, but held key membership back, because `registerFlow`'s undeclared-key walk judged it against the node type descriptor's `configSchema`. So a `notify` node carrying `bogusKey` passed `FlowSchema.parse`, `objectstack validate` and `objectstack compile` (compile copied the key into `dist/objectstack.json`), and then registration refused the whole flow: at boot it was skipped with a warn, and a flow saved from Studio was stored and then silently not registered.

**What is refused.** A `get_record`, `create_record`, `update_record`, `delete_record`, `notify`, `http`, `screen`, `map`, `loop` or `parallel` node, at any depth, whose config carries a key its executor contract does not declare: at the config itself, on a `screen` field, or on one of a field's `options`. That includes a body-less legacy `loop`, which is judged on key membership alone. The refusal is the existing closed-set code `node-config-refused-by-contract`, `params: { nodeType, key }`, one per undeclared key, anchored at the key (`nodes.N.config.bogusKey`, `nodes.N.config.fields.0.visibleIf`). It comes from the one judge `flowNodeConfigRefusals` that `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first), `objectstack validate` and the metadata save door share. Its message carries the contract's own sentence, with the contract's prescription for a known slip (`fieldValues` → `fields`, `bulk` → `multi: true`, `visibleIf` → `visibleWhen`, a did-you-mean for a near miss), and closes with the remedy: rename the key to one the contract declares there, or remove it. The issue's `code` is `custom`. That covers `FlowSchema`, `defineFlow()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `flows.N.nodes.M.config.<key>`), `os validate`, `os compile`, an artifact's parse, `registerFlow` and the save door. `script` and `subflow` keys were already refused this way. The new `builtinNodeConfigKeysJudged(nodeType)` export names exactly the builtins the spec judges.

**`@objectstack/service-automation`.** `registerFlow`'s descriptor walk (`validateNodeConfigKeys`) stands aside for every type `builtinNodeConfigKeysJudged` names, so each node type has one judge. Before the move, the declared key sets were measured equal: on each of these types the descriptor's declared keys, at every position the walk descends to, equal the keys the contract accepts there. So registration refuses exactly what it refused before. The refusal now arrives as the parse's located issue instead of the walk's `Flow '…' rejected: N undeclared config key(s)` text.

**`@objectstack/metadata-protocol`.** The save door judges a flow in its canonical spelling on every path. When no flow canonicalizer resolved (a host with no automation service), or the canonicalizer threw (a draft with a temporary cycle), the schema gate and the runtime authoring gate now judge the body with the ADR-0087 D2 conversions applied (`applyConversionsToFlow`), for the verdict only. The stored body stays the raw request body, exactly as before. A D2 spelling the load path still rewrites (`filters` on a CRUD node; `to`, `subject`, `body` and `url` on a `notify`; `flow` on a `map`; `functionName` and `input` on a `script`; `flow` on a `subflow`) is therefore accepted at that door, as at every other one, and an undeclared key that no conversion rewrites is refused there, located. This widens the fallback path back for the `script` and `subflow` aliases the previous key arm had begun refusing there. `duplicatePackage` re-saves through the same gate.

**What stays as it was.**

- `try_catch`: its undeclared keys stay registration's, judged by the walk. Its contract's `retry` is the shared `RetryPolicySchema`, which strips an unknown key, while its descriptor closes `retry` to `maxRetries`, `backoffMs`, `backoffMultiplier`, `maxRetryDelayMs` and `jitter`. Moving the judge would have widened registration.
- Every plugin node type (the spec does not declare its contract): judged by the walk against its descriptor's `configSchema`, with the walk's own prescriptions.
- A key at or under a region slot (a `loop` body or a `parallel` branch, and their nodes and edges): judged at registration by the region check, as before.
- A key inside a free-form map (`filter`, `fields`, `headers`, `defaults`, `input`, `payload`, `templateData`): author data, never judged.
- `assignment`, whose top-level keys are the author's variable names, and `decision`, which parses no contract: unjudged.
- A spelling an ADR-0087 D2 conversion still rewrites at load (`object` and `filters` on a CRUD node; `to`, `subject`, `body` and `url` on a `notify`; `flow` on a `map`) is converted before the judge at every door that converts first (`defineStack`, `os validate`, `os compile`, `registerFlow`, the save door). Met by a direct `FlowSchema.parse` or `defineFlow()`, it is refused like any other undeclared key.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a typo of a declared key (`titl`, `outputVariabel`) | the declared key the refusal's did-you-mean names |
| `fieldValues` on `create_record` / `update_record` | `fields` |
| `bulk`, `all`, `multiple` or `options: { multi: true }` on `update_record` / `delete_record` | `multi: true` at the top level of `config` |
| `visibleIf` on a screen field | `visibleWhen` |
| `itemVariable` on a `loop` | `iteratorVariable` |
| `outputVariable` on an `http` node | delete it: the http executor binds no output variable |
| a key nothing reads | delete it |

**The one-line fix: rename or delete the key the refusal names.** Registration already refused such a flow, so the fix changes nothing a running flow does.

**Who is affected, measured.** At `fbcbcf124`, every builtin flow node authored in this repository's examples, platform objects, apps, scaffolding templates, skills and docs (95 nodes) carries only keys its contract declares. The Studio flow designer at the pinned objectui `a58626c88d` writes only declared keys whenever the engine publishes the node's descriptor. Its fallback form (while the descriptor list is loading, or when it cannot be read) offers `outputVariable` on an `http` node and the `url` alias on a `notify` node. Registration already refused the first and the conversion rewrites the second; the designer fix is tracked in objectui. hotcrm, deployed metadata and other repositories were not measured.

### The kit

- **The refusal.** The key half of the executor-contract arm of `flowNodeConfigRefusals` in `automation/flow-node-config-refusals.ts`, over every builtin in `getBuiltinNodeConfigContracts()` but `try_catch`, named by the new export `builtinNodeConfigKeysJudged`; no new code joins `FLOW_SLOT_REFUSAL_CODES`.
- **The ledger.** The D3 semantic entry `flow-builtin-node-config-undeclared-keys-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: the platform cannot know what an undeclared key was meant to be.
