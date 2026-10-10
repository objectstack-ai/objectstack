---
'@objectstack/spec': major
---

Every remaining place a flow binds a variable by name refuses a name that starts with `$`: a `loop` or `map` node's `iteratorVariable` and `indexVariable`, an object-form `screen` node's `idVariable`, a `screen` field's `name`, a declared flow variable's `name`, and an `assignment` node's targets. The refusal names the remedy: the same name without the `$`, read as `{{ name }}`.

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-binding-name-dollar-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** The `$` names are the flow engine's own variables: it binds `$record`, `$runId`, `$flowName`, `$flowLabel` and `$error`, a flat-graph `loop` binds `$loopItems` and `$loopIndex`, and a resume signal may not write any `$` name. A flow text slot refuses a `{{ }}` hole over a `$` name the engine does not bind, and `outputVariable` / `errorVariable` already refuse one. Every other binding took any string, and on the run a `$` binding was worse than unreadable (measured with the engine on this release's `main`):

- `iteratorVariable: '$record'` on a `loop` or `map` left `$record` holding the last item for the rest of the run, and `indexVariable: '$runId'` left `$runId` holding an index;
- `assignments: { $record: … }` overwrote the trigger record;
- a declared variable named `$record` was overwritten by the engine at run start, so its `defaultValue` never reached the run;
- a `screen` whose `idVariable` or field `name` was a `$` name paused, and then could never be submitted: the resume carrying the value was refused with `INVALID_SIGNAL`.

**What is refused.**

- `iteratorVariable` and `indexVariable` on `LoopConfigSchema` and `MapConfigSchema`, `idVariable` on `ScreenConfigSchema`, `name` on `ScreenFieldConfigSchema` and on `FlowVariableSchema`: a name that starts with `$`. Each key states the rule as a JSON Schema `pattern`, so the published `json-schema/**` refuses what the parse refuses. The parse issue is an `invalid_format` (regex) issue at the key, and its message names the remedy.
- An `assignment` node's targets, in each shape its executor binds: a key of the `assignments` map (`AssignmentConfigSchema` states it as `propertyNames.pattern`), a top-level key of the bare legacy config, and the `variable` (or `name`, `key`) of a legacy `assignments: [{ variable, value }]` item.
- `FlowSchema.parse`, `registerFlow` and `objectstack validate` refuse the flow where the name was written — `nodes.N.config.iteratorVariable`, `nodes.N.config.fields.M.name`, `nodes.N.config.assignments.NAME`, `variables.N.name` — inside a region body too. A stored flow carrying one is skipped at boot with a warn naming it, and the `loop`, `map` and `screen` executors' own contract parse refuses the node at run time.

**Unchanged.** Any name that does not start with `$`, a `$` later in the name (`a$b`) included; the defaults (`iteratorVariable` is still `item`); an empty string where the key took one; a body-less legacy `loop`, whose `iteratorVariable` nothing reads; and every hole the text-slot judge already admits. Non-string values keep the type refusal they had.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `iteratorVariable: '$row'` with `title: '{{ $row.name }}'` | `iteratorVariable: 'row'` with `title: '{{ row.name }}'` |
| `idVariable: '$account'` | `idVariable: 'account_id'`, read as `{{ account_id }}` |
| `variables: [{ name: '$total', type: 'number' }]` | `variables: [{ name: 'total', type: 'number' }]`, read as `{{ total }}` |
| `assignments: { $total: … }` | `assignments: { total: … }` |

**The one-line fix: name the variable without the `$`, and rename every read of it with it.**

No D2 conversion rewrites the name: the bare name may already be bound in the flow, and the reads of the old name sit in every dialect a flow string speaks (a text-slot hole, a CEL expression, a single-brace token in a value position), so the rename is the author's.

**Who is affected, measured.** The last published spec, `@objectstack/spec@17.7.0` (npm `latest`), types every one of these keys as a plain string. Measured on `main` at this change's base: the 35 flows `examples/app-crm`, `examples/app-todo` and `examples/app-showcase` ship all parse clean under the new rule, and a TypeScript-AST scan of `examples` (234 files), `packages/platform-objects` (167, which ships no flow), `packages/qa/dogfood` (280), the rest of `packages` and the `hotcrm` app found no `$`-led binding on any of these positions. The pinned `objectui` checkout binds none either. Deployed metadata and other repositories were not measured.

### The kit

- **The rule.** `flowBoundVariableNameSchema` in `automation/flow-bound-variable-name.ts`, package-internal (no new public export), now composed into every binding position. A `$` binding is refused with one sentence whichever door judges it.
- **The ledger.** The D3 semantic entry `flow-binding-name-dollar-refused` (protocol 18), with no D2 conversion.
