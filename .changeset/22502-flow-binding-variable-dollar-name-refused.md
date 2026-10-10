---
'@objectstack/spec': major
---

A flow node's `outputVariable` (`get_record`, `create_record`, `map`, `script`, `subflow`) refuses a variable name that starts with `$`, and a `try_catch` node's `errorVariable` refuses every `$` name except the engine's own `$error`, its default. The refusal names the remedy: the same name without the `$`, read as `{{ name }}`.

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-binding-variable-dollar-name-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** The `$` names are the flow engine's own variables: it binds `$record`, `$runId`, `$flowName`, `$flowLabel` and `$error`, a flat-graph `loop` binds `$loopItems` and `$loopIndex`, and a resume signal may not write any `$` name. A flow text slot already refuses a `{{ }}` hole whose root is a `$` name the engine does not bind, and tells the author to drop the `$`. But the binding keys took any string, so a flow could bind `errorVariable: '$caught'` and then be refused `'Failed: {{ $caught.message }}'`. The two doors of one contract gave two answers. Now both give the text slot's answer.

**What is refused.**

- `outputVariable` on `GetRecordConfigSchema`, `CreateRecordConfigSchema`, `MapConfigSchema`, `ScriptConfigSchema` and `SubflowConfigSchema`: a name that starts with `$`. That includes the engine's own names, since a binding over `$record` would overwrite the trigger record for the rest of the run.
- `errorVariable` on `TryCatchConfigSchema`: a name that starts with `$`, other than `$error`.
- Each key states the rule as a JSON Schema `pattern`, so the published `json-schema/**` refuses what the parse refuses. The parse issue is an `invalid_format` (regex) issue at the key, and its message names the remedy.
- `FlowSchema.parse`, `registerFlow` and `objectstack validate` refuse the flow at `nodes.N.config.outputVariable` / `nodes.N.config.errorVariable`, inside a region body too (`nodes.N.config.try.nodes.M.config.outputVariable`). A stored flow carrying one is skipped at boot with a warn naming it, and each executor's own contract parse refuses the node at run time.

**Unchanged.** `errorVariable` absent (it defaults to `$error`) or an explicit `errorVariable: '$error'`; any name that does not start with `$`, a `$` later in the name (`a$b`) included; an empty string, which every executor reads as no binding; and every hole the text-slot judge already admits. Non-string values keep the type refusal they had.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `errorVariable: '$caught'` with `message: 'Failed: {{ $caught.message }}'` | `errorVariable: 'caught'` with `'Failed: {{ caught.message }}'`, or drop `errorVariable` and write `{{ $error.message }}` |
| `outputVariable: '$lead'` with `title: '{{ $lead.name }}'` | `outputVariable: 'lead'` with `title: '{{ lead.name }}'` |

**The one-line fix: name the variable without the `$`, and rename every read of it with it.**

No D2 conversion rewrites the name: the bare name may already be bound in the flow, and the reads of the old name sit in every dialect a flow string speaks (a text-slot hole, a CEL expression, a single-brace token in a value position), so the rename is the author's.

**Who is affected, measured.** The last published spec, `@objectstack/spec@17.7.0` (npm `latest`), types all six keys as plain strings and accepts any `$` name. This repository was measured with `git grep` over `packages`, `examples`, `skills`, `apps`, `content` and `docs`: the only `$`-named `errorVariable` / `outputVariable` other than `$error` were three test fixtures, all renamed here (`errorVariable: '$err'` in two `packages/spec` automation tests, `errorVariable: '$caught'` in a `service-automation` test). Every authored `errorVariable` in examples and docs is `$error`, which stays legal, and no example or doc binds a `$`-named `outputVariable`. The pinned `objectui` checkout uses `errorVariable: '$error'` only. Deployed metadata and other repositories were not measured.

### The kit

- **The rule.** `flowBoundVariableNameSchema` in `automation/flow-bound-variable-name.ts`, package-internal (no new public export), composed into the six keys. It reads the `$` prefix the engine's closed list implies, not a copy of the list.
- **The ledger.** The D3 semantic entry `flow-binding-variable-dollar-name-refused` (protocol 18), with no D2 conversion.
