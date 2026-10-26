# ObjectUI Schema Expressions

Writing and debugging dynamic expressions in ObjectUI schemas. The expression system is the core of ObjectUI's dynamic behavior — it controls visibility, disabled states, computed content, and data-driven props.

## Architecture overview

ObjectUI uses a two-tier expression evaluator:

1. **Template expressions** — strings containing `${...}` placeholders: `"Hello ${user.name}"`
2. **Condition expressions** — raw boolean expressions without wrappers: `data.role === 'admin'`

Both are parsed by a **recursive-descent parser** (no `eval()`, no `new Function()`). This means expressions are CSP-safe and work under strict Content Security Policy headers.

Key files (for reference, not for editing):
- `packages/core/src/evaluator/ExpressionEvaluator.ts` — main entry point
- `packages/core/src/evaluator/SafeExpressionParser.ts` — recursive-descent parser
- `packages/core/src/evaluator/ExpressionContext.ts` — scope stacking
- `packages/core/src/evaluator/FormulaFunctions.ts` — built-in functions
- `packages/core/src/evaluator/ExpressionCache.ts` — LFU caching
- `packages/react/src/SchemaRenderer.tsx` — integration layer (the
  `evaluatedSchema` memo; grep that name rather than a line number)

## What gets expression-evaluated

Evaluation and *readback* are two separate gates: a value is visible only if
`SchemaRenderer` evaluates it **and** the renderer reads the key it sits on. The
full boundary tables -- the evaluated fields, the raw ones, `visible` over
`hidden` precedence, and what `props` versus `properties` each do with a value
-- are in [`rules/protocol.md`](../rules/protocol.md), which is the anchor for
this rule. The four cases that decide most schemas:

<!-- doc-json: fragment — deliberate counter-example: a title parked under props is evaluated, then dropped, and props is no declared key -->
<!-- os:check -->
```jsonc
// Evaluated, then dropped -- renders an empty card
{ "type": "card", "props": { "title": "${data.customer.name}" } }
```

<!-- os:check -->
```jsonc
// `card` declares `title`, so on the node it is evaluated AND read
{ "type": "card", "title": "${data.customer.name}" }
```

<!-- doc-json: fragment — deliberate counter-example: value is retired from text and refused by name; the fix beside it writes content -->
<!-- os:check -->
```jsonc
// `value` is RETIRED from `text` -- refused by name; write `content`
{ "type": "text", "value": "${data.customer.name}" }
```

<!-- os:check -->
```jsonc
// `content` is evaluated on every component type
{ "type": "text", "content": "${data.customer.name}" }
```

`title` / `label` / `value` / `description` are template-evaluated on the types
that declare them -- `statistic` (`label` / `value` / `description`), `card`
(`title` / `description`), `button` (`label`) -- and read raw everywhere else.
The set is closed and declared in `@objectstack/spec`.

## Template expression syntax (`${}`)

### Basic property access
```
${user.name}                    → "Alice"
${user.address.city}            → "San Francisco"
${items[0].name}                → "Widget A"
```

### Operators
```
${price * quantity}             → 150
${total > 1000 ? "High" : "Low"}  → "High"
${name || "Anonymous"}          → fallback value
${data.value ?? "default"}      → nullish coalescing
${!isLocked}                    → boolean negation
```

### Supported operators (full list)
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `>`, `<`, `>=`, `<=`, `==`, `===`, `!=`, `!==`
- Logical: `&&`, `||`, `!`
- Ternary: `condition ? trueVal : falseVal`
- Nullish coalescing: `??`
- Optional chaining: `?.`
- Unary: `!`, unary `-` / `+`, `typeof`
- Method calls: `.toUpperCase()`, `.includes()`, `.filter()`, `.map()`, `.length`
- Primaries: literals, identifiers, `( … )`, array literals `[1, 2]`, and a
  single-param arrow (`items.filter(i => i.active)`)

### Type preservation

When the entire string is a single `${expression}`, the result preserves its type:
```
"${data.count}"        → returns number 42, not string "42"
"${data.isActive}"     → returns boolean true, not string "true"
"Count: ${data.count}" → returns string "Count: 42" (mixed template)
```

### Multiple interpolations
```
"${user.firstName} ${user.lastName} (${user.role})"
→ "Alice Smith (admin)"
```

