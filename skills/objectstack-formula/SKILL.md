---
name: objectstack-formula
description: >
  Author CEL expressions used across ObjectStack — formula fields,
  field conditional rules (`visibleWhen`, `readonlyWhen`, `requiredWhen`),
  validation / sharing / visibility predicates, flow conditions, and dynamic
  seed values. Use when the user is writing an `F`, `P`, or `cel`
  tagged-template literal, or asks "how do I express X as a formula /
  predicate". Do not use for SQL fragments (driver-native), cron schedules
  (cron dialect), or L2 hook bodies (those belong in objectstack-data).
license: Apache-2.0
compatibility: Requires @objectstack/spec 17.x and @objectstack/formula 17.x (CEL)
metadata:
  author: objectstack-ai
  version: "1.2"
  domain: expression
  tags: cel, formula, predicate, condition, validation, visibility, seed-dynamic
---

# Expressions (CEL) — ObjectStack Formula Protocol

ObjectStack has **one** expression language across every domain that needs
computation or boolean predicates: **CEL** (Google Common Expression
Language). This skill is the canonical reference for AI authors emitting
formula / condition / predicate / dynamic-seed metadata.

> **Predicates / formulas are bare CEL — never wrap field references in `{…}`
> braces.** The #1 authoring mistake is a condition like
> `{record.rating} >= 4`: in CEL, `{…}` is a **map literal**, so it is a parse
> error. Write bare CEL: `record.rating >= 4`. Braces are *only* for `{{ … }}`
> text templates (see Cron and template surfaces).

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

Every expression in metadata is the same envelope — `dialect` plus `source`,
with optional `ast` and `meta` — declared as `Expression` / `ExpressionInput` in
`shared/expression.zod.ts`. **Three registered dialects**:

| Dialect    | Engine                 | Purpose                                           | Helper        | Example                                |
|:-----------|:-----------------------|:--------------------------------------------------|:--------------|:---------------------------------------|
| `cel`      | `@marcbachmann/cel-js` | Computed values + boolean predicates              | `` cel`...` `` / `` F`...` `` / `` P`...` `` | `` cel`record.amount * 1.1` ``         |
| `cron`     | built-in validator     | Recurring schedules                               | `` cron`...` `` | `` cron`0 6 * * MON` ``               |
| `template` | built-in interpolator  | `{{path}}` text interpolation (notif/prompt/title) | `` tmpl`...` `` | `` tmpl`Hello {{record.first_name}}` ``|

There is **no `js` dialect** — it was retired. Procedural JavaScript is
the L2 `ScriptBody { language: 'js' }` authoring surface (hook bodies, mapping
transforms — see objectstack-data), not an expression dialect.

> **AI authors:** when emitting structured-output JSON for metadata, always
> emit the full envelope `{ dialect, source }` — never a bare string.

---

## CEL syntax cheat-sheet

| Concept | CEL |
|:---|:---|
| Current record field | `record.first_name` |
| Previous record (update hooks, validation rules) | `previous.status` — §5 |
| Master-detail line item's header | `parent.status` — cell `readonlyWhen` / `requiredWhen` |
| Metadata-editing form row | `data` — the row under edit, repeater rows included |
| Hook input payload | `input.amount` |
| Identity context | `os.user.id`, `os.org.id`, `os.org.tier`, `os.env` |
| Equality | `==` / `!=` |
| Logical | `&&` / `\|\|` / `!` |
| Ternary | `cond ? a : b` |
| String literal | `'abc'` — CEL parses `"abc"` too |
| Membership | `record.region in ['us', 'eu']` |
| Key existence (NOT null-safety) | `has(record.foo)` |
| Null check | `record.foo == null` or `isBlank(record.foo)` |

The org context is `{ id, tier }` — there is no `os.org.slug` or `os.org.name`.
The evaluator also binds the current user as `current_user` (alias `user`) per
ADR-0068 — spec field docs write predicates like `current_user.positions`.

### `has()` is NOT a null check

`has(record.x)` is **true whenever the key exists**, even when its value is
`null`. To check for "value present and non-blank" use the stdlib helper
`isBlank()` or compare to `null` explicitly.

Every predicate reads a `record` — and, where §5 binds it, a `previous` — that
is **total over the object's declared fields**: a declared column the driver
never returned reads as `null`, not as a fault. So `has(record.<declared_field>)`
and `has(previous.<declared_field>)` are uniformly `true` and tell you nothing at
all. The idiom that reads like a guard is not one:

```text
# WRONG — both has() calls are true on a NULL row, so this reaches `null < null`,
# CEL has no overload, the predicate aborts and the write is rejected.
has(record.start_date) && has(record.end_date) && record.end_date < record.start_date

# RIGHT
record.start_date != null && record.end_date != null && record.end_date < record.start_date
```

