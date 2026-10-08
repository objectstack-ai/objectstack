---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': major
---

A flow VALUE slot no longer reads the single-brace `{…}` template dialect: a `create_record` / `update_record` `fields` value or an `assignment` value that carries a `{…}` token is refused at `objectstack validate`, at `registerFlow` and by the executor, with the CEL spelling of each token. A computed value is a CEL value envelope, `{ dialect: 'cel', source: '…' }`; a string is the literal text it spells.

Clause-②: yes (narrowing)

<!-- adr-0087: registered flow-value-slot-template-dialect-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** Since #19938 the value slots also evaluate a CEL value envelope, so a flow had two dialects for one job — two function sets, two meanings of `/`, and a template that wrote nothing where CEL refuses. The maintainer's ruling D on the flow expression dialects put the template's retirement from these slots on the v18 train, with a remedy for every spelling and an automatic conversion only where one is lossless (ADR-0087 D2).

**What is refused.** In every value slot — `create_record.fields.*`, `update_record.fields.*`, the `assignment` node's `assignments` map, and the two legacy `assignment` shapes the executor still reads (the `assignments: [{ variable, value }]` array and the bare `{ <variable>: <value> }` config) — a string, or a string at any depth of an array or object value, that carries a `{…}` token the interpolator would resolve. One judge says it everywhere (`flowNodeValueTemplateRefusals` / `valueSlotTemplateRefusals` in `@objectstack/spec/automation`): `FlowValueSlotSchema`, `AssignmentValueSchema`, `CreateRecordConfigSchema`, `UpdateRecordConfigSchema` and `AssignmentConfigSchema` refuse it at the value's path; `objectstack validate` reports it as `expression-invalid` at `error`, located at the node and `config.<path>`, which also refuses it at the metadata save door; `registerFlow` refuses the flow (a stored flow carrying one is skipped at boot with a warn naming it); and the `create_record` / `update_record` / `assignment` executors refuse the node before writing anything. Each refusal leads with `VALUE_SLOT_TEMPLATE_REFUSAL` and then names the CEL spelling of the string's tokens.

**Not converted.** No D2 conversion rewrites any spelling: every token spelling authored in flows answers differently under CEL for some input (measured through both engines over the same variables, 13 of 25 probes the same, 12 different), so a rewrite would change what some flow writes. Where a value may be absent, whether the field should take nothing, `null` or a default was decided silently by the template; it is now the author's decision.

**What is still accepted, unchanged.** A CEL value envelope, every literal (a token-free string, numbers, booleans, `null`, arrays, objects), and two spellings CEL cannot write yet, which keep their meaning until it can:

- the date macros — `{NOW()}`, `{TODAY()}`, with an optional `± N` day offset. CEL's `now()` / `today()` / `daysFromNow()` / `addDays()` yield a Timestamp, which reaches the data engine as a `Date` object rather than the ISO text the macro wrote, and CEL has no string form for one;
- the run user — `{$User.<path>}`. The flow CEL scope binds no user.

A string whose tokens include one of these is not refused. Text slots (`notify` `title` / `message`, a screen `description`, …) and `filter` values keep the template dialect.

## FROM → TO

| you wrote | write instead | what changes |
|:--|:--|:--|
| `'{record.owner}'`, `'{x}'` | `{ dialect: 'cel', source: 'record.owner' }` | CEL refuses an absent variable or key where the template wrote nothing — guard one that may be absent: `has(record.owner) ? record.owner : null`, `has(vars.x) ? vars.x : null` (writes `null`) |
| `'{list.0}'` | `{ dialect: 'cel', source: 'list[0]' }` | an empty list fails the run |
| `'{$error.message}'` | `{ dialect: 'cel', source: 'vars["$error"].message' }` | a `$`-named variable is read through `vars` |
| `'{round(x * 100) / 100}'` | `{ dialect: 'cel', source: 'round(x * 100) / 100.0' }` | CEL divides two integers as integers: keep a decimal operand on every division, or `123.46` becomes `123` |
| `'Renewal — {contract.number}'` | `{ dialect: 'cel', source: "'Renewal — ' + contract.number" }` | wrap a non-string hole in `string(…)`, one that may be null in `coalesce(…, '')` |
| braces meant literally, `'{"a": 1}'` | `{ dialect: 'cel', source: "'{\"a\": 1}'" }` | a CEL string literal |

**The one-line fix: write the CEL spelling the refusal names, and guard a value that may be absent.**

**Who is affected, measured.** A TypeScript-AST census of every `create_record` / `update_record` `fields` value and `assignment` value (all three shapes, same-file spreads included): this repository at `959c209d5` carried 21 authored sites (`examples/**` and `packages/verify/src`) — 20 refused (9 bare references, 10 dotted paths, 1 `$error` path, all migrated in this change) and 1 kept (`{$User.Id}`, `examples/app-todo`); hotcrm at `c529de2` carries 91 (2 of them through a same-file spread) — 71 refused (31 bare references, 36 dotted paths, 4 text with holes) and 20 kept (15 date macros, 5 `{$User.Id}`). Deployed metadata and other repositories were not measured.

### The kit

- **The refusal.** `automation/flow-value-slot-template.ts` (`VALUE_SLOT_TEMPLATE_REFUSAL`, `valueSlotTemplateRefusals`, `flowNodeValueTemplateRefusals`), composed into the value-slot contracts in `automation/builtin-node-config.zod.ts`; one new dropped-refinement site (`automation/AssignmentConfig` `out.catchall`, the bare legacy shape's values).
- **The doors.** `AutomationEngine.registerFlow` and the `create_record` / `update_record` / `assignment` executors (`@objectstack/service-automation`); `validateStackExpressions` (`@objectstack/lint`), whose `warning` hint pointing a template expression at the envelope this refusal replaces.
- **The ledger.** The D3 semantic entry `flow-value-slot-template-dialect-refused` (protocol 18). No key is removed, so there is no tombstone, and there is no D2 conversion: no authored spelling maps losslessly.
