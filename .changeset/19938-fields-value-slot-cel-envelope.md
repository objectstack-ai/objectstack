---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
"@objectstack/lint": minor
---

`create_record` / `update_record` field values accept the CEL value envelope, declared and evaluated together.

A value in a `create_record` or `update_record` node's `fields` map may now be a CEL value envelope, `{ dialect: 'cel', source: '…' }`, with the same shape and dialect rules the `assignment` node's `assignments` map already has. The envelope is evaluated by the expression engine that flow conditions use, so the whole CEL stdlib is reachable from a field value, and the result is written with its type kept:

```ts
fields: {
  subject: 'Quote for {account.name}',                                   // `{token}` template — unchanged
  total: { dialect: 'cel', source: 'round(amount * 100.0) / 100.0' },   // CEL, evaluated to the value written
}
```

Clause-②: yes (widening) — a published authoring slot's accept set grows (a valid envelope in `fields.*` is newly evaluated), and the one newly refused shape is the edge the `assignments` map accepted when it gained the envelope: a malformed one.

**What newly passes.** A valid CEL value envelope as a top-level `fields` value, on both nodes. Before this release the executor wrote such an object into the record verbatim: a text or JSON column stored `{"dialect":"cel","source":"…"}` and the run reported success, and a number column was refused by the data engine.

**What newly refuses.** A top-level `fields` value that is a plain object with a string `dialect` key and is NOT a valid CEL value envelope. That covers a missing, empty or whitespace-only `source`, an `ast` with no `source`, a `template` or `cron` dialect, and a `source` that does not parse as CEL. Every door refuses it, located at `config.fields.<field>`: `AutomationEngine.registerFlow` refuses the flow, `objectstack validate` reports an `expression-invalid` error, the runtime publish gate answers `422 INVALID_METADATA`, and the node's execute-time contract parse refuses it. Such an object used to be written as data.

**The rule for nested and literal values.** Only the top-level value of each field is judged. An object nested inside a JSON value or an array is data, whatever keys it carries, and strings inside it still interpolate. A plain string is always a `{token}` template with its existing meaning, and every other literal is written as before. A JSON column whose intended literal value is itself an object with a string `dialect` key is now read as an envelope. To write such an object as data, bind it to a flow variable and write `'{thatVariable}'` (a sole token keeps its type). Measured: no flow in this repository or in HotCRM writes an envelope-shaped object into `fields`.

**The refusal sentence is slot-neutral.** A refused field value used to be told it was "an assignment value". The sentence every value-slot refusal leads with is now `VALUE_ENVELOPE_REFUSAL`: "A value carrying a `dialect` key is read as an expression envelope, and this one is not a valid CEL value envelope." The published `ASSIGNMENT_VALUE_ENVELOPE_REFUSAL` is kept and is the same string, so code that matches on the constant keeps matching. Code that matched the old literal text ("An assignment value carrying…") does not.

**New in `@objectstack/spec/automation`** (5 exports, 0 removed):

- `VALUE_ENVELOPE_REFUSAL`, the slot-neutral refusal sentence.
- `FlowValueSlotSchema` / `FlowValueSlot` / `FlowValueSlotParsed`, the value contract every value slot shares (`AssignmentValueSchema` is the same rule under the assignment map's description).
- `resolveFlowNodeValueSlots(nodeType, config)`, which returns every authored value in the ledger's value slots, strings included.
- The expression ledger `FLOW_NODE_EXPRESSION_PATHS` has two new rows, `create_record.fields.*` and `update_record.fields.*` (role `value`), and `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS` carries both CRUD contracts.

**Author-time hint (`@objectstack/lint`).** `objectstack validate` warns when a value slot holds a `{…}` template expression, meaning arithmetic or a call to `round` / `floor` / `ceil` / `abs` / `min` / `max`, and points it at the envelope. The warning never fails a build, and the template form keeps working unchanged. Plain references, the `NOW()` / `TODAY()` macros and `$User` paths are not hinted. CEL's `now()` / `today()` are timestamps rather than the strings those macros write, and the flow's CEL scope binds no user.

**Corrected guidance: `/ 100.0`, not `/ 100`.** The template dialect's `round()` arity refusal used to call `round(x * 100) / 100` the CEL authoring pattern. In CEL that expression truncates: `round()` returns an int, and int / int is integer division, so `x = 1234.5678` gives `1234` instead of `1234.57`. The refusal now prescribes `round(x * 100) / 100.0`, which is correct in both dialects. In the template dialect `/ 100` and `/ 100.0` give the same value.