**This is a publish-time rejection, not advice.** `os build` /
`os validate` / `os lint` and the runtime publish gate reject any validation-rule
or hook predicate that applies an ordering (`< <= > >=`) or arithmetic
(`+ - * / %`) operator to a **declared nullable** field — no `required: true`,
no `defaultValue`, no default option — unless an explicit `!= null` / `== null` /
`!isBlank()` test dominates it in the same boolean branch. `has()` deliberately
does not satisfy that gate. `has()` over an **undeclared** key stays legal: that
is its real use — telling "absent from this PATCH" apart from "explicitly null".

### Null + string throws

CEL has no implicit `null` coercion. `null + 'foo'` throws
`no such overload: dyn<null> + string`. Wrap every nullable string operand
in `coalesce(..., '')`.

---

## ObjectStack CEL standard library

Registered automatically by `@objectstack/formula`, which ships `dist` only —
there is no `src/` to read in an installed app. Its exported
`CEL_STDLIB_FUNCTIONS` is the canonical list, pinned by two tests: every entry
resolves at runtime, and this table documents them all.

**Dates**

| Function | Returns | Notes |
|:---|:---|:---|
| `now()` | timestamp | Current instant. Pinned per evaluation run; deterministic in build |
| `today()` | timestamp | Reference-timezone **calendar day**, expressed as **UTC midnight** (not plain UTC start-of-day) |
| `daysFromNow(n)` | timestamp | Calendar-day: `today()` + `n` days, at **UTC midnight** (never carries time-of-day) |
| `daysAgo(n)` | timestamp | Calendar-day: `today()` − `n` days, at **UTC midnight** |
| `daysBetween(a, b)` | int | Whole days from `a` to `b` (negative if `b` precedes `a`). `daysBetween(today(), record.due)` = days remaining |
| `addDays(d, n)` | timestamp | Shift **any** date by `n` days (negative ok). `addDays(record.last_service, record.cycle_days)` = next due date |
| `addMonths(d, n)` | timestamp | Shift **any** date by `n` months; clamps to month-end (`addMonths(date('2026-01-31'), 1)` → Feb 28) |
| `date(s)` / `datetime(s)` | timestamp | Parse an ISO date / date-time string to a timestamp |

> **No date arithmetic.** A date mixed with a number faults and the build
> rejects it; `end - start` does not fault — it yields a `duration` stored as
> `{}`.

| Want | Write — never `end - start`, `date + n`, `today() + 30` |
|:---|:---|
| Span in days | `daysBetween(start, end)` |
| Inclusive span | `daysBetween(record.start_date, record.end_date) + 1` |
| Shift a date | `daysFromNow(n)` / `addDays(d, n)` / `addMonths(d, n)` |
| Tenure in years | `daysBetween(record.hire_date, today()) / 365` |
| Sub-day offset | `now() + duration("3h")` — the calendar helpers land on UTC midnight |

**Numbers**

| Function | Returns | Notes |
|:---|:---|:---|
| `abs(x)` | double | Absolute value |
| `round(x)` | int | Round to the nearest integer |
| `floor(x)` / `ceil(x)` | int | Round toward −∞ / +∞ (`floor(-1.2)` = −2, not −1) |
| `min(a, b)` / `max(a, b)` | dyn | Smaller / larger operand (numeric comparison) |

**Strings**

| Function | Returns | Notes |
|:---|:---|:---|
| `upper(s)` / `lower(s)` | string | Case conversion |
| `trim(s)` | string | Strip surrounding whitespace (`''` for null) |
| `contains(s, sub)` | bool | Substring test |
| `startsWith(s, p)` / `endsWith(s, p)` | bool | Prefix / suffix test |
| `matches(s, re)` | bool | Regex test |
| `joinNonEmpty(list, sep)` | string | Join, dropping null/empty entries |

**Collections / null-ish**

| Function | Returns | Notes |
|:---|:---|:---|
| `isBlank(v)` | bool | true for `null`, `undefined`, `''`, `[]` |
| `isEmpty(v)` | bool | true for `null`, `undefined`, empty string / list / map |
| `coalesce(v, fallback)` | dyn | `v` when non-null, else `fallback` |
| `len(v)` | int | Length of a string / list / map |

Plus CEL built-ins: `has(x)`, `size(x)`, `int(x)`, `string(x)`, `bool(x)`,
`double(x)`, `timestamp(s)`, `duration(s)`.

If you need a helper that doesn't exist, prefer adding it to the stdlib
(small, pure, dependency-free) over inlining a complex CEL expression.

