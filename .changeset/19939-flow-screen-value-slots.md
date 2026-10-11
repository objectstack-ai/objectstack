---
'@objectstack/spec': major
'@objectstack/service-automation': major
---

A `screen` node's three positions that hand a value to the client are value slots now: an object form's `defaults` (each field's prefill), a field's `defaultValue`, and an object form's `recordId` (the record an `edit` form opens). Each value is a CEL value envelope, `{ dialect: 'cel', source: '…' }`, that the executor evaluates in the run's scope before the screen goes on the wire, so the client receives the value it computes, never the envelope; or a literal, served as written. A `{…}` template token there is refused at `objectstack validate`, at `registerFlow` and by the executor, naming its CEL spelling, as in every other value slot. `recordId` gains the envelope arm, which it refused before this change, and its literal stays a string.

Clause-②: yes (narrowing: a {…} token is refused at screen.defaults.*, a field's defaultValue and screen.recordId; widening: screen.recordId accepts a CEL value envelope it refused, and its published JSON Schema and inferred type gain the envelope arm)

<!-- adr-0087: not-required (already-registered flow-value-slot-template-dialect-refused) The value-slot retirement's step-18 D3 entry, registered on this line before this change, is amended in this diff: its surface widens to a screen's defaults map, a field's defaultValue and recordId, and its replacement, reason and acceptance criteria say what each serves where the template served nothing. No new D3 entry and no D2 conversion: every whole-path spelling answers differently for an absent value. -->

**BREAKING**: an accept-set narrowing on a published authoring surface, beside one widening (`recordId` accepts a CEL value envelope), shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 2 makes a computed value whole-field CEL, and Decision 3 deletes the single brace. A screen's prefill and its record id are computed values handed to the client. Until now the executor ran each through the single-brace interpolator: a `{token}` resolved there, an envelope written in `defaults` or a `defaultValue` went to the client as the object `{ dialect: 'cel', source: '…' }` it spells, and `recordId` was the text of whatever the token found, so a token that found a record served the id `[object Object]`.

**What changes where a value may be absent.** Where a whole token resolved to nothing, the template served nothing there. Under CEL an absent variable or key fails the run at the screen, with its source, and the guarded form `has(vars.x) ? vars.x : null` serves `null`:

- In an object form's `defaults`, the form keeps a `null` prefill as a value and opens the field blank, over the object field's own `defaultValue`, which it applied when the prefill left the field out. To keep that default for an absent value, write it in the guard: `has(vars.x) ? vars.x : 'prospecting'`.
- A field's `defaultValue` seeds the field with `null`.
- `recordId` must evaluate to the record's id, a non-blank string. Anything else, `null` included, fails the run at the screen. The template served such a screen with no record id, and its `edit` form opened with no record and could not save. Where the record may be absent, route around the screen with a `decision` on the value instead of guarding the id.

The refusal at each position says what it serves.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `defaults: { account: '{account_id}' }` | `defaults: { account: { dialect: 'cel', source: 'account_id' } }` | an absent `account_id` fails the run; guarded, it prefills `null` and the field opens blank over the object field's `defaultValue` |
| `defaults: { stage: '{x}' }` where the object field's default should apply when `x` is absent | `defaults: { stage: { dialect: 'cel', source: "has(vars.x) ? vars.x : 'prospecting'" } }` | the default is written in the guard, because a `null` prefill is a value |
| `defaults: { parent: '{rec}' }` | `defaults: { parent: { dialect: 'cel', source: 'rec' } }` | the record is served as a map, a list as a list |
| `fields: [{ name: 'email', defaultValue: '{lead.email}' }]` | `fields: [{ name: 'email', defaultValue: { dialect: 'cel', source: 'lead.email' } }]` | guarded, it prefills `null` |
| `recordId: '{record.id}'` | `recordId: { dialect: 'cel', source: 'record.id' }` | the envelope must evaluate to a non-blank string id: `null`, a map or a list fails the run at the screen |
| `recordId: 'acc_1'` | unchanged | a string literal is the id |

**The one-line fix: write each value of a screen's `defaults`, each field's `defaultValue` and an object form's `recordId` as a CEL value envelope; write the object field's default into the guard where it should apply, and route around a screen whose record may be absent.**

**Who is affected, measured.** In this repository: the CRM example's lead conversion (`crm_convert_lead_wizard`: 3 `defaults` values in its two object-form steps), the object-form example in the flows guide, and test fixtures; all are migrated in this change. hotcrm's sites at these positions were not measured.

**Newly accepted.** A CEL value envelope at `recordId`, which `z.string()` refused before this change: the published JSON Schema for `recordId` gains the envelope arm (a string, or the envelope object), and so does the inferred `ScreenConfig['recordId']`.

**Still accepted, unchanged.** A CEL value envelope at `defaults` and at a field's `defaultValue`, and every literal at all three, a string `recordId` included. The single-brace dialect keeps resolving where it still lives: a `map` or `loop` `collection`, a `filter` value, a `notify` `recipients` entry, an `http` body. The value-slot retirement's earlier changesets on this line list a screen's `defaults` among those positions; this one supersedes that line.

### The kit

- **The contract.** `ScreenConfigSchema.defaults` and a field's `defaultValue` take `FlowValueSlotSchema`, and `recordId` takes a string or a CEL value envelope (`@objectstack/spec/automation`), so the executor's contract parse refuses a token as a guard. Each published JSON Schema declares the dropped refinement (`dropped-refinements.baseline.json`).
- **The ledger.** `FLOW_NODE_EXPRESSION_PATHS` gains `screen.defaults.*`, `screen.fields[].defaultValue` and `screen.recordId` (role `value`), and `LEDGER_DECLARED_NODE_CONFIG_SCHEMAS` carries `ScreenConfigSchema`. `registerFlow`, `objectstack validate` and `flow-bare-dollar-reference` / `flow-double-brace-interpolation`'s value-slot hints follow the ledger, so all of them cover the three positions. The build doors keep refusing a `recordId` literal that is not a string, as before.
- **The executor.** The `screen` node resolves each position through the value-slot resolver the CRUD `fields` map and a callee's input share: an envelope is evaluated by `AutomationEngine.evaluateValueEnvelope` in the run's scope, before the screen is served. A screen that passes through without pausing goes on no wire, and evaluates nothing.
- **ADR-0087.** The step-18 D3 entry `flow-value-slot-template-dialect-refused` is amended. No key is removed, so there is no tombstone, and there is no D2 conversion.
