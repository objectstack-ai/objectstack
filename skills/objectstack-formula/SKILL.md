---
name: objectstack-formula
description: >
  Author CEL expressions used across ObjectStack — formula fields,
  validation / sharing / visibility predicates, flow conditions, and dynamic
  seed values. Use whenever the user is writing an `F`, `P`, or `cel`
  tagged-template literal, or asks "how do I express X as a formula /
  predicate". Do not use for SQL fragments (driver-native), cron schedules
  (cron dialect), or L2 hook bodies (those belong in objectstack-data).
license: Apache-2.0
compatibility: Requires @objectstack/spec v4+ and @objectstack/formula
metadata:
  author: objectstack-ai
  version: "1.0"
  domain: expression
  tags: cel, formula, predicate, condition, validation, visibility, seed-dynamic
---

# Expressions (CEL) — ObjectStack Formula Protocol

ObjectStack has **one** expression language across every domain that needs
computation or boolean predicates: **CEL** (Google Common Expression
Language). This skill is the canonical reference for AI authors emitting
formula / condition / predicate / dynamic-seed metadata.

> **Strategic context.** The future authors of metadata are AI agents.
> CEL was chosen because it has (a) a formal grammar, (b) a public training
> corpus, (c) AST-first persistence, and (d) sandboxed bounded execution.
> The previous custom Salesforce-flavor engine was **deleted** in M9.5.
>
> **Predicates / formulas are bare CEL — never wrap field references in `{…}`
> braces.** The #1 authoring mistake (root cause of #1491) is a condition like
> `{record.rating} >= 4`: in CEL, `{…}` is a **map literal**, so it is a parse
> error. Write bare CEL: `record.rating >= 4`. Braces are *only* for `{{ … }}`
> text templates (see Template surfaces).
>
> **As of 7.6 (ADR-0032) a malformed expression no longer fails silently.**
> It used to evaluate to `null`/`false` (a flow "fired" but did nothing). Now
> `objectstack build` **fails** with a located, corrective, schema-aware message
> (unknown `record.<field>` → did-you-mean), and at runtime the engine **throws**
> (the flow/rule fails loudly). The `validate_expression` agent tool runs the
> same shared validator so you can check an expression *before* saving.

---

## Skill Boundaries

| Need | Use instead |
|:---|:---|
| Define a `type: 'formula'` field | objectstack-data (and embed CEL via `F\`...\``) |
| Define seed records | objectstack-data (use `cel\`...\`` for dynamic dates) |
| Author flow / automation step | objectstack-automation (use `P\`...\`` for `condition`) |
| Author L2 hook body (TS code) | objectstack-data |
| Cron schedule | objectstack-automation (`schedule.expression` is `cron` dialect) |
| SQL fragment | driver-native; not unified into the expression registry |

---

## Core contract

Every expression in metadata is the same envelope:

```ts
type Expression = {
  dialect: 'cel' | 'js' | 'cron' | 'template';
  source?: string;
  ast?: unknown;
  meta?: { rationale?: string; generatedBy?: string };
};
```

**Four registered dialects** (M9.9):

| Dialect    | Engine                 | Purpose                                           | Helper        | Example                                |
|:-----------|:-----------------------|:--------------------------------------------------|:--------------|:---------------------------------------|
| `cel`      | `@marcbachmann/cel-js` | Computed values + boolean predicates              | `` cel`...` `` / `` F`...` `` / `` P`...` `` | `` cel`record.amount * 1.1` ``         |
| `cron`     | built-in validator     | Recurring schedules                               | `` cron`...` `` | `` cron`0 6 * * MON` ``               |
| `template` | built-in interpolator  | `{{path}}` text interpolation (notif/prompt/title) | `` tmpl`...` `` | `` tmpl`Hello {{record.first_name}}` ``|
| `js`       | (sandboxed, future)    | Edge cases needing arbitrary JS — avoid           | n/a           | reserved                               |

**Authors emit the right dialect for the surface.** Bare strings on cron and
template fields are auto-wrapped at validate time, but emitting the full
envelope is preferred for clarity. `cron` and `template` use the same variable
scope as CEL — you do **not** learn three languages.

> **AI authors:** when emitting structured-output JSON for metadata, always
> emit the full envelope `{ dialect, source }` — do not emit bare strings.
> After M9.7 lands, you will emit `ast` directly. Until then, emit `source`
> and let `objectstack compile` parse it.

---

## CEL syntax cheat-sheet

| Concept | CEL |
|:---|:---|
| Current record field | `record.first_name` |
| Previous record (update hooks) | `previous.status` |
| Hook input payload | `input.amount` |
| Identity context | `os.user.id`, `os.org.slug`, `os.env` |
| Equality | `==` / `!=` |
| Logical | `&&` / `\|\|` / `!` |
| Ternary | `cond ? a : b` |
| String literal | `'single quotes'` (always) |
| Membership | `record.region in ['us', 'eu']` |
| Key existence (NOT null-safety) | `has(record.foo)` |
| Null check | `record.foo == null` or `isBlank(record.foo)` |

