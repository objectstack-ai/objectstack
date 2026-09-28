---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

fix(spec)!: a flow node config its executor cannot run — a key its contract requires, left out, or a decision branch list it cannot read — is refused at authoring (#20316)

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-node-config-required-keys-refused -->

**BREAKING** — an accept-set narrowing on authored flow-node `config`, shipped as
`minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level).

**What changed.** A flow node's `config` is an open record, so what its executor
requires was checked by no build door. `FlowSchema.parse`, `AutomationEngine.registerFlow`
and `objectstack validate` all admitted a node that left out a key its executor
contract requires — and the executor's own contract parse then refused the node on
every run that reached it. A `decision` branch with no `label` was worse: it never
failed, the matched branch reported no label, and traversal took EVERY out-edge, so
the flow ran green down the wrong paths. All three doors now refuse these shapes
through one judge, `flowNodeConfigRefusals` (new in `@objectstack/spec/automation`):

- **A key a builtin's executor contract requires, left out.** Each builtin node's
  config is parsed against the very contract its executor parses against
  (`getBuiltinNodeConfigContracts()`, new, reconciled against the executors' own parse
  calls), and only the keys left out are kept — a present value of the wrong type, and
  an undeclared key, are judged where they were before. The keys: `objectName` on
  `get_record` / `create_record` / `update_record` / `delete_record`; `recipients` on
  `notify` (and `title` when there is no `template`); `url` on `http`; `function` on
  `script`; `flowName` on `subflow`; `collection` and `flowName` on `map`;
  `collection` on a `loop` that has a `body`; `branches` on `parallel`; `try` on
  `try_catch`; and on `screen`, each field's `name`, each option's `value` and
  `label`, and a `lookup` field's `reference`. A key a rule of the contract requires
  (the `notify` title, the `lookup` reference) is refused in the contract's own words.
- **A `decision` branch list its executor cannot read.** `conditions` present and not
  `null` must be an array; every branch must be an object; every branch's `label` must
  be a non-blank string (absent, `null`, blank or non-text all name no out-edge).

Each refusal is a `custom` issue anchored at the key (`nodes.1.config.objectName`,
`nodes.1.config.fields.0.name`, `nodes.1.config.conditions.0.label`, or the region
path `nodes.1.config.body.nodes.0.config…`), met at `registerFlow` and
`objectstack validate` through that same parse, and reported by
`validateStackExpressions` for a stack handed to it directly. The refusal codes join
`FLOW_SLOT_REFUSAL_CODES`: `node-config-key-missing`, `node-config-key-required-by-rule`,
`decision-conditions-not-array`, `decision-branch-not-object`,
`decision-branch-label-missing`.

The Studio flow designer writes refused shapes when a node is added and saved before
it is configured, when a decision branch row's label cell is left empty, and when a
screen field row's name cell is left empty. Where such a node already sits, the whole
flow is refused: registered from the metadata registry or `sys_metadata` at boot, it
is skipped with a `failed to register flow` warn naming it while the flows beside it
register; a `defineStack({ flows })` source throws `StackSchemaInvalidError` for the
whole stack; an artifact file is refused whole at load.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ type: 'get_record', config: { outputVariable: 'rows' } }` | the object it reads — `config: { objectName: 'account', outputVariable: 'rows' }` (the same for `create_record` / `update_record` / `delete_record`) |
| `{ type: 'loop', config: { body: { … } } }` | the array it iterates — `config: { collection: '{rows}', body: { … } }` |
| `{ type: 'map', config: { flowName: 'per_row' } }` | `config: { collection: '{rows}', flowName: 'per_row' }` |
| `{ type: 'http', config: { method: 'GET' } }` | `config: { url: 'https://api.example.com/v1/items', method: 'GET' }` |
| `{ type: 'script' }` | the registered function it calls — `config: { function: 'recalc_totals' }` |
| `{ type: 'notify', config: { recipients: ['{record.owner}'] } }` | a content source — `title: 'Deal won'`, or a `template` |
| `conditions: [{ expression: 'record.amount > 1000' }]` on a `decision` | the out-edge it routes to — `[{ label: 'large', expression: 'record.amount > 1000' }]`, beside an out-edge labelled `large` |
| `conditions: ['record.amount > 1000']` | `[{ label: 'large', expression: 'record.amount > 1000' }]` |

**One-line fix:** write the key the node was meant to carry. To branch on the
out-edges instead of on `conditions`, delete `conditions` and put each predicate on its
edge's `condition`.

**Unchanged.** A node carrying every key its contract requires parses, registers and
validates as before; a legacy flat-graph `loop` (no `body`) still needs no
`collection`; a `decision` with no `conditions`, `conditions: null` or an empty list
still routes by its out-edges; `assignment`, `wait`, `connector_action` and plugin node
types are not judged by this rule; and a key spelled by a D2 alias (`object`, `flow`,
`functionName`, …) is still canonicalized before `registerFlow` and `objectstack
validate` judge it.