> **Only the functions above are callable.** An UNKNOWN function — `PRIOR()`, a
> legacy `ISBLANK()`, a typo'd `isBlnk()` — **fails `os build`** with a
> "no matching overload" type error, rather than silently no-op'ing the
> predicate at run time. Use `previous.x` (not `PRIOR()`), `isBlank()` (not `ISBLANK()`).

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
  ? ((coalesce(record.revenue, 0) - record.cost) * 100) / record.cost
  : 0.0`
```

### 3. Predicate (field rules / visibility / validation)

✅

<!-- os:check -->
```ts
import { P } from '@objectstack/spec';

P`record.status == 'qualified'`;
P`record.amount > 10000 && record.region in ['us', 'eu']`;
P`!isBlank(record.po_number)`;
```

For field-level conditional rules, emit the canonical field properties:
`visibleWhen`, `readonlyWhen`, and `requiredWhen`. Never emit
`conditionalRequired` — it was REMOVED in protocol 17 and is a parse error.

❌ Salesforce-flavor — **fails CEL compile**: `os build` errors with a
located message, and the flow engine throws if it ever reaches runtime:

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

This is the determinism gate: two consecutive `os build` runs produce
byte-identical `dist/objectstack.json` only when every dynamic seed value is
`` cel`...` `` — no `new Date()`, no `Date.now()`, no random or otherwise
impure source. The stdlib helpers honour the pinned `now` from `EvalContext`,
so they are safe inside one.

### 5. Update hook condition — `previous` vs `record`

✅

```ts
P`previous.status != 'escalated' && record.status == 'escalated'`
```

ISCHANGED-style logic does not exist as a function; use explicit `previous`
comparison.

`record` is the record's **state**, not this write's diff: stored row ⊕
payload, so `record.status == 'escalated'` is true on *every* update of an
already-escalated record. Comparing against `previous` is the only way to say
"just became". Hook `condition`s and validation predicates bind the same two
roots — one scope, one meaning, whichever surface reads it.

**Where `previous` is bound, and where it is not:**

| Surface / event | `previous` |
|:---|:---|
| Update hook `condition` (single-record write), validation rule on update | the stored pre-write row |
| Insert events (`beforeInsert` / `afterInsert`), validation rule on insert | **unbound** — there is no prior state |
| **`after*` hook `condition` / record-change flow trigger on a predicate (`multi: true`) write** | **that row's pre-write row** — a bulk write fires after-hooks once PER MATCHED ROW |
| Validation rule on a predicate bulk update | that row's pre-write row — per row |
| `before*` hook `condition` on a predicate (`multi: true`) write | **unbound** — a `before*` hook fires ONCE for the whole batch (it may still rewrite the shared payload), so there is no single prior record. `record` is the bare payload here too, so a *declared* field this write does not set is unevaluable as well |

⚠️ **An unevaluable condition ABORTS the operation.** Referencing
`previous` where it is unbound — like a typo'd key (`record.stauts`), a retired
field, or a comparison CEL has no overload for — does **not** degrade to "the
hook did not fire": it **fails the write**, with an error naming the hook and
the key — `before*` and `after*` alike, with no `onError` escape (`onError`
governs a handler that throws, and the condition is evaluated before any handler
runs). A condition that does not even **compile** aborts the same way. So write
insert-event conditions over `record` alone.

**A transition condition needs no special handling for bulk writes.**
Write it once, on an `after*` event, and it means the same thing whether the
write carries an id or a predicate:

```ts
// Fires once per row that ACTUALLY transitioned — on `update(id)` and on
// `update({multi: true})` alike.
P`previous.status != 'done' && record.status == 'done'`
```

A predicate (`multi: true`) write is N record changes, so every record-scoped
declaration on it is evaluated **per row** — `previous` is that row's own
pre-write state, `record` its real state, not the bare payload (ADR-0058,
bulk-write addendum). Record-change flow triggers ride the same dispatch. The
one exception is the `before*` row of the table above, and it is not a bug to be
fixed later: put transition conditions on `after*`, and keep `before*`
conditions to the incoming payload (`record.<field this write sets>`).

Above ~10 000 matched rows the platform refuses a predicate write on an object
with after-hooks rather than fan out that many handler runs inside one write —
paginate the write. It is a refusal, never a silent downgrade to one hook call.

---

## Mechanical translation table (legacy → CEL)

When migrating Salesforce-flavor metadata, apply these rules in order:

| Legacy | CEL |
|:---|:---|
| `bare_field` | `record.bare_field` — except in a flow condition, below |
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

