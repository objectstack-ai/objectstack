---
'@objectstack/spec': major
'@objectstack/service-automation': major
'@objectstack/lint': major
'@objectstack/formula': minor
---

A flow TEXT slot — a `notify` node's `title` and `message`, a `screen` node's `title` and `description`, a refusing `end` node's `message` — reads ADR-0032 §3's `{{ }}` template holes, rendered by the formula template engine over the flow's variables. A single-brace `{…}` token in one is refused at `objectstack validate`, at `registerFlow` and by the node's contract, with the `{{ }}` spelling of each token.

Clause-②: yes (narrowing)

<!-- adr-0087: registered flow-text-slot-single-brace-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`).

**Why.** ADR-0032 Decision 3 fixes one template delimiter: "One delimiter, `{{ }}`; single `{ }` deleted." The notify pair was already typed as `template` slots, while the executor read the single brace, so a flow carried two template dialects and an author who met both mixed them.

**What changes.**

- **The renderer.** The five text slots render through one renderer (`renderTextSlot`, `@objectstack/service-automation`): `{{ path }}` and `{{ path | formatter[:arg] }}` holes, every other character literal. A hole reads a flow variable by name (`{{ record.name }}`, a node output `{{ lookup.result }}`, an index `{{ rows.0.subject }}` or `{{ rows[0].subject }}`, and a `$`-named one: `{{ $error.message }}`). `null` and an absent path render nothing, an object or array renders as JSON, a `Date` as its ISO text; the ADR-0032 formatters make the rest explicit (`{{ amount | currency }}`, `{{ due | date:long }}`). A hole holds no logic.
- **The refusal.** One judge in `@objectstack/spec/automation` (`textSlotTemplateRefusal`, `flowNodeTextSlotSources`, `FLOW_NODE_TEXT_SLOTS`, `TEXT_SLOT_TEMPLATE_REFUSAL`): `NotifyConfigSchema`, `ScreenConfigSchema` and `EndConfigSchema` refuse a single-brace token at the slot's key; `registerFlow` and `objectstack validate` (`expression-invalid`, `error`) refuse it with the same words and also compile every slot's holes, so `{{ a + b }}` or an unknown formatter is refused before a run. A stored flow carrying one is skipped at boot with a warn naming it. Past the doors, a hole that does not compile throws `FlowTextTemplateError`, a guard refusal.
- **`@objectstack/formula`.** A template hole's path may contain `$` (`{{ $error.message }}`): a widening of the hole grammar, so a host scope's `$`-named variable has a template spelling. An unbound one renders nothing, like any unknown path.
- **`flow-double-brace-interpolation`** no longer flags `{{ }}` on the text slots, and its hint names them as the only `{{ }}` positions; a bare `$ref.x` outside the holes of a text slot is flagged with the hole spelling.
- **Unchanged:** every other flow string keeps the single-brace dialect — `recipients`, `actionUrl`, `sourceId`, `payload`, `templateData` values, a screen's `recordId` / `defaults` / field `defaultValue`, `subflow.input`, `script.inputs`, `map.input`, `http`, `loop` / `map` `collection`, `filter` — and the value slots are CEL's.

**Not converted.** No ADR-0087 D2 conversion rewrites `{x}` to `{{ x }}`. The two renderers were run over the same variables: a path renders the same text for a string, a number, a boolean, `null`, an absent key or variable, an ISO date string, an object or an array, but a `Date` value rendered JSON-quoted under the 17.x interpolator (`"2026-10-08T09:30:00.000Z"`, quotes included) and as its ISO text now, and a screen or `end` text that was one token holding an object, an array or a `Date` rendered `String(value)` (`[object Object]`). So the rewrite is the author's to check; the D3 record is the semantic entry `flow-text-slot-single-brace-refused`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `title: 'Deal won: {record.name}'` | `title: 'Deal won: {{ record.name }}'` |
| `message: 'Failed: {$error.message}'` | `message: 'Failed: {{ $error.message }}'` |
| `message: 'Total {amount * 2}'`, `'{round(x)}'` | compute it first — `assignments: { v: { dialect: 'cel', source: 'amount * 2' } }` — then `'Total {{ v }}'` (a number format is a formatter: `{{ v \| number:2 }}`) |
| `message: 'Due {TODAY() + 7}'`, `'By {$User.Id}'` | compute it first with an `assignment` node, whose value slot still reads that spelling — `assignments: { due: '{TODAY() + 7}' }` — then `'Due {{ due }}'` |

**The one-line fix: double the braces of every path token in a text slot (`{x}` → `{{ x }}`), and compute anything else into a variable first.**

**Who is affected, measured.** This repository's in-tree text-slot sites — `examples/app-showcase` (24 strings, 30 tokens) and `examples/app-todo` (5 strings, 7 tokens), all of them paths — are rewritten in this change, with the docs pages that taught the single brace (`content/docs/automation/flows.mdx`, `content/docs/getting-started/common-patterns.mdx`). Other repositories and deployed metadata were not measured here.
