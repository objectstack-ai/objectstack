---
'@objectstack/spec': major
'@objectstack/service-automation': major
---

The maps a flow node hands to a CALLEE are value slots now: a `subflow` node's `input`, a `map` node's `input` (evaluated once per item) and a `script` node's `inputs`. Each value is a CEL value envelope, `{ dialect: 'cel', source: '…' }`, evaluated in the calling flow's scope and handed over as the value it computes, or a literal written as it is. A `{…}` template token there is refused at `objectstack validate`, at `registerFlow` and by the executor, naming its CEL spelling, as in every other value slot.

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff: its surface widens to the three callee maps, and its replacement and reason gain what a guarded form's null does to a child flow's defaultValue. No new D3 entry and no D2 conversion: every whole-path spelling answers differently for an absent value. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 2 makes a computed value whole-field CEL, and Decision 3 deletes the single brace. These three maps are computed values: each one becomes the callee's input. Until now each executor handed its map to the single-brace interpolator, so a `{token}` resolved there, and a CEL envelope written there reached the callee as the object `{ dialect: 'cel', source: '…' }` it spells, with the run reporting success.

**What changes for a value that may be absent.** Where a whole token resolved to nothing, the template handed the callee nothing. A child flow then seeded its input variable from the variable's `defaultValue`. Under CEL an absent variable or key fails the run, and the guarded form `has(vars.x) ? vars.x : null` hands `null`. A `null` the caller supplies is a value: it wins over the child's `defaultValue`. To keep the default for an absent value, write it in the guard, `has(vars.x) ? vars.x : 'standard'`. Leave the key out where the value is never meant to be supplied. A `script` function is handed `null` where the template handed `undefined`. The refusal at those positions says this.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `input: { ownerId: '{record.owner}' }` on a `subflow` | `input: { ownerId: { dialect: 'cel', source: 'record.owner' } }` | an absent `owner` fails the run; guarded, it hands `null`, which wins over the child's `defaultValue` |
| `input: { ownerId: '{x}' }` where the child's default should apply when `x` is absent | `input: { ownerId: { dialect: 'cel', source: "has(vars.x) ? vars.x : 'standard'" } }` | the default is written in the guard, because a supplied `null` is not absent |
| `input: { row: '{item}' }` on a `map` | `input: { row: { dialect: 'cel', source: 'item' } }` | evaluated once per item, with the item variable bound; a list or a record is handed over with its type |
| `inputs: { lines: '{lines}' }` on a `script` | `inputs: { lines: { dialect: 'cel', source: 'lines' } }` | the function receives the list; guarded, an absent value is `null` where it was `undefined` |
| `input: { message: 'Task "{record.title}" is done.' }` | `input: { message: { dialect: 'cel', source: "'Task \"' + record.title + '\" is done.'" } }` | one CEL concatenation; wrap a hole that may be null in `coalesce(…, '')` |

**The one-line fix: write each value of a `subflow` / `map` `input` and a `script`'s `inputs` as a CEL value envelope, and write a child's default into the guard where it should apply.**

**Who is affected, measured.** In this repository: 5 values in 3 nodes of the showcase example (`showcase_task_completed`'s `script`, and the `subflow` nodes of `showcase_task_done_notify_owner` and `showcase_project_closure`), 3 values in the todo example's `task_completion` `script`, 2 docs pages, the service-automation README, 2 dogfood fixtures and the test fixtures; all are migrated in this change. hotcrm's sites at these positions were not measured.

**Still accepted, unchanged.** A CEL value envelope and every literal. The single-brace dialect keeps resolving where it still lives: a `map` or `loop` `collection`, a `filter` value, a `notify` `recipients` entry, an `http` body, a screen's `defaults`. The value-slot retirement's earlier changesets on this line list `subflow.input` among those positions; this one supersedes that line.

### The kit

- **The contract.** `SubflowConfigSchema.input`, `ScriptConfigSchema.inputs` and `MapConfigSchema.input` take `FlowValueSlotSchema` per value (`@objectstack/spec/automation`), so the executor's contract parse refuses a token as a guard. Each published JSON Schema declares the dropped refinement (`dropped-refinements.baseline.json`).
- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS` gains `subflow.input.*`, `map.input.*` and `script.inputs.*` (role `value`), and `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS` carries `MapConfigSchema`. `registerFlow`, `objectstack validate` and `flow-bare-dollar-reference` / `flow-double-brace-interpolation`'s value-slot hints follow the ledger, so all of them cover the three maps.
- **The executor.** One per-key resolver, shared with the CRUD `fields` map, evaluates an envelope through `AutomationEngine.evaluateValueEnvelope` in the parent's scope and run context.
- **ADR-0087.** The step-18 D3 entry `flow-value-slot-template-dialect-refused` is amended. No key is removed, so there is no tombstone, and there is no D2 conversion.