### `has()` is NOT a null check

`has(record.x)` is **true whenever the key exists**, even when its value is
`null`. To check for "value present and non-blank" use the stdlib helper
`isBlank()` or compare to `null` explicitly.

### Null + string throws

CEL has no implicit `null` coercion. `null + 'foo'` throws
`no such overload: dyn<null> + string`. Wrap every nullable string operand
in `coalesce(..., '')`.

---

## ObjectStack CEL standard library

Registered automatically. Source:
[`packages/formula/src/stdlib.ts`](../../packages/formula/src/stdlib.ts).

| Function | Returns | Notes |
|:---|:---|:---|
| `now()` | timestamp | Pinned per evaluation run; deterministic in build |
| `today()` | timestamp | UTC start-of-day |
| `daysFromNow(n)` | timestamp | `today() + n*24h` |
| `daysAgo(n)` | timestamp | `today() - n*24h` |
| `isBlank(v)` | bool | true for `null`, `undefined`, `''`, `[]` |
| `coalesce(v, fallback)` | dyn | `v` when non-null, else `fallback` |

If you need a helper that doesn't exist, prefer adding it to the stdlib
(small, pure, dependency-free) over inlining a complex CEL expression.

---

## Mandatory patterns for AI emission

### 1. Computed text formula — always coalesce nullable operands

✅ **Correct**

```ts
F`coalesce(record.salutation, '') + ' '
  + coalesce(record.first_name, '') + ' '
  + coalesce(record.last_name, '')`
```

❌ **Wrong** (CEL throws on null + string)

```ts
F`record.salutation + ' ' + record.first_name + ' ' + record.last_name`
```

### 2. Conditional numeric formula — guard divisor

✅

```ts
F`coalesce(record.cost, 0) > 0
  ? ((coalesce(record.revenue, 0) - record.cost) * 100.0) / record.cost
  : 0.0`
```

### 3. Predicate (visibility / required / validation)

✅

```ts
P`record.status == 'qualified'`
P`record.amount > 10000 && record.region in ['us', 'eu']`
P`!isBlank(record.po_number)`
```

❌ Salesforce-flavor — will compile but evaluate to `null`:

```ts
"status = 'qualified'"
"amount > 10000 AND region IN ('us', 'eu')"
"NOT(ISBLANK(po_number))"
```

### 4. Dynamic seed value — use `cel\`\`` not `new Date()`

✅

```ts
{ close_date: cel`daysFromNow(45)`, created_at: cel`now()` }
```

❌ Compile-time evaluation — every customer gets the package author's clock:

```ts
{ close_date: new Date(Date.now() + 45 * 86400000), created_at: new Date() }
```

This is the determinism gate: `objectstack build` runs twice produce
byte-identical `dist/objectstack.json` only when seed dates use CEL.

### 5. Update hook condition — `previous` vs `record`

✅

```ts
P`previous.status != 'escalated' && record.status == 'escalated'`
```

ISCHANGED-style logic does not exist as a function; use explicit `previous`
comparison.

---

## Mechanical translation table (legacy → CEL)

When migrating Salesforce-flavor metadata, apply these rules in order:

| Legacy | CEL |
|:---|:---|
| `bare_field` | `record.bare_field` |
| `OLD.x` | `previous.x` |
| `NEW.x` | `record.x` |
| `=` (comparison) | `==` |
| `<>` | `!=` |
| `AND` | `&&` |
| `OR` | `\|\|` |
| `NOT(x)` | `!x` |
| `"abc"` | `'abc'` |
| `IF(c, a, b)` | `c ? a : b` |
| `ISBLANK(x)` | `isBlank(record.x)` |
| `CONCAT(a, b)` | `coalesce(a, '') + coalesce(b, '')` |
| `TODAY()` / `NOW()` | `today()` / `now()` |
| `IN (a, b, c)` | `in [a, b, c]` |
| `ISCHANGED(x)` | `previous.x != record.x` |
| `MONTH_DIFF`, `MID`, `LEFT`, `RIGHT`, `SUBSTITUTE` | _not in stdlib — propose addition_ |

---

## Surfaces that take an Expression

All of these spec fields accept `string | Expression`. The build normalizes
to the envelope.

### CEL surfaces (predicates + computed values)

| Surface | Field | Dialect |
|:---|:---|:---|
| `Field` | `formula` (when `type: 'formula'`) | cel |
| `Field` | `conditionalRequired` | cel |
| `Field` | `visibleOn` | cel |
| `Field` | `defaultValue` (M9.9b) | cel |
| `ConditionalValidation` | `when` | cel |
| `ObjectFieldGroup` | `visibleOn` | cel |
| `View` | `visibleOn` | cel |
| `View.criteria` | filter expression | cel |
| `Action` | `disabled` | cel (or boolean) |
| `Hook` | `condition` | cel |
| `SharingRule` | `condition` | cel |
| `Flow.decision` | `expression` / edge `condition` | cel (use `vars.<step>.<key>`) |
| `Workflow.Task` | `dueDate` | cel (e.g. `cel\`daysFromNow(3)\``) |
| `Workflow` | `criteria` | cel |
| `GraphQL.ComputedField` | `expression` | cel |
| `Dataset.records[*]` | any value | cel (via `cel\`\``) |
| `audit` / `metrics` / `tracing` | `condition` / `successCriteria` | structured \| cel |