> ⚠️ `OLD.x` and `ISCHANGED(x)` both land on `previous.x`, which exists only
> where `previous` is **bound** — see §5. On an insert event, or in a `before*`
> hook condition on a `multi: true` predicate write, it is not; that
> does not quietly skip the hook, it **fails the write**. On `after*` events it
> IS bound, per matched row, on bulk and single-record writes alike.

> ⚠️ **Flow conditions are the exception to row 1.** The automation engine
> spreads the record's variables to top level, so a bare `status` resolves in a
> flow start condition. `record.status` resolves there too and is the only
> spelling valid on every other surface — prefer it.

---

## Surfaces that take an Expression

All of these spec fields accept `string | Expression`. The build normalizes
to the envelope.

### CEL surfaces (predicates + computed values)

| Surface | Field | Dialect |
|:---|:---|:---|
| `Field` | `expression` (when `type: 'formula'`) | cel |
| `Field` | `visibleWhen` / `readonlyWhen` / `requiredWhen` | cel |
| `View` / `Page` | `visibleWhen` (form section/field, page component) | cel |
| `Field` | `defaultValue` (envelope only; bare string = literal) | cel |
| `ConditionalValidation` | `when` | cel |
| `Action` | `disabled` | cel (or boolean) |
| `Hook` | `condition` | cel |
| `SharingRule` | `condition` | cel |
| `Flow.decision` | `expression` / edge `condition` | cel (use `vars.<step>.<key>`) |
| `Seed.records[*]` | any value | cel (via `cel\`\``) |
| `audit` / `metrics` / `tracing` | `condition` / `successCriteria` | structured \| cel |

⚠️ **A `formula` field is virtual — no driver materialises a column for it**, so
`where`, `orderBy` and `searchableFields` naming one are refused
`400 INVALID_FIELD` at both doors. It still READS correctly, which is why the
refusal is needed: a `where` on one used to answer `200` with zero rows.
Denormalise onto a stored field and query that. `summary` and `autonumber` have
real columns and need no such care.

⚠️ **A form-view `visibleWhen` is the one predicate here that faults OPEN.** It
is CLIENT-SIDE only, and an unbound root falls back to `true`, so the control
renders for everyone — never use one as access control; that is permission-set
field-level security. Everywhere else on this table the opposite holds: an
unevaluable `Hook` / `SharingRule` `condition` or validation predicate **aborts
the write** (§5).

View list filters are **not** a CEL surface — they are structured JSON filter
rules (`ViewFilterRuleSchema`), so do not emit CEL there. For "last 30 days"
style windows use the **date macro tokens** (`data/date-macros.zod.ts`) —
objectstack-query `rules/filters.md` has the token list.

### Cron and template surfaces

Two more registered dialects ride the same envelope. Neither is CEL, both
accept a bare string (auto-wrapped at validate time) or their helper, and both
read the same variable scope.

| Dialect | Helper | Grammar | Carriers |
|:---|:---|:---|:---|
| `cron` | `` cron`0 6 * * MON` `` | 5- or 6-field cron plus `@daily` / `@hourly` aliases | `Job.schedule.expression` (canonical), `connector.schedule`, `automation/execution.cronExpression`, `api/export.cronExpression` |
| `template` | `` tmpl`Hello {{ record.first_name }}` `` | `{{ path }}` or `{{ path \| formatter[:arg] }}` — double braces only, whitelisted formatters, no conditionals | `system/email-template` `subject` / `bodyHtml` / `bodyText`, `ai/model-registry` `promptTemplate.system` / `.user`, `Object.titleFormat` (deprecated → `nameField`, ADR-0079) |

Both surfaces are declared in `shared/expression.zod.ts`; read it for the full
carrier list, the formatter whitelist and the cron alias set. Missing template
paths render as the empty string. Move logic into a CEL field — a template
holds a path and a formatter, nothing else.

---

## Verify your work

A malformed expression does not fail silently (ADR-0032). It used to evaluate to
`null` / `false` — a flow "fired" and did nothing; now `os validate` and
`os build` run the shared validator over every formula and predicate in the
stack — CEL syntax **plus** `record.<field>` existence on the target object —
and fail non-zero with a located, did-you-mean message, while at runtime the
engine **throws** and the rule fails loudly. Use `os validate` as the fast
post-edit check (no artifact emitted; `npm run validate` in a scaffolded
project). To check a *single* expression before saving it, call the
`validate_expression` agent tool, which runs the same validator inline.

---

## See also

- [references/_index.md](./references/_index.md) — the Zod schemas behind every
  surface above
- `node_modules/@objectstack/spec/src/shared/expression.zod.ts` — `Expression`,
  `ExpressionInput`, `cel` / `F` / `P`
