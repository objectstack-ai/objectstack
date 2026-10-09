---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

A `{{ }}` hole in a flow text slot (a `notify` node's `title` and `message`, a `screen` node's `title` and `description`, a refusing `end` node's `message`) whose root is a `$` name the flow engine does not bind is refused. It is refused at the same doors, and by the same judge (`textSlotTemplateRefusal`), as a single-brace token: the node contracts, `registerFlow` and `objectstack validate`. `'By {{ $User.Id }}'` used to pass all three and send `'By '`.

Clause-②: no (narrowing)

<!-- adr-0087: registered flow-text-slot-unbound-dollar-root-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** The hole grammar admits `$` in a name so that the engine's own variables have a spelling (`{{ $error.message }}`). That also makes `{{ $User.Id }}` a well-formed hole, but over a root no flow variable answers to. The text went out with the fragment missing, the run reported success, and nothing warned. Its single-brace spelling, `{$User.Id}`, was already refused with a remedy. The `$` names are reserved for the engine: a resume signal may not write one.

**What is refused.**

- A hole whose root is a `$` name other than the variables the engine binds: `$record`, `$runId`, `$flowName`, `$flowLabel`, `$error`, and a flat-graph `loop`'s `$loopItems` / `$loopIndex`.
  - `NotifyConfigSchema`, `ScreenConfigSchema` and `EndConfigSchema` raise a `custom` issue at the slot's key.
  - `registerFlow` refuses the flow, and a stored flow carrying such a hole is skipped at boot with a warn naming it.
  - `objectstack validate` reports `expression-invalid` at `error`.
- The remedy for `{{ $User.<path> }}` is the sentence `{$User.<path>}` gets: compute the value into a variable with an `assignment` node, whose value slot still reads that spelling, then write the variable as a hole. Any other root is named in the refusal, beside the variables the engine does bind.
- A single-brace path token over such a root (`'Failed: {$caught.message}'`) is no longer prescribed the `{{ }}` spelling, which would be refused in turn; it gets the same remedy.

**Unchanged.** `{{ $error.message }}`, `{{ record.name }}`, a node output `{{ lookup.result }}` and every hole over an engine-bound `$` variable. The template engine binds no new variable.

**`@objectstack/lint`.** In a text slot, `flow-bare-dollar-reference` prescribes the hole for a bare `$X.y` written outside the holes only when the judge admits that hole. A bare `$User.Id` gets the judge's refusal and remedy instead of a `{{ $User.Id }}` the judge refuses.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `message: 'By {{ $User.Id }}'` | an `assignment` node first, `assignments: { by: '{$User.Id}' }`, then `message: 'By {{ by }}'` |
| `errorVariable: '$caught'` with `message: 'Failed: {{ $caught.message }}'` | `errorVariable: 'caught'` with `'Failed: {{ caught.message }}'`, or keep the default `$error` and write `{{ $error.message }}` |

**The one-line fix: compute a run-user value into a variable first, and name a variable the flow binds itself without the `$`.**

**Who is affected, measured.** The last published spec, `@objectstack/spec@17.7.0` (npm `latest`), has no text-slot judge. Its `NotifyConfigSchema.title` / `.message`, `ScreenConfigSchema.title` / `.description` and `EndConfigSchema.message` are plain strings, so it accepts `'By {{ $User.Id }}'` in every one of these slots. Its single-brace interpolator substituted the inner `{ $User.Id }` token and left a literal brace on each side. This repository was measured with `git grep` over `examples`, `packages`, `skills`, `apps` and `content`: no flow text slot outside tests carries a `{{ $… }}` hole other than `{{ $error.… }}`. Deployed metadata and other repositories were not measured.

### The kit

- **The refusal.** `textSlotTemplateRefusal` in `automation/flow-text-slot-template.ts` reads one package-internal list of the `$` variables the engine binds. `@objectstack/service-automation`'s `text-slot-template.test.ts` scans that package's sources for every `$` variable they bind by name, and fails when the list misses one.
- **The ledger.** The D3 semantic entry `flow-text-slot-unbound-dollar-root-refused` (protocol 18). There is no D2 conversion: what the hole was meant to read is not in the flow.