## Available scope variables

Expression scope is published by the **host**, through `PredicateScopeProvider`.
Every key of the `scope` you hand it becomes a root the evaluator can read:

<!-- os:check -->
```tsx
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react'
import type { SchemaRendererProps } from '@object-ui/react'

declare const schema: SchemaRendererProps['schema']

// Every name here becomes a root this page's expressions can read — `data`
// included, which is now a name YOU publish rather than one the renderer binds.
const scope = {
  users: [{ id: 1, name: 'Ada Lovelace' }],
  metrics: { total: 42 },
  data: { fieldName: 'Ada Lovelace' },
}

function Page() {
  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

| Variable | Source | Example |
|----------|--------|---------|
| every key of `scope` | the host's `PredicateScopeProvider` | `${users}`, `${metrics.total}` |
| `data` | a key of `scope` like any other — every `${data.*}` example on this page assumes a host that published one, as above | `${data.fieldName}` |
| `current_user` / `user` | the same channel; an app-shell host's `ExpressionProvider` already feeds it | `${current_user.email}` |
| `record` | the row a record surface is bound to, when there is one | `${record.status}` |
| `page` | Page-local state (`PageSchema.variables`) | `${page.selectedId}` |

That is the whole scope. There is **no `item` and no `index`** — the evaluator
context is built once per node, not once per array element. See "No per-item
template iteration" below.

> ### ⛔ `dataSource` is not an expression root, and this is not a renaming
>
> `SchemaRendererProvider`'s `dataSource` carries the host's `DataSource`
> **adapter** — the object a renderer calls `find()` on. The renderer used to
> publish that adapter under the name `data`. An adapter answers no `data.*`
> path an author would write, so that root was silently constant for every
> conformant host, and it has been removed (maintainer ruling 2026-09-13).
>
> **Re-check every gate you authored from an older copy of this page: the
> verdict moved.** A root that is MISSING and a root that is PRESENT-but-empty
> are not the same thing, and the two layers that read `${…}` answer a missing
> root differently. Measured on the built evaluator with `data.status == 'draft'`:
>
> | what the scope holds | as a predicate (`visible` / `hidden`) | interpolated into a text key (`content`) |
> |---|---|---|
> | `data` bound to the adapter, which has no `status` member | `false` | `false` |
> | `data` present and `undefined` | `false` | `false` |
> | no `data` root at all — what you get now unless you publish one | **fails soft to `true`** | **the template's own source characters are printed on screen** |
>
> Read both columns. The predicate layer fails soft, so
> `"visible": "${data.status == 'draft'}"` written against the old wiring was
> **hidden on every row** and is now **shown on every row**; spelled `"hidden"`
> it flips the other way. The interpolation layer does not fail soft to
> anything — it hands back the characters you typed, so a `content` built from
> a missing root renders the literal text `${data.status == 'draft'}` to the
> user. The node-gate diagnostic warns about the predicate case.
>
> ⛔ Re-publishing `data` through `PredicateScopeProvider` restores the old,
> always-`false` verdict — it does not make the gate work. Give the gate a root
> that actually holds the row: at the runtime layer that root is **`record`**
> (ADR-0089 D3, whose `CANONICAL_ROOT_BY_LAYER` puts `record` at the runtime
> layer and `data` at the metadata layer).

### Safe globals (always available)
- `Math` — `${Math.round(price)}`, `${Math.max(a, b)}`
- `JSON` — `${JSON.stringify(obj)}`
- `parseInt`, `parseFloat`, `isNaN`, `isFinite`

## Formula functions

Built-in functions available in expressions (via `FormulaFunctions.ts`):

### Aggregation
```
${SUM(items, 'price')}          → sum of price field
${AVG(scores)}                  → average
${COUNT(users)}                 → count
${MIN(values)}                  → minimum
${MAX(values)}                  → maximum
${MEDIAN(values)}  ${PERCENTILE(90, values)}  ${STDEV(values)}  ${VARIANCE(values)}
```

### Logic
```
${IF(score > 90, "A", IF(score > 80, "B", "C"))}
${SWITCH(tier, 1, "gold", 2, "silver", "other")}
${AND(isActive, hasPermission)}
${OR(isAdmin, isOwner)}
${NOT(isLocked)}
```

### String
```
${UPPER(name)}                  → "ALICE"
${LOWER(email)}                 → "alice@example.com"
${CONCAT(firstName, " ", lastName)}  → "Alice Smith"
${TRIM(s)}  ${LEN(s)}  ${LEFT(s, 3)}  ${RIGHT(s, 3)}  ${SUBSTRING(s, 0, 3)}
${FIND("@", s)}  ${REPLACE(s, "a", "b")}  ${REGEX(s, "^[0-9]+$")}
```

`PERCENTILE` takes 0–100, not 0–1; `FIND(search, text)` puts the needle first
and returns a **0-based** index (`-1` when absent).

### Date
```
${TODAY()}                      → current date
${NOW()}                        → current datetime
${DATEADD(startDate, 7, 'days')}
${DATEDIFF(startDate, endDate, 'days')}
${DATEFORMAT(createdAt, 'YYYY-MM-DD')}
```

That is the whole registry — **30 functions**, all of them registered by
`FormulaFunctions.registerDefaults()`. `register(name, fn)` upper-cases the
name, so calls are case-insensitive.

## Condition fields (visibility and disabled)

### Syntax options

Each condition field has two forms — a shorthand and an `On` suffix:

<!-- os:check -->
```jsonc
{ "hidden": true } // static boolean
```

<!-- os:check -->
```jsonc
{ "hidden": "${data.role !== 'admin'}" } // template expression
```

<!-- os:check -->
```jsonc
{ "hiddenOn": "data.role !== 'admin'" } // raw expression (no ${} needed)
```

The `On` variants accept raw expressions without `${}` wrapping — the entire string is the expression.

### Visibility patterns

**Role-based:**
<!-- os:check -->
```json
{ "hidden": "${data.userRole !== 'admin'}" }
```

**Status-based:**
<!-- os:check -->
```json
{ "visible": "${data.record.status === 'active'}" }
```

**Data-dependent:**
<!-- os:check -->
```json
{ "hidden": "${!data.items || data.items.length === 0}" }
```

**Combined conditions:**
<!-- os:check -->
```json
{ "visibleOn": "data.isAuthenticated && data.permissions.canEdit" }
```

### Disabled patterns

<!-- os:check -->
```json
{ "disabled": "${form.isSubmitting}" }
```

<!-- os:check -->
```json
{ "disabledOn": "!data.canPerformAction || data.isLocked" }
```

## Field-level conditional rules (`visibleWhen` / `readonlyWhen` / `requiredWhen`)

These live on the **object's field metadata**, are written in CEL, and are
evaluated by `@objectstack/formula` -- a different tier from the `${}` / `On`
conditions above, which are schema/widget-level and run on the recursive-descent
`SafeExpressionParser`. **How to author them is the `objectstack-data` skill's
job**, under "Conditional Field Rules": the predicate scope, the client-only vs
client-and-server enforcement split, the invariant-vs-transition-gate choice,
and the protocol-17 removal of the `conditionalRequired` alias are all there.
Author them in the canonical tagged-template form that skill teaches
(``requiredWhen: P`record.status == 'paid'` ``), not as a bare string.

Renderer-side, and only here: the form renderer **re-evaluates these reactively
as the user edits**, via `resolveFieldRuleState` in `@object-ui/core`. A static
`required: true` / `readonly: true` is a floor a FALSE predicate cannot weaken.
Faults follow ADR-0137. At render a broken predicate is **fail-open**: it never
hides content and never locks a field. At submit a faulted or stored-blank field
rule **refuses the submit**, naming the field and the rule (the client judges
`visibleWhen`, the server the other two). A blank triad key is refused at
authoring; a blank gate stays "no gate", with a diagnostic. `visibleWhen` is
still never a security boundary on the client; the server is the authority.

## CEL predicates over a row record

Conditional formatting on a list/grid/kanban, a row action's `visible` /
`disabled`, and `SelectOption.visibleWhen` are all **CEL over `record.*`**,
evaluated by `@objectstack/formula` -- not by the `${}` evaluator above.
**The predicate language, the surfaces that take one, and the authoring rules
are the `objectstack-formula` skill's job**, under "Surfaces that take an
Expression"; the cascading-select and options-vs-lookup decision is
`objectstack-data`'s.

Three renderer-side facts that live nowhere else:

- **Failure direction is not uniform.** A row action's `visible` **fails
  closed** (a broken predicate hides the action and warns), matching the
  record-header `ActionEngine`; `disabled` fails soft (not disabled, warns);
  a field-level `visibleWhen` fails open. Do not generalise from one to another.
- **Authoring takes `{ condition, style }` only.** On every list carrier (grid,
  list view, kanban) a rule is `{ condition, style }`; the native `{ field,
  operator, value }` form and the `{ expression: "${…}" }` template form are
  retired, refused at the schema door by name with the respelling. A STORED
  legacy rule still renders through the shared evaluator (a compatibility read,
  not an authoring form); a `condition` in legacy-only syntax (`${…}`, `===`,
  `.includes()`) still routes to the old engine with a one-time deprecation
  warning -- write CEL.
- **`data.*` is the trap in a row predicate.** A row predicate binds ONE root,
  `record.*`; a bare `status` or `data.status` is retired there and faults on
  the runtime engine (`Unknown variable`), under each surface's existing error
  policy (`packages/core/src/evaluator/rowPredicateCanon.ts`); `data` stays
  canonical only on the metadata-editing layer. The authoring oracle still
  accepts `data.*` silently -- the fault shows at runtime, not at authoring.
- **`field.dependsOn` gates the control, not just the list.** While any declared
  parent is empty the select is gated ("Select country first"); a parent change
  re-evaluates the option list and **auto-clears** a value that is no longer
  valid.

## Data binding with `bind`

The `bind` field is NOT expression-evaluated. It's a path string resolved by
`useDataScope()` — and **only a component that calls that hook reads it**.

<!-- os:check -->
```json
{
  "type": "list",
  "bind": "customerNames"
}
```

When the host publishes
`scope = { customerNames: ["Ada Lovelace", "Grace Hopper"] }` through
`PredicateScopeProvider`, `list` calls `useDataScope("customerNames")` and
renders one entry per array element.

⛔ `bind` resolves against that same ambient scope — **not** against
`SchemaRendererProvider`'s `dataSource`. That prop is the `DataSource` adapter,
it has no member a `bind` path names, and the walk over it is retired. A
`bind` on a page with no scope published above it resolves `undefined`,
and each reader falls back to its own empty state.

**Nested paths work:** `"bind": "app.settings.users"` resolves `scope.app.settings.users`.

### Which components read `bind`

`useDataScope` is called by `list` and `tree-view` in `@object-ui/components`,
and by the `object-*` widgets the plugin packages register (`object-grid`,
`object-kanban`, `object-chart`, `object-data-table`, `object-gallery`,
`object-timeline`, `object-pivot`). Every other component ignores `bind` — no
error, no warning, nothing in the console — except `data-table` (one warning, below).

`data-table` is the one that catches authors out. It takes its rows from an
inline `data` array on the node and never calls `useDataScope`, so a `bind` on
it resolves nothing: the table renders its header over the "No results found"
empty state. Nothing is thrown and nothing on the page says why — the one
signal is a `[ObjectUI] DataTable bind:` console warning; on
the page, a table that looks built and is blank is the whole failure.

<!-- os:check -->
```json
{
  "type": "data-table",
  "data": [
    { "name": "Ada Lovelace", "email": "ada@example.com" },
    { "name": "Grace Hopper", "email": "grace@example.com" }
  ],
  "columns": [
    { "header": "Name", "accessorKey": "name" },
    { "header": "Email", "accessorKey": "email" }
  ]
}
```

To show *provider* data in a `data-table`, resolve the array in the host and put
it on the node — the same "expand in the host" route the next section describes
for per-record nodes.

## No per-item template iteration (`list` is data-as-nodes)

**There is no loop construct in ObjectUI, and no `item` / `index` scope.** No
component renders a per-item *template*: the evaluator context is built once per
node (`data`, `page`, the host predicate scope), and nothing ever pushes a
per-element frame onto it. A `${item.name}` resolves against nothing — an
unknown root identifier is left alone, so the literal text `${item.name}` is
what reaches the screen.

`list` is the component authors reach for first, and it is **data-as-nodes**:
the array it renders *is* the node list. It never reads `children`.

<!-- doc-json: fragment — deliberate counter-example: list reads no children slot and has no per-item scope, so this renders two empty items -->
<!-- os:check -->
```jsonc
// ❌ Renders two EMPTY <li>. `children` is not a template — `list` never reads it,
//    and `${item.name}` would render literally even if it did.
{
  "type": "list",
  "bind": "users",
  "children": [{ "type": "text", "content": "${item.name}" }]
}
```

### What `list` renders

Each entry of `items` (or of the array `bind` resolves to) is read as a node
descriptor:

| Entry shape | Rendered as |
|---|---|
| `"Ada"` (a plain string) | the string |
| `{ "content": "Ada" }` (a string) | the string verbatim — **not** expression-evaluated |
| `{ "content": node }` or `{ "content": [node, …] }` | rendered through `SchemaRenderer` |
| `{ "className": … }` | class on the `<li>` |
| anything else — e.g. a record `{ "name": "Ada" }` | an **empty `<li>`** |

`body` on an item is refused; use `content`. The last row is the trap this
section exists to close: binding `list` to ordinary records produces one empty
`<li>` per record — the right number of bullets, no text in any of them.

<!-- os:check -->
```jsonc
// ✅ Authored items — `title` and `ordered` are read off the node
{
  "type": "list",
  "title": "Team",
  "ordered": true,
  "items": [{ "content": "Ada" }, { "content": "Linus" }]
}
```

<!-- os:check -->
```jsonc
// ✅ Bound data, already node-shaped: scope = { rows: [{ "content": "Ada" }, { "content": "Linus" }] }
{ "type": "list", "bind": "rows" }
```

Only a node-valued `content` goes back through `SchemaRenderer`, so it is the one
place inside a list where expressions are evaluated at all — against the host
scope, never against a current element:

<!-- os:check -->
```jsonc
// ✅ `${data.*}` works inside a node-valued `content`; there is still no `${item.*}`
{
  "type": "list",
  "items": [{ "content": { "type": "text", "content": "Owner: ${data.team.owner}" } }]
}
```

### Grid and Table are not iterators either

- **`grid`** has no data binding at all — it is a CSS-grid wrapper that renders
  its `children` **once** and lays them out in columns. A `bind` on a `grid` is
  inert.
- **`table`** renders rows from an inline `data` array against `columns`
  accessors (`accessorKey`). Cell values are plain property lookups — never
  expressions — and `table` does not read `bind`.

<!-- os:check -->
```jsonc
// ✅ `table`: inline rows + column accessors, no per-row scope
{
  "type": "table",
  "columns": [{ "header": "Name", "accessorKey": "name" }],
  "data": [{ "name": "Ada" }, { "name": "Linus" }]
}
```

### Rendering one node per record

Template-per-item rendering is not something any component does today. The two
working routes:

1. **Expand in the host.** Map your records to nodes *before* handing the schema
   to `SchemaRenderer` — the host has the full array and can build one node per
   record with real string interpolation.
2. **Feed data-as-nodes.** Shape the data as list entries (`content`)
   and let `items` or `bind` render it, per the table above.

### The per-row scope that does exist

Row-level **predicates** on list views — conditional formatting and row-action
`visible` / `disabled` — are CEL over `record.*`, evaluated by
`@objectstack/formula`; see "List-view conditional tier" above. That is a
different engine with a different scope: it decides *whether* and *how* a row is
styled, and it gives `${}` templates no `item`.

## Security model

The expression parser blocks dangerous patterns to prevent injection:

**Blocked:** `eval()`, `Function()`, `setTimeout()`, `setInterval()`, `import()`, `require()`, `process.*`, `global.*`, `window.*`, `document.*`, `__proto__`, `constructor`, `prototype`

That list is `isDangerous`'s regex table, matched against the expression source
before compilation. Property access has a second gate the list omits: the
parser's `BLOCKED_PROPS` also rejects `__defineGetter__`, `__defineSetter__`,
`__lookupGetter__` and `__lookupSetter__`.

**Safe by design:** The recursive-descent parser never converts expression strings into executable JavaScript code. It tokenizes and evaluates each node directly.

## Performance

Expressions are compiled once per unique `(expression, variableNames)` pair and cached using LFU eviction (default 1000 entries). Repeated evaluation of the same expression across re-renders uses the cached compiled form.

**Avoid:**
- Heavy array operations (`filter`, `map`, `reduce`) on large datasets inside expressions — move to derived state or the data layer
- Deeply nested optional chaining in hot paths
- Multiple complex expressions on a single node in frequently re-rendered components

## Common mistakes and how to fix them

### Expression shows as literal text (`${data.x}` visible in UI)

**Cause:** The field isn't expression-evaluated. Use `content`.

<!-- doc-json: fragment — deliberate counter-example: value is retired from text and refused by name; the fix two fences down writes content -->
<!-- os:check -->
```jsonc
// ❌ Refused by name — `value` is RETIRED from `text`; write `content`
{ "type": "text", "value": "${data.total}" }
```

<!-- doc-json: fragment — deliberate counter-example: content parked under props is evaluated inside the envelope, then discarded, and props is no declared key -->
<!-- os:check -->
```jsonc
// ❌ Worse — evaluated inside the envelope, then discarded: renders nothing
{ "type": "text", "props": { "content": "${data.total}" } }
```

<!-- os:check -->
```jsonc
// ✅ Evaluated and read
{ "type": "text", "content": "Total: ${data.total}" }
```

### `hidden` expression doesn't hide the component

**Cause 1:** `visible` is also set and takes priority.
**Cause 2:** Expression returns a non-boolean truthy value — use explicit comparison.

<!-- os:check -->
```jsonc
// ❌ Truthy but not boolean
{ "hidden": "${data.count}" }
```

<!-- os:check -->
```jsonc
// ✅ Explicit boolean
{ "hidden": "${data.count > 0}" }
```

### `new X()` — only `Date` and `RegExp`

`parseNewExpression` permits exactly two constructors and throws
`new X() is not supported in expressions` for every other name. `new Date(…)`
is **not** blocked — measured through the schema path, it returns a real
`Date`. Prefer a formula function anyway: a `Date` object stringifies into
the DOM as a locale-dependent blob.

<!-- os:check -->
```jsonc
// ✅ Works, but renders "Thu Jan 01 1970 …"
{ "type": "text", "content": "${new Date(data.timestamp)}" }
```

<!-- os:check -->
```jsonc
// ✅ Preferred — formatted, and stable across locales
{ "type": "text", "content": "${DATEFORMAT(data.timestamp, 'YYYY-MM-DD')}" }
```

<!-- os:check -->
```jsonc
// ❌ Rejected — any constructor other than Date / RegExp
{ "type": "text", "content": "${new Function('return 1')()}" }
```

### Object literal in expression

<!-- doc-json: fragment — deliberate counter-example: an object literal inside an expression, which the evaluator rejects; style is a record, never a template string -->
<!-- os:check -->
```jsonc
// ❌ Object literals not supported
{ "type": "text", "style": "${{ color: 'red' }}" }
```

<!-- os:check -->
```jsonc
// ✅ Use className
{ "type": "text", "className": "text-red-500" }
```

### Missing variable returns undefined silently

Expressions don't throw on missing variables — they return `undefined`. Use fallback patterns:

<!-- os:check -->
```json
{ "type": "text", "content": "${data.user?.name || 'Unknown'}" }
```

## Debugging checklist

When an expression isn't working:

1. **Which key is it on, and does that type declare the key?** `content` and the predicate keys are evaluated and read on every type. `title` / `label` / `value` / `description` are evaluated **only on the types that declare them** — `statistic` (`label` / `value` / `description`), `card` (`title` / `description`), `button` (`label`) — and read raw everywhere else, including on a namespaced spelling such as `ui:statistic`. A `${...}` inside a `props` envelope is evaluated and then discarded. (A `properties` envelope is the one that is evaluated *and* hoisted onto the node — see [`rules/protocol.md`](../rules/protocol.md) for why that is recorded, not recommended.)
2. Is the `${}` syntax correct? Check for unmatched braces.
3. Is the data actually available in scope? Check what the host published on `PredicateScopeProvider` — ⛔ not `SchemaRendererProvider`'s `dataSource`, which publishes no expression root.
4. For conditions: are you using `On` suffix correctly? (`hiddenOn` takes raw expression, `hidden` needs `${}` if it's a string).
5. Does the expression use a blocked pattern? Check for constructors, `eval`, `window`, etc.
6. Is type coercion causing issues? `${0 && "yes"}` returns `0`, not `false`.
