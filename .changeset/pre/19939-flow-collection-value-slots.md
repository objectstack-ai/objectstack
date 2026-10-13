---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': patch
---

A `loop`'s (with a `body`) and a `map`'s `collection` is a value slot now: the list the node iterates is a CEL value envelope, `{ dialect: 'cel', source: 'tasks' }`, that the executor evaluates in the run's scope, or the items written as an inline array, iterated as written. A string there is refused at `objectstack validate`, at `registerFlow` and by the executor: a `{…}` template token, naming its CEL spelling, and a variable's bare name, naming that variable in an envelope. The envelope is newly accepted there; the contract refused it before this change.

Clause-②: yes (narrowing: a string is refused at loop.collection and map.collection, a {…} token and a variable's bare name alike; widening: both accept a CEL value envelope they refused, their published JSON Schema and inferred types gain the envelope arm, and FlowCollectionSlotSchema is a new export)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff: its surface widens to a loop's and a map's collection, and its replacement, reason and acceptance criteria say what the list must evaluate to, what an absent one does, and why the bare name is refused rather than rewritten. No new D3 entry and no D2 conversion: an absent variable fails the node as a returned failure under the template and as an evaluation fault under CEL, and a bare name that never iterated would iterate as an envelope. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, beside one widening (both slots accept a CEL value envelope), shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 2 makes a computed value whole-field CEL, and Decision 3 deletes the single brace. The list a `loop` or `map` iterates is a computed value. Until now the executors ran a string `collection` through the single-brace interpolator. The contract also declared a variable's bare name there (`collection: 'tasks'`), but the structured `loop` and `map` never read one: the interpolator handed the name back unchanged, the value was no list, and every run failed at the node ("collection 'tasks' did not resolve to an array"), although `registerFlow` and `objectstack validate` accepted the flow. That arm retires with the token, and the refusal names the envelope that iterates.

**What changes where the list may be absent.** The envelope must evaluate to a list, and anything else fails the node, `null` included, as a token that resolved to nothing did. One difference remains on an absent variable: the template failed the node with a returned failure (the step's `NODE_FAILURE`), and CEL fails it with an evaluation fault naming the variable (`EXECUTION_ERROR`). A `fault` edge routes both. To iterate nothing when the list may be absent, guard it to answer `[]`: `has(vars.tasks) ? vars.tasks : []`.

**What does not change.** An inline array is iterated as written, and its elements are data: a `{…}` inside one was never interpolated, and is not judged now. A `loop` with no `body` is the legacy flat-graph form: it still reads `collection` as a bare variable name and sets `$loopItems` and `$loopIndex`, and no door judges it.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `collection: '{tasks}'` | `collection: { dialect: 'cel', source: 'tasks' }` | an absent `tasks` fails the node with an evaluation fault instead of a returned failure |
| `collection: '{record.items}'` | `collection: { dialect: 'cel', source: 'record.items' }` | as above |
| `collection: '{tasks}'` where an absent list should iterate nothing | `collection: { dialect: 'cel', source: 'has(vars.tasks) ? vars.tasks : []' }` | the node iterates nothing where the template failed it |
| `collection: 'tasks'` (a bare name, on a `loop` with a `body` or a `map`) | `collection: { dialect: 'cel', source: 'tasks' }` | the node iterates; it failed every run before, so decide whether it should |
| `collection: ['a', 'b']` | unchanged | an inline array is the list |
| `collection: 'tasks'` on a `loop` with no `body` | unchanged | the legacy flat-graph loop is untouched |

**The one-line fix: write a `loop`'s or a `map`'s `collection` as a CEL value envelope naming the list, `{ dialect: 'cel', source: 'tasks' }`, or as an inline array.**

**Who is affected, measured.** In this repository: the showcase example (two `loop` collections and one `map` collection), the todo example (two `loop` collections), the flows guide, the service-automation README, and test fixtures; all are migrated in this change. hotcrm writes a `{…}` collection on eleven structured loops in nine flow files (and one test fixture) and no bare name; it is on spec 17.7.0, so nothing there moves until it upgrades.

**Newly accepted.** A CEL value envelope at `loop.collection` and `map.collection`: the published JSON Schema for both gains the envelope arm (a list, or the envelope object), and so do the inferred `LoopConfig['collection']` and `MapConfig['collection']`, which lose `string`. `FlowCollectionSlotSchema` (`@objectstack/spec/automation`) is the contract both take.

**Still accepted, unchanged.** An inline array at both, and on a body-less `loop` any `collection` its legacy form reads. The single-brace dialect keeps resolving where it still lives, a CRUD `filter` value.

### The kit

- **The contract.** `LoopConfigSchema.collection` and `MapConfigSchema.collection` take `FlowCollectionSlotSchema`: a list or a CEL value envelope, so the executor's contract parse refuses a string as a guard, in the words above.
- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS`' `loop.collection` and `map.collection` rows take the `value` role, and `loop.collection` is read only on a `loop` with a `body` (`onlyWithKey`). The `loop` and `map` descriptors declare the slot with `xExpression: 'value'`. The single-brace `flow-template` role, which recorded these two slots and no other, is gone from `FlowNodeExpressionRole`, so a descriptor marker `'template'` fails the reconciliation ratchet as unknown.
- **The executors.** The `loop` and `map` nodes evaluate an envelope through `AutomationEngine.evaluateValueEnvelope`, as every value slot does, and iterate an inline array as written. A value that is not a list fails the node, naming what it evaluated to and its source.
- **The lint.** `validate-flow-template-paths` reads a loop iterator's object off an envelope `collection` that names a variable, as it read the token before.
- **ADR-0087.** The step-18 D3 entry `flow-value-slot-template-dialect-refused` is amended. No key is removed, so there is no tombstone, and there is no D2 conversion.