### Cron surfaces (recurring schedules)

All accept bare strings (auto-wrapped to `{dialect:'cron', source}`) or the
`` cron`...` `` helper. 5- or 6-field cron + aliases (`@daily`, `@hourly`, …).

| Surface | Field |
|:---|:---|
| `Job.schedule.expression` | canonical |
| `connector.schedule`, `etl.schedule`, `sync.schedule` | pipelines |
| `system/cache.schedule` | warmup |
| `system/disaster-recovery.schedule` | backup + drill |
| `automation/execution.cronExpression` | scheduled state |
| `api/export.cronExpression` | scheduled exports (×2) |
| `ai/orchestration.cron` | recurring runs |
| `ai/devops-agent.iterationFrequency` | iteration cadence |

### Template surfaces (`{{ path }}` interpolation)

Mustache subset — a **field/variable path** plus an optional **whitelisted
formatter**: `{{ path }}` or `{{ path | formatter[:arg] }}`. No conditionals,
no arbitrary logic (move logic into a CEL field). Same variable scope as CEL.
Double braces only — single `{x}` is **not** a valid hole.

**Formatters (7.6)** — value→string is defined per formatter (not implicit):

| Formatter | Example | Output |
|:---|:---|:---|
| `currency[:CODE]` | `{{ record.amount \| currency }}` / `:EUR` | `$1,234.50` |
| `number[:decimals]` | `{{ record.n \| number:2 }}` | `1,234.50` |
| `percent[:decimals]` | `{{ record.rate \| percent }}` (0.42→) | `42%` |
| `date[:short\|long\|iso]` / `datetime[:…]` | `{{ record.due \| date:long }}` | locale date |
| `upper` / `lower` / `trim` | `{{ record.code \| upper }}` | `ABC` |
| `truncate:N` | `{{ record.body \| truncate:80 }}` | `…` |
| `default:'…'` | `{{ record.x \| default:'N/A' }}` | fallback |
| `json` | `{{ record.obj \| json }}` | JSON |

```ts
tmpl`Deal {{ record.name }} — {{ record.amount | currency }} closes {{ record.close_date | date:long }}`
```

| Surface | Field |
|:---|:---|
| `Object.titleFormat` | record title |
| `system/notification` | email subject + body, SMS message, push body + message (5 fields) |
| `ai/model-registry` | systemPrompt, userPromptTemplate |
| `ai/agent-action` | subject, message |
| `ai/nlq.systemPrompt`, `ai/mcp.systemPrompt` | prompt templates |
| `integration/connector/github` | titleTemplate, bodyTemplate (PR + release) |
| `api/graphql` | cache key |

### JS surface (sandboxed body)

Reserved for L2 hook bodies / mapping transforms. Use TypeScript source.

---

## Cron quick reference

```ts
import { cron } from '@objectstack/spec';

schedule: cron`0 6 * * MON`        // every Monday at 06:00
schedule: cron`@daily`             // alias — every midnight
schedule: cron`*/15 * * * *`       // every 15 minutes
```

Bare strings work too on cron-typed fields, but the `cron` helper makes intent
explicit.

---

## Template quick reference

```ts
import { tmpl } from '@objectstack/spec';

titleFormat: tmpl`{{record.first_name}} {{record.last_name}}`
subject:     tmpl`Welcome to {{os.org.name}}, {{os.user.name}}!`
```

Missing paths render as empty string. `Date` instances are ISO-formatted.

---

## Determinism contract

Builds are deterministic only if:

1. All seed dynamic values use `cel\`...\`` (no `new Date()`, no `Date.now()`).
2. CEL stdlib helpers honor the pinned `now` from `EvalContext`.
3. No expression source contains random / non-pure data.

CI runs `objectstack build` twice and asserts SHA-1 match.

---

## Open questions (track in ROADMAP M9.7+)

- Authors will emit `ast` directly once `CelExprSchema` is published as JSON
  Schema for AI constrained decoding (M9.7).
- A visual node-graph editor backed by `CelExprSchema` is M9.8 (Studio).

---

## See also

- [`content/docs/guides/formula.mdx`](../../content/docs/guides/formula.mdx) — human-facing guide
- [`packages/formula/`](../../packages/formula/) — engine + stdlib
- [`packages/spec/src/shared/expression.zod.ts`](../../packages/spec/src/shared/expression.zod.ts) — `Expression`, `ExpressionInput`, `cel` / `F` / `P`
- ROADMAP M9 — Expression Unification milestone
- north-star §8 — "No private expression DSL"
