---
title: "Expression System"
---

Object UI includes a powerful expression system that enables dynamic, data-driven UIs. Expressions allow you to reference data, compute values, and create conditional logic directly in your JSON schemas.

## Overview

Expressions are JavaScript-like code snippets embedded in schemas using the `${}` syntax:

```json
{
  "type": "text",
  "content": "Hello, ${user.name}!"
}
```

With this published as the expression scope:
```tsx
const scope = { user: { name: "Alice" } }
```

This renders: **"Hello, Alice!"** — `user` is a root because the host published a key by that
name. [Data Context](#data-context) below shows the provider that publishes one.

## Basic Syntax

### Simple Property Access

Access data properties using dot notation:

```json
{
  "type": "text",
  "content": "${user.firstName}"
}
```

### Nested Properties

Access nested objects:

```json
{
  "type": "text",
  "content": "${user.address.city}"
}
```

### Array Access

Access array elements:

```json
{
  "type": "text",
  "content": "${users[0].name}"
}
```

### String Interpolation

Mix expressions with static text:

```json
{
  "type": "text",
  "content": "Welcome, ${user.firstName} ${user.lastName}!"
}
```

### Localized Copy

Copy written once per language is an inline locale map. Under a node's `properties`, each member
of the map is evaluated exactly like a plain string on the same key, against the same scope, and
the block then draws the member for the viewer's language:

```json
{
  "type": "element:text",
  "properties": {
    "content": {
      "en": "Welcome back, ${current_user.name}",
      "zh-CN": "欢迎回来,${current_user.name}"
    }
  }
}
```

An object counts as a locale map when every key is a locale tag (`en`, `zh-CN`, or `default`) and
every value is a string. Any other object under `properties` reaches the block as written: a
`${…}` nested inside it is not evaluated.

## Operators

### Arithmetic Operators

```json
{
  "type": "text",
  "content": "Total: ${price * quantity}"
}
```

Supported: `+`, `-`, `*`, `/`, `%`

### Comparison Operators

```json
{
  "type": "text",
  "content": "${score >= 90 ? 'Top grade' : 'Keep going'}"
}
```

Supported: `>`, `<`, `>=`, `<=`, `==`, `===`, `!=`, `!==`

### Logical Operators

```json
{
  "type": "button",
  "visibleOn": "${user.isAdmin && user.isActive}"
}
```

Supported: `&&`, `||`, `!`

### Ternary Operator

```json
{
  "type": "text",
  "content": "${count > 0 ? count + ' items' : 'No items'}"
}
```

## Conditional Properties

### visibleOn

Show component when expression is true:

```json
{
  "type": "button",
  "label": "Admin Panel",
  "visibleOn": "${user.role === 'admin'}"
}
```

### hiddenOn

Hide component when expression is true:

```json
{
  "type": "section",
  "hiddenOn": "${user.settings.hideSection}"
}
```

### disabledOn

Disable component when expression is true:

```json
{
  "type": "button",
  "label": "Submit",
  "disabledOn": "${record.status === 'submitted'}"
}
```

## Data Context

### Where the names come from

Expression scope does **not** arrive as a prop. `SchemaRenderer` declares exactly one prop,
`schema`, and forwards every other prop it is handed straight through to the component the
schema names — so a `data`, `dataSource` or `debug` written on the element is neither read nor
refused. Nothing throws, and there is one line on the console; the expression simply never
resolves, and an unresolvable template is returned as its own source text, so the characters
you typed are what the reader sees.

The host publishes its values with `PredicateScopeProvider`, and every key it publishes becomes
a root:

```tsx
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react'
import type { DeclaredNode } from '@object-ui/types'

// The page schema — your own document.
declare const schema: DeclaredNode

// Every name here becomes a root the schema's expressions can read.
const scope = {
  user: { name: 'Alice' },
  settings: { theme: 'dark' },
}

function App() {
  return (
    <PredicateScopeProvider scope={scope}>
      <SchemaRenderer schema={schema} />
    </PredicateScopeProvider>
  )
}
```

```json
{
  "type": "text",
  "content": "Theme: ${settings.theme}"
}
```

The scope the evaluator builds is what you published, plus two names the renderer supplies:

| name | what it holds |
|---|---|
| every key of `scope` | exactly what you put there — `user`, `settings`, whatever the page needs |
| `record` | the row a record surface is bound to, when there is one |
| `page` | page-local variables, for predicates that gate on another component's state |

`current_user` is an alias of whatever you published as `user`; an app built on
`@object-ui/app-shell` does not mount the provider itself, because the shell's
`ExpressionProvider` already feeds the same channel with the signed-in `user` and `features`.

> **`dataSource` is not an expression root.** `SchemaRendererProvider`'s `dataSource` carries
> the host's `DataSource` *adapter* — the object renderers call `find()` on. The renderer used
> to publish that adapter under the name `data`; an adapter answers no `data.*` path, so the
> root was constant for every conformant host, and objectui#9308 removed it. A `${data.…}`
> expression now reads whatever *you* published under `data`, and nothing if you published
> none. **This changes the verdict of a gate already in the field**: `visible: "${data.x}"`
> used to resolve to `undefined` and HIDE its node on every row; with no `data` key at all it
> is unevaluable, this surface fails soft, and the node is SHOWN. At the runtime layer the row
> is `record` (ADR-0089 D3) — rewrite such a gate to `record.*` rather than re-publishing a
> `data` key.

### Lists

`list` has no item template, and it provides no `item` or `index` scope for an expression to
read. It draws its `items` array — or the array its `bind` path resolves to — one row per entry:
a string, or an object whose `content` is a node.

```json
{
  "type": "list",
  "bind": "users"
}
```

## Built-in Functions

### String Functions

```json
{
  "type": "text",
  "content": "${user.name.toUpperCase()}"
}
```

Available:
- `toUpperCase()`, `toLowerCase()`
- `trim()`, `trimStart()`, `trimEnd()`
- `substring(start, end)`
- `replace(search, replace)`
- `split(separator)`
- `includes(substring)`
- `startsWith(prefix)`, `endsWith(suffix)`

### Array Functions

```json
{
  "type": "text",
  "content": "Total users: ${users.length}"
}
```

```json
{
  "type": "text",
  "content": "${users.map(u => u.name).join(', ')}"
}
```

Available:
- `length`
- `map(fn)`, `filter(fn)`, `reduce(fn, initial)`
- `join(separator)`
- `slice(start, end)`
- `includes(item)`
- `find(fn)`, `findIndex(fn)`
- `some(fn)`, `every(fn)`

### Number Functions

```json
{
  "type": "text",
  "content": "Price: ${price.toFixed(2)}"
}
```

Available:
- `toFixed(decimals)`
- `toPrecision(digits)`
- `toString()`

### Math Functions

```json
{
  "type": "text",
  "content": "${Math.round(average)}"
}
```

Available: All standard `Math` functions
- `Math.round()`, `Math.floor()`, `Math.ceil()`
- `Math.min()`, `Math.max()`
- `Math.abs()`
- `Math.random()`

### Date Functions

```json
{
  "type": "text",
  "content": "${new Date().toLocaleDateString()}"
}
```

## Complex Expressions

### Nested Ternary

```json
{
  "type": "text",
  "content": "${status === 'active' ? 'Active' : status === 'pending' ? 'Pending review' : status === 'error' ? 'Failed' : 'Unknown'}"
}
```

### Combining Operators

```json
{
  "type": "alert",
  "visibleOn": "${(user.role === 'admin' || user.role === 'moderator') && user.isActive && !user.isSuspended}"
}
```

### Array Methods

```json
{
  "type": "text",
  "content": "${users.filter(u => u.isActive).map(u => u.name).join(', ')}"
}
```

## Practical Examples

### User Greeting

```json
{
  "type": "text",
  "content": "${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, ${user.firstName}!"
}
```

### Status Badge

`badge` has no row in the expression carriage map, so its `label` and `variant`
are read off the node exactly as written — a `${…}` in either reaches the screen
as those characters. Resolve both in the data you hand the renderer and author
the node with the resolved values; the condition keys are evaluated on every
type and stay expressions:

```json
{
  "type": "badge",
  "label": "Completed",
  "variant": "secondary",
  "visibleOn": "${status !== 'draft'}"
}
```

Two neighbouring traps: `text` is not a `badge` key at all — the badge's text is
`label` — and `variant` is a closed set: `default`, `secondary`, `destructive`,
`outline`.

### Price Formatting

```json
{
  "type": "text",
  "content": "$${(price * quantity).toFixed(2)}"
}
```

### Empty State

```json
{
  "type": "empty",
  "visibleOn": "${items.length === 0}",
  "title": "No items to display",
  "description": "Start by adding your first item"
}
```

### Percentage Bar

`progress` has no row in the expression carriage map, so its `value` and `label`
are read off the node exactly as written — a `${…}` in either reaches the screen
as those characters. Compute the percentage in the data you hand the renderer;
the condition keys are evaluated on every type and stay expressions:

```json
{
  "type": "progress",
  "value": 75,
  "label": "75% complete",
  "visibleOn": "${total > 0}"
}
```

### Conditional Styling

`className` has no row in the carriage map either — on `card` or on any other
type — so an expression written there lands in the rendered `class` attribute as
its own source text. Resolve the class list in the data you hand the renderer,
or author each variant and gate it with a condition key:

```json
{
  "type": "card",
  "title": "${task.name}",
  "className": "border-red-500 border-2",
  "visibleOn": "${task.isPriority}"
}
```

## Form Expressions

A form's own values are the **row under edit**, and the row is bound as `record` and nothing
else — the bare shorthand (`country`) and the wrong-layer `data.country` were both retired on
runtime record surfaces (objectui#5330 phase 2), and `record` is the canonical runtime-layer
root (ADR-0089 D3). There is no `form` root: a predicate written against one is unevaluable,
and a fail-soft surface answers it by showing the field on every row.

### Dependent Fields

A form's fields are its `fields` array, and each field's `visibleOn` is evaluated against that
row:

```json
{
  "type": "form",
  "fields": [
    {
      "name": "country",
      "type": "select",
      "label": "Country",
      "options": [
        { "label": "USA", "value": "USA" },
        { "label": "Canada", "value": "Canada" },
        { "label": "Mexico", "value": "Mexico" }
      ]
    },
    {
      "name": "state",
      "type": "select",
      "label": "State/Province",
      "visibleOn": "${record.country === 'USA'}",
      "options": [
        { "label": "CA", "value": "CA" },
        { "label": "NY", "value": "NY" },
        { "label": "TX", "value": "TX" }
      ]
    }
  ]
}
```

### Validation

An `input` declares no `validations` bag, and nothing reads one. `inputType: "email"` renders an
email input, which the browser validates, and `required` marks it required:

```json
{
  "type": "input",
  "name": "email",
  "label": "Email",
  "required": true,
  "inputType": "email"
}
```

### Computed Fields

`input` has no row in the expression carriage map either, so a computed total
cannot be carried by its `value`. Show it with a `text` node, whose `content` is
evaluated on every component type:

```json
{
  "type": "text",
  "content": "Total: ${record.price * record.quantity}"
}
```

## Performance Considerations

### Expensive Computations

Expressions are re-evaluated when data changes. Avoid expensive operations:

❌ Bad: Complex computation in expression

```json
{
  "type": "text",
  "content": "${users.map(u => expensiveOperation(u)).join(', ')}"
}
```

✅ Good: Pre-compute, and publish the result

<!-- doc-snippet: fragment — the good half of a bad/good contrast: `users` and `expensiveOperation` are the reader's own rows and function, shown only to place the computation outside the expression -->

```tsx
const scope = {
  processedUsers: users.map(u => expensiveOperation(u))
}
```

### Caching

The expression engine automatically caches results when data doesn't change.

## Security

### Sandboxed Execution

Expressions run in a sandboxed environment and can only access:
- The names the host published as scope, plus `record` and `page`
- The globals listed in `SAFE_GLOBALS` (`packages/core/src/evaluator/SafeExpressionParser.ts`):
  `Math`, `JSON`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`
- Methods on the values those names hold — string, number and array methods
- `new Date(...)` and `new RegExp(...)`, the only two constructors `new` accepts

> **A global that is not on that list fails the way every unresolved name fails.** `Date`,
> `String` and `Array` are reachable only in the two forms above — `Date` as a constructor,
> `String` and `Array` as methods on a value you already hold. Written as globals they resolve
> to nothing: `${Date.now()}`, `${String(x)}` and `${Array.isArray(x)}` each raise inside the
> parser, and this surface fails soft, so the template is returned as its own source text with
> one line on the console — the characters you typed are what the reader sees.

They **cannot** access:
- Browser APIs (window, document, localStorage)
- Node.js APIs (fs, path, etc.)
- Global variables
- Function constructors

### Sanitization

All expression outputs are automatically sanitized to prevent XSS attacks.

## Debugging Expressions

### Expression Errors

An expression that cannot be resolved is **not** an error the reader sees, and it is not the
same failure in both directions. Measured on the built evaluator:

```json
{
  "type": "text",
  "content": "${user.invalidProperty}"
}
```

| the scope | what the evaluator returns |
|---|---|
| `user` is published, `invalidProperty` is not a member of it | `undefined` — nothing is thrown |
| no `user` root at all | the template's own **source text**, and one line on the console |

So a missing member renders as nothing, and a missing root renders as the characters you
typed. Neither raises, and neither stops the render — which is why the scope a page publishes
has to be stated rather than assumed.

### Debug Mode

`debug` is read off the same provider context as `dataSource`
(`context?.debug || context?.debugFlags?.enabled`), never off the element — a `debug` written
on `SchemaRenderer` is forwarded to the component the schema names, exactly like a `data` prop,
and turns nothing on. Mount the provider instead:

<!-- doc-snippet: fragment — the provider pair shown for the `debug` flag alone; `schema` is the reader's own document, and `dataSource` is `null` because this mount is about the flag rather than about an adapter -->

```tsx
<SchemaRendererProvider dataSource={null} debug>
  <SchemaRenderer schema={schema} />
</SchemaRendererProvider>
```

This logs all expression evaluations to the console. It is orthogonal to the expression scope:
wrap this pair in a `PredicateScopeProvider` as well when you want both.

## Advanced Usage

### Custom Functions

There is no global evaluator to extend: `SchemaRenderer` builds a fresh
`ExpressionEvaluator` for each evaluation, so a function has to reach it through
the evaluation context. Anything callable you put in the context is callable in
an expression, under exactly the name you gave it:

```tsx
import { evaluateExpression } from '@object-ui/core'

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)

// => '$1,234.50'
evaluateExpression('${formatCurrency(price)}', { formatCurrency, price: 1234.5 })
```

That is the direct-evaluation path, and `formatCurrency` is a root there because this call
hands the evaluator its own context. A component expression rendered by `SchemaRenderer`
resolves against a different scope — the names the host published through
`PredicateScopeProvider`, plus `record` and `page` — so a function you registered elsewhere is
not reachable from a schema expression. Compute the value before it reaches the schema, and
bind the result.

Hold an evaluator when you want one context reused — construct it, then call
`evaluate`:

```tsx
import { ExpressionEvaluator } from '@object-ui/core'

const evaluator = new ExpressionEvaluator({ user: { role: 'admin' } })

evaluator.evaluate('${user.role === "admin"}')
```

### Custom Operators

Expressions are JavaScript, evaluated against the context — operators are the
language's own. A membership test is written with the array method:

```json
{
  "type": "button",
  "visibleOn": "${user.permissions.includes('admin')}"
}
```

## Best Practices

### 1. Keep Expressions Simple

❌ Bad: Too complex

```json
{
  "content": "${users.filter(u => u.age > 18).map(u => ({...u, isAdult: true})).reduce((acc, u) => acc + u.score, 0)}"
}
```

✅ Good: Pre-compute complex logic

```json
{
  "content": "${adultUsersScore}"
}
```

### 2. Use Meaningful Variable Names

❌ Bad

```json
{
  "visibleOn": "${x && y || z}"
}
```

✅ Good

```json
{
  "visibleOn": "${isAdmin && isActive || isSuperUser}"
}
```

### 3. Handle Null/Undefined

❌ Bad: Might throw error

```json
{
  "content": "${user.address.city}"
}
```

✅ Good: Safe access

```json
{
  "content": "${user.address?.city || 'N/A'}"
}
```

### 4. Use TypeScript

Define the type of the scope you publish:

<!-- doc-snippet: fragment — the typed scope is followed by a bare provider pair and the literal is written as an elided `{ /* ... */ }`, so the block states a type rather than compiling -->

```tsx
interface AppScope {
  user: {
    name: string
    role: 'admin' | 'user'
    isActive: boolean
  }
}

const scope: AppScope = { /* ... */ }
<PredicateScopeProvider scope={scope}>
  <SchemaRenderer schema={schema} />
</PredicateScopeProvider>
```

## Next Steps

- [Schema Rendering](./schema-rendering.md) - Learn the rendering engine
- [Component Registry](./component-registry.md) - Understand components
- [Schema Overview](/docs/guide/schema-overview) - Explore schema specifications

## Related Documentation

- [`@object-ui/core` README](https://github.com/objectstack-ai/objectui/tree/main/packages/core) - Expression evaluator API
- [Form Plugin](/docs/plugins/plugin-form) - Form-specific expressions
- [View Plugin](/docs/plugins/plugin-view) - Data view expressions
