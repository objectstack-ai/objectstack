---
'@objectstack/spec': minor
---

A builtin flow node's `config` value that its executor contract refuses is refused at parse, with a location, in the contract's own words: `create_record` `outputVariable: 42`, a screen field `min: '1'`, a `get_record` `limit: '10'` and the like no longer pass the build doors and then fail every run.

Clause-②: yes (narrowing)

<!-- adr-0087: registered flow-builtin-node-config-values-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** Every builtin executor parses its node's `config` against the contract `getBuiltinNodeConfigContracts()` names before it acts, and refuses the node on any finding. The build doors judged only the keys that contract requires, left out, so a present value it refuses passed `FlowSchema.parse`, `objectstack validate` and `objectstack compile` (compile copied it into `dist/objectstack.json`), registered, and failed every run that reached the node: `create_record 'mk': config does not satisfy the create_record contract — config.outputVariable: Invalid input: expected string, received number`.

**What is refused.** A node of any builtin type (`get_record`, `create_record`, `update_record`, `delete_record`, `notify`, `http`, `screen`, `script`, `subflow`, `map`, `loop`, `parallel`, `try_catch`), at any depth, whose present config value its executor contract refuses — a wrong type, a value outside the declared set or range, an empty `function` / `flowName`, or a rule finding on present keys (a `notify` `template` beside an inline `title`). The refusal is the existing closed-set code `node-config-refused-by-contract`, `params: { nodeType, key }`, anchored at the key (`nodes.N.config.outputVariable`, `nodes.N.config.fields.0.min`), from the one judge `flowNodeConfigRefusals` that `FlowSchema.parse`, `AutomationEngine.registerFlow` (which parses first) and `objectstack validate` share. The issue's `code` is `custom`. That covers `FlowSchema`, `defineFlow()`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `flows.N.nodes.M.config.<key>`), `os validate`, `os compile`, an artifact's parse, `registerFlow` and the metadata save door (`422 INVALID_METADATA`).

**What the build doors still accept, byte for byte.** Every value its contract accepts, and the values this arm holds back:

- a value carrying a `{token}` (also spelled with double braces or a leading `$`) — never refused at the build doors for its pre-interpolation type. That is not a promise it runs: only `http` interpolates its config before it parses, so only an `http` slot sees the token's resolved value. Every other builtin parses its config as authored, so a token in one of its number or boolean slots (`limit: '{n}'`, `maxIterations: '{cap}'`, a screen field `min: '{m}'`, `multi: '{bulk}'`) still fails at its first run, exactly as before — write a literal there;
- on `http`, any value with a token inside it, and `signingSecret` (the credential channel may supply it);
- a `loop` with no `body` (its executor does not parse it), and the region slots of `loop`, `parallel` and `try_catch`;
- an undeclared or retired key, a screen field's `visibleWhen` and a CRUD `fields` value — each keeps the judge it had.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `outputVariable: 42` | `outputVariable: 'taskId'` — the variable's name |
| a screen field `min: '1'`, `max: '10'` | `min: 1`, `max: 10` |
| `limit: '10'`, `maxIterations: '5'` (any number slot outside `http`) | `limit: 10`, `maxIterations: 5` — a literal number only: these executors parse the config as authored, so a `{token}` here passes the build and fails every run |
| `multi: 'true'`, a screen field `required: 'yes'` (any boolean slot outside `http`) | `multi: true`, `required: true` — a literal boolean only, for the same reason |
| `http` `timeoutMs: '5000'`, `durable: 'yes'` | `timeoutMs: 5000`, `durable: true` — or, on `http` alone, a sole-token template such as `timeoutMs: '{timeout}'`: `http` interpolates before it parses, so the token resolves to its value's type first |
| `severity: 'loud'`, `mode: 'view'` | one of the declared values (`'info'` / `'warning'` / `'critical'`; `'create'` / `'edit'`) |
| a `notify` with both `template` and `title` | one content path, as the refusal's sentence says |

**The one-line fix: write the value the contract declares at the key the refusal names.** The runtime never ran such a node, so the fix changes nothing a working flow does.

**Who is affected, measured.** At `833d57c9cf`, every builtin node `config` authored in this repository's examples, docs, skills and `packages/qa` fixtures (96 nodes), and every one in hotcrm at `4054ec2680` (138 nodes), parses under this arm. A second census at `d1c7d8d392` that also reads helper calls, same-file constants and assignments into a node config (1065 configs in this repository, 138 in hotcrm) found no other real writer; 64 configs here take a value from an import, a call or a spread that no static reading evaluates, and are not counted either way. The one real writer found to store a refused value is the Studio flow designer, which saved a screen field's Min / Max as strings until objectui `5ba255538a`. Deployed metadata, and other repositories, were not measured. Where such a node already sits in a stored flow, the whole flow is refused at registration: at boot it is skipped with a warn naming it, its trigger not armed, while the flows beside it register.

### The kit

- **The refusal.** The value half of the executor-contract arm of `flowNodeConfigRefusals` in `automation/flow-node-config-refusals.ts`; no new code joins `FLOW_SLOT_REFUSAL_CODES`, and `getBuiltinNodeConfigContracts()` keeps its 13 entries.
- **The ledger.** The D3 semantic entry `flow-builtin-node-config-values-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: the platform cannot know the value the author meant.
